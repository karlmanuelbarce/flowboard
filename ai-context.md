# FlowBoard API — How Everything Works

A reference document explaining the architecture, data flow, and security design of the FlowBoard API.

---

## High-Level Architecture

```
Client
  │
  ▼
Express App (api/src/app.ts)
  │  Security middleware stack (helmet → cors → body limit)
  │
  ├── /auth          → auth.ts router
  ├── /boards        → boards.ts router
  ├── /tasks         → tasks.ts router
  ├── /audit-logs    → audit-logs.ts router
  └── /health        → health.ts router
       │
       ▼
  PostgreSQL (via Prisma)
  Redis (token store + rate limiting + event stream)
       │
       ▼
  Worker (worker/) — consumes Redis Stream tasks:events
```

---

## Middleware Stack (app.ts)

Every request passes through these layers in order before hitting any route:

### 1. `app.set('trust proxy', 1)`
Tells Express to trust the `X-Forwarded-For` header from a single upstream proxy (e.g. Nginx). Without this, `req.ip` would always be the proxy's IP, breaking per-client rate limiting.

### 2. `helmet()`
Sets a collection of security-related HTTP response headers automatically:
- `X-Content-Type-Options: nosniff` — prevents MIME-type sniffing
- `X-Frame-Options: SAMEORIGIN` — blocks clickjacking via iframes
- `Strict-Transport-Security` — forces HTTPS after first visit
- `X-DNS-Prefetch-Control`, `Referrer-Policy`, and more

No configuration needed — `helmet()` with no args is a safe default for APIs.

### 3. `cors({ origin, credentials })`
Restricts which browser origins can make cross-origin requests to the API. The allowed list is read from the `ALLOWED_ORIGINS` environment variable (comma-separated), defaulting to `http://localhost:3000`. Any request from a different origin gets a CORS rejection before it reaches any route handler.

### 4. `express.json({ limit: '10kb' })`
Parses the request body as JSON and enforces a 10 KB size cap. Requests with bodies larger than 10 KB receive a 413 before any route logic runs. This prevents large-payload denial-of-service attacks.

### 5. Global Error Handler
The last middleware in the chain. Catches any error passed via `next(err)` or thrown inside `asyncHandler`. Two branches:
- **`AppError`** — an intentional, expected error (wrong password, not found, rate limited). Safe to return to the client with its message and error code.
- **Unknown error** — an unexpected crash. Returns a generic `{ message: 'Internal server error' }`. Stack trace is only logged to console in non-production environments (`NODE_ENV !== 'production'`), never sent to the client.

---

## Authentication Flow (routes/auth.ts)

### Registration — `POST /auth/register`
1. `rateLimiter` — general 100 req/15min per IP
2. `validate(registerSchema)` — Zod checks email format + password ≥ 8 chars; strips any extra fields
3. Checks for duplicate email → 409 if taken
4. Hashes password with `bcrypt` at cost factor **12** (slow enough to resist brute-force offline cracking)
5. Creates user in PostgreSQL
6. Calls `signTokens()` → returns access + refresh token pair

### Login — `POST /auth/login`
1. `loginRateLimiter` — **10 attempts per 60 seconds per IP**, then **15-minute lockout** (see below)
2. `validate(loginSchema)` — Zod strips extra fields
3. Looks up user by email → 401 if not found (same message as wrong password, prevents user enumeration)
4. `bcrypt.compare()` — constant-time password check → 401 if wrong
5. `signTokens()` → returns new token pair

### Token Signing — `signTokens()`
Issues two tokens per login:

| Token | Signed with | Expires | Stored |
|---|---|---|---|
| Access token | `JWT_ACCESS_SECRET` | 15 minutes | Client only (memory/header) |
| Refresh token | `JWT_REFRESH_SECRET` | 7 days | Client + Redis (`refresh:{userId}:{tokenId}`) |

The refresh token carries a random `tokenId` (UUID). Redis stores `refresh:{userId}:{tokenId} = "1"` with a 7-day TTL. This enables:
- **Token rotation** — each `/auth/refresh` call deletes the old Redis key and issues new tokens
- **Revocation** — logout deletes the Redis key immediately; the token becomes unusable even if still within its JWT expiry window
- **Replay detection** — if the same refresh token is used twice, the second call finds no Redis key and returns 401 `REFRESH_TOKEN_REUSED`

### Refresh — `POST /auth/refresh`
1. Verifies the JWT signature and expiry
2. Looks up `refresh:{userId}:{tokenId}` in Redis → 401 if missing (already used or revoked)
3. Deletes the old key, issues new token pair

### Logout — `POST /auth/logout`
Verifies the refresh token, deletes its Redis key. Returns 204 regardless — even an invalid token gets a 204 so clients can't probe token validity.

