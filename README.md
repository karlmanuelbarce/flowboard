# Flowboard

A task management REST API built with Node.js, Express, PostgreSQL, and Redis. Features JWT authentication with token rotation, async event processing via Redis Streams, and structured logging.

## Architecture

```
┌─────────────┐     ┌───────────────┐     ┌─────────────────┐
│   Client    │────▶│  Flowboard    │────▶│   PostgreSQL    │
│             │     │     API       │     │   (flowboard)   │
└─────────────┘     │  (port 3000)  │     └─────────────────┘
                    └───────┬───────┘              ▲
                            │                      │
                     Redis Stream             audit_logs
                    tasks:events                   │
                            │              ┌───────┴───────┐
                            └─────────────▶│    Worker     │
                                           │  (consumer)   │
                                           └───────────────┘
```

The **API** handles all HTTP requests, enforces auth, and publishes task mutation events to a Redis Stream. The **Worker** consumes those events and writes audit logs to PostgreSQL, decoupling audit writes from the request path.

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 |
| Framework | Express 5 |
| Language | TypeScript |
| ORM | Prisma 7 |
| Database | PostgreSQL 16 |
| Cache / Queue | Redis 7 |
| Auth | JWT (access + refresh) |
| Validation | Zod |
| Logging | Pino |
| Testing | Jest + Supertest |

## Prerequisites

- [Docker](https://www.docker.com/) and Docker Compose
- Node.js 20+ (for local development without Docker)

## Getting Started

### With Docker (recommended)

```bash
# Clone the repo
git clone https://github.com/karlmanuelbarce/flowboard.git
cd flowboard

# Start all services (API, worker, PostgreSQL, Redis)
npm run docker:up

# The API is available at http://localhost:3000
```

### Local Development

```bash
# Start dependencies only
docker compose up db redis -d

# Install API dependencies and run migrations
cd api
npm install
npx prisma migrate dev
npm run dev

# In another terminal, start the worker
cd worker
cp .env.example .env  # fill in values
npm install
npm run dev
```

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

Refresh tokens are stored in Redis (`refresh:{userId}:{tokenId}`) for revocation and replay detection. Reuse of an already-rotated token returns an error.

## Redis Streams (Worker)

Every task create, update, or delete publishes an event to the `tasks:events` Redis Stream:

```
XADD tasks:events * action CREATED taskId <id> userId <id> payload {...} ts <timestamp>
```

The worker consumes this stream via a consumer group (`audit-group`):

- Reads up to 10 messages per iteration with a 5-second block timeout
- Writes an `AuditLog` record to PostgreSQL on success, then `XACK`s the message
- Messages that fail 3 times are moved to `tasks:events:dlq` (dead letter queue)

## Security

- **Helmet** — sets security headers (CSP, HSTS, X-Frame-Options, etc.)
- **CORS** — configurable allowed origins
- **Body size limit** — 10 KB max request body
- **Rate limiting** — 100 req/15 min per IP globally; 10 login attempts/60 sec with 15-minute lockout on breach
- **Zod validation** — input validated and stripped at all API boundaries
- **Ownership enforcement** — all resource queries are scoped to the authenticated user; unauthorized resources return 404

## Scripts

```bash
# Root
npm run docker:up           # build and start all containers
npm run docker:down         # stop all containers
npm run docker:clean        # stop and remove volumes
npm run docker:logs         # tail all container logs
npm run docker:logs:api     # tail API logs only
npm run docker:logs:worker  # tail worker logs only
npm test                    # run API test suite
npm run test:coverage       # run tests with coverage report

# API (cd api/)
npm run dev                 # start API with nodemon

# Worker (cd worker/)
npm run dev                 # start worker consumer
npm run build               # compile TypeScript
npm start                   # run compiled worker
```

## Testing

```bash
npm test               # runs all tests once
npm run test:coverage  # generates coverage report in api/coverage/
```

Tests use Supertest against the live Express app and require a running PostgreSQL and Redis instance (or use the Docker services).

## Project Structure

```
flowboard/
├── api/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/
│   └── src/
│       ├── errors/        # AppError class
│       ├── lib/           # Redis client, Pino logger, event publisher
│       ├── middleware/    # auth, rate limiter, validation, error handler
│       ├── routes/        # auth, boards, tasks, audit-logs, health
│       ├── schemas/       # Zod validation schemas
│       ├── app.ts         # Express app setup
│       └── server.ts      # HTTP server entry point
├── worker/
│   └── src/
│       ├── lib/           # Pino logger
│       └── consumer.ts    # Redis Stream consumer loop
├── docker-compose.yml
├── Dockerfile             # API container
└── package.json           # Root scripts
```
