# Flowboard

A task management REST API built with Node.js, Express, PostgreSQL, and Redis. Features JWT authentication with token rotation, async event processing via Redis Streams, structured logging, and an Nginx reverse proxy.

## Architecture

```
┌─────────────┐     ┌───────────────┐     ┌───────────────┐     ┌─────────────────┐
│   Client    │────▶│     Nginx     │────▶│  Flowboard    │────▶│   PostgreSQL    │
│             │     │   (port 80)   │     │     API       │     │   (flowboard)   │
└─────────────┘     └───────────────┘     │  (port 3000)  │     └─────────────────┘
                                          └───────┬───────┘              ▲
                                                  │                      │
                                           Redis Stream             audit_logs
                                          tasks:events                   │
                                                  │              ┌───────┴───────┐
                                                  └─────────────▶│    Worker     │
                                                                 │  (consumer)   │
                                                                 └───────────────┘
```

The **API** handles all HTTP requests, enforces auth, and publishes task mutation events to a Redis Stream. The **Worker** consumes those events and writes audit logs to PostgreSQL, decoupling audit writes from the request path. **Nginx** sits in front as a reverse proxy, forwarding `/api/*` traffic to the API.

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 |
| Framework | Express 5 |
| Language | TypeScript |
| ORM | Prisma 7 |
| Database | PostgreSQL 16 |
| Cache / Queue | Redis 7 |
| Reverse Proxy | Nginx (Alpine) |
| Auth | JWT (access + refresh) |
| Validation | Zod |
| Logging | Pino |
| Testing | Jest + Supertest |

## Prerequisites