---

## Brute-Force Protection (middleware/rateLimiter.ts)

### General rate limiter — `rateLimiter`
Used on `/auth/register` and can be applied to any route.
- Redis key: `rate:{ip}`
- Window: 15 minutes, max 100 requests
- Resets when the key expires

### Login rate limiter — `loginRateLimiter`
Applied only to `POST /auth/login`. Stricter:

```
Request arrives
    │
    ▼
Check Redis: loginLock:{ip}
    │ exists → 429 LOGIN_LOCKED (show remaining TTL in minutes)
    │
    ▼
Increment: loginAttempt:{ip}  (TTL 60s, set on first increment)
    │
    ▼
count > 10?
    │ yes → set loginLock:{ip} EX 900 (15 min) → 429 LOGIN_LOCKED
    │ no  → next()
```

Keys used:
- `loginAttempt:{ip}` — sliding counter, 60-second window
- `loginLock:{ip}` — lockout flag, 15-minute TTL

---

## Request Validation & Mass Assignment Prevention (middleware/validation.ts)

```typescript
req.body = schema.parse(req.body);   // replaces body with Zod-parsed result
```

`z.object()` by default uses `.strip()` — unknown fields are silently removed from the output. So:
- `POST /tasks` with `{ title, boardId, isAdmin: true }` → Prisma only receives `{ title, boardId, status, priority }`. The `isAdmin` field never reaches the database.
- This is enforced on every mutating route via the `validate()` middleware.

---

## Ownership Enforcement (routes/boards.ts, routes/tasks.ts)

Every Prisma query that accesses a user-owned resource filters by the authenticated user's ID:

```typescript
// Tasks — must belong to a board owned by the requesting user
prisma.task.findFirst({
  where: { id: taskId, board: { ownerId: req.user!.userId } }
});

// Boards — must be owned by the requesting user
prisma.board.findFirst({
  where: { id: boardId, ownerId: req.user!.userId }
});
```

If the record doesn't exist **or belongs to a different user**, Prisma returns `null` and the route returns 404. There is no separate 403 branch — the resource simply "doesn't exist" from the requester's perspective, which avoids leaking that the ID is valid but belongs to someone else.

---

## Task Events — Redis Stream (lib/events.ts)

After every task mutation (create / update / delete), the route calls `publishTaskEvent()`:

```
Redis Stream key: tasks:events
Fields per entry: action, taskId, userId, payload (JSON), ts
```

The background `worker/` service reads this stream and processes events asynchronously (AI summaries, notifications, audit logging). This decouples the HTTP response from any slow downstream work.

---

## SQL Injection — Why It Can't Happen

Prisma never interpolates user input into raw SQL strings. Every query goes through Prisma's query builder, which sends parameterized queries to PostgreSQL. User-supplied values (task title, email, etc.) are always bound as parameters, never as part of the SQL text.

---

## Environment Variables

| Variable | Used by | Purpose |
|---|---|---|
| `DATABASE_URL` | Prisma | PostgreSQL connection string |
| `REDIS_HOST` | lib/redis.ts | Redis hostname (default: `redis`) |
| `REDIS_PORT` | lib/redis.ts | Redis port (default: `6379`) |
| `JWT_ACCESS_SECRET` | auth routes + authenticate middleware | Signs/verifies access tokens |
| `JWT_REFRESH_SECRET` | auth routes | Signs/verifies refresh tokens |
| `ALLOWED_ORIGINS` | app.ts | Comma-separated list of allowed CORS origins |
| `NODE_ENV` | app.ts error handler | Suppresses stack trace logging in `production` |

---

## File Map

```
api/src/
├── app.ts                     — middleware stack + error handler
├── server.ts                  — binds to port 3000
├── errors/AppError.ts         — typed error class (message, statusCode, code)
├── middleware/
│   ├── authenticate.ts        — verifies JWT, attaches req.user
│   ├── rateLimiter.ts         — general + login-specific rate limiters
│   ├── validation.ts          — Zod schema validation + body replacement
│   ├── async-handler.ts       — wraps async route fns, forwards thrown errors
│   └── db.ts                  — exports Prisma client
├── routes/
│   ├── auth.ts                — register, login, refresh, logout
│   ├── boards.ts              — board CRUD (owner-scoped)
│   ├── tasks.ts               — task CRUD (owner-scoped) + event publishing
│   ├── audit-logs.ts          — placeholder
│   └── health.ts              — /health, /ready
├── schemas/
│   ├── auth.schema.ts         — register + login Zod schemas
│   ├── boards.schema.ts       — create + update board schemas
│   └── task.schema.ts         — create + update task schemas
└── lib/
    ├── redis.ts               — ioredis client singleton
    └── events.ts              — publishTaskEvent() → Redis Stream
```
