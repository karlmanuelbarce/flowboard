# Flowboard AI Context

## Worker: Redis Stream & Dead-Letter Queue

### Stream

| Key | Value |
|---|---|
| Stream name | `tasks:events` |
| Consumer group | `audit-group` |
| Consumer name | `worker-1` |

### Event message fields

Each message published via `publishTaskEvent()` (`api/src/lib/events.ts`) contains these flat string fields:

| Field | Type | Description |
|---|---|---|
| `action` | `CREATED` \| `UPDATED` \| `DELETED` | Task lifecycle event |
| `taskId` | UUID string | ID of the affected task |
| `userId` | UUID string | ID of the user who triggered the action |
| `payload` | JSON string | Full task object snapshot at the time of the event |
| `ts` | Unix ms string | Timestamp of publish |

### Dead-Letter Queue (DLQ)

| Key | Value |
|---|---|
| DLQ stream key | `tasks:events:dlq` |
| Max retries before DLQ | 3 (`MAX_RETRIES` in `worker/src/index.ts`) |

A message is moved to the DLQ when `XPENDING` reports `deliveryCount >= 3`. The DLQ entry is written with `XADD tasks:events:dlq * ...originalFields originalId <id> failReason max_retries_exceeded`.

#### DLQ entry fields

All original message fields are preserved, plus:

| Field | Value |
|---|---|
| `originalId` | The Redis Stream message ID from `tasks:events` |
| `failReason` | Always `max_retries_exceeded` |

After writing to the DLQ, the original message is acknowledged (`XACK`) so it does not reappear in the pending list.

### Inspecting via Redis CLI

```bash
# View pending messages
XPENDING tasks:events audit-group - + 10

# View DLQ contents
XRANGE tasks:events:dlq - +

# Confirm consumer group exists
XINFO GROUPS tasks:events
```

### AuditLog schema

Written to PostgreSQL by the worker handlers (`worker/src/handlers/`). One row per processed event:

| Column | Description |
|---|---|
| `id` | UUID primary key |
| `action` | `CREATED`, `UPDATED`, or `DELETED` |
| `entity` | Entity type — always `Task` |
| `entityId` | UUID of the affected task |
| `userId` | UUID of the user |
| `createdAt` | Timestamp of the audit log entry |