- [Docker](https://www.docker.com/) and Docker Compose

## Getting Started

```bash
# Clone the repo
git clone https://github.com/karlmanuelbarce/flowboard.git
cd flowboard

# Copy environment variables
cp .env.example api/.env

# Build and start all services (migrations run automatically)
npm run dev
```

The API is available at `http://localhost/api/health`.

## Environment Variables

### API (`api/.env`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `JWT_ACCESS_SECRET` | Yes | — | Secret for signing access tokens |
| `JWT_REFRESH_SECRET` | Yes | — | Secret for signing refresh tokens |
| `REDIS_HOST` | No | `localhost` | Redis hostname |
| `REDIS_PORT` | No | `6379` | Redis port |
| `ALLOWED_ORIGINS` | No | `http://localhost:3000` | Comma-separated CORS origins |
| `NODE_ENV` | No | — | `development` or `production` |
| `LOG_LEVEL` | No | `info` | Pino log level |

### Worker (`worker/.env`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `REDIS_HOST` | No | `localhost` | Redis hostname |
| `REDIS_PORT` | No | `6379` | Redis port |

## API Reference

All endpoints (except auth and health) require a Bearer token in the `Authorization` header.

Base URL: `http://localhost/api`

### Auth

| Method | Path | Description |
|---|---|---|
| `POST` | `/auth/register` | Create a new account |
| `POST` | `/auth/login` | Authenticate and get tokens |
| `POST` | `/auth/refresh` | Rotate refresh token |
| `POST` | `/auth/logout` | Revoke refresh token |

### Boards

| Method | Path | Description |
|---|---|---|
| `GET` | `/boards` | List all boards for the authenticated user |
| `POST` | `/boards` | Create a new board |
| `GET` | `/boards/:id` | Get a board with its tasks |
| `DELETE` | `/boards/:id` | Delete a board |

### Tasks

| Method | Path | Description |
|---|---|---|
| `GET` | `/tasks` | List tasks (filter by `?boardId=`) |
| `POST` | `/tasks` | Create a new task |
| `GET` | `/tasks/:id` | Get a single task |
| `PATCH` | `/tasks/:id` | Update title, description, status, or priority |
| `DELETE` | `/tasks/:id` | Delete a task |

### Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness check — returns uptime |
| `GET` | `/ready` | Readiness check — probes PostgreSQL and Redis |

## Data Models

```prisma
enum TaskStatus { TODO  IN_PROGRESS  REVIEW  DONE }
enum Priority   { LOW   MEDIUM       HIGH         }

model User {
  id        String     @id @default(uuid())
  email     String     @unique
  password  String                         // bcrypt, cost 12
  boards    Board[]
  auditLogs AuditLog[]
  createdAt DateTime   @default(now())
}

model Board {
  id        String   @id @default(uuid())
  name      String
  ownerId   String
  owner     User     @relation(fields: [ownerId], references: [id])
  tasks     Task[]
  createdAt DateTime @default(now())
}

model Task {
  id          String     @id @default(uuid())
  title       String
  description String?
  status      TaskStatus @default(TODO)
  priority    Priority   @default(MEDIUM)
  boardId     String
  board       Board      @relation(fields: [boardId], references: [id])
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt
}

model AuditLog {
  id        String   @id @default(uuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  action    String   // CREATED | UPDATED | DELETED
  entity    String   // Task
  entityId  String
  createdAt DateTime @default(now())
}
```

## Authentication Flow

Access tokens expire in **15 minutes**; refresh tokens expire in **7 days**.

1. `POST /auth/login` → returns `{ accessToken, refreshToken }`
2. Use `Authorization: Bearer <accessToken>` on all protected requests
3. When the access token expires, call `POST /auth/refresh` with the refresh token
4. The refresh endpoint rotates the token — the old token is immediately invalidated

Refresh tokens are stored in Redis (`refresh:{userId}:{tokenId}`) for revocation and replay detection. Reuse of an already-rotated token returns an error. Logout requires the refresh token and immediately deletes the Redis key.

## Redis Streams (Worker)

Every task create, update, or delete publishes an event to the `tasks:events` Redis Stream:

```
XADD tasks:events * action CREATED taskId <id> userId <id> payload {...} ts <timestamp>
```

The worker consumes this stream via a consumer group (`audit-group`), dispatching to a dedicated handler per action type:

- Reads up to 10 messages per iteration with a 5-second block timeout
- Dispatches to `handleTaskCreated`, `handleTaskUpdated`, or `handleTaskDeleted`
- Writes an `AuditLog` record to PostgreSQL on success, then `XACK`s the message
- Messages that fail 3 times are moved to `tasks:events:dlq` (dead letter queue)

## Security

- **Nginx** — reverse proxy; only `/api/*` traffic reaches the API
- **Helmet** — sets security headers (CSP, HSTS, X-Frame-Options, etc.)
- **CORS** — configurable allowed origins
- **Body size limit** — 10 KB max request body
- **Rate limiting** — 100 req/15 min per IP globally; 10 login attempts/60 sec with 15-minute lockout on breach
- **Zod validation** — input validated and stripped at all API boundaries
- **Ownership enforcement** — all resource queries are scoped to the authenticated user; unauthorized resources return 404

## Scripts

```bash
npm run dev            # build images and start all containers (migrations run automatically)
npm start              # start containers without rebuilding
npm stop               # stop all containers
npm run logs           # tail all container logs
npm test               # run API test suite
npm run test:coverage  # run tests with coverage report
npm run db:audit-logs  # view latest 10 audit log entries
```

## Testing

```bash
npm test               # runs all tests once
npm run test:coverage  # generates coverage report in api/coverage/
```

Tests use Supertest against the live Express app and require PostgreSQL and Redis to be running (`npm start` first).

## Project Structure

```
flowboard/
├── nginx/
│   └── nginx.conf             # reverse proxy config
├── api/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/
│   └── src/
│       ├── errors/            # AppError class
│       ├── lib/               # Redis client, Pino logger, event publisher
│       ├── middleware/        # auth, rate limiter, validation, error handler
│       ├── routes/            # auth, boards, tasks, audit-logs, health
│       ├── schemas/           # Zod validation schemas
│       ├── app.ts             # Express app setup
│       └── server.ts          # HTTP server entry point (binds 0.0.0.0:3000)
├── worker/
│   └── src/
│       ├── handlers/
│       │   ├── taskCreated.ts
│       │   ├── taskUpdated.ts
│       │   └── taskDeleted.ts
│       ├── lib/               # Pino logger, pg pool
│       └── index.ts           # Redis Stream consumer loop
├── docker-compose.yml
├── docker-compose.test.yml    # test database override
├── Dockerfile                 # API container (runs migrations then starts server)
├── .env.example               # environment variable template
└── package.json               # root scripts
```
