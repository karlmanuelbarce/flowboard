import 'dotenv/config';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { Pool } from 'pg';

const STREAM = 'tasks:events';
const GROUP = 'audit-group';
const CONSUMER = 'worker-1';
const DLQ = 'tasks:events:dlq';
const MAX_RETRIES = 3;

const redis = new Redis({
  host: process.env['REDIS_HOST'] ?? 'localhost',
  port: Number(process.env['REDIS_PORT'] ?? 6379),
});

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });

async function ensureGroup(): Promise<void> {
  try {
    await redis.xgroup('CREATE', STREAM, GROUP, '0', 'MKSTREAM');
    console.log(`Created consumer group "${GROUP}" on stream "${STREAM}"`);
  } catch (err) {
    if (!(err instanceof Error) || !err.message.includes('BUSYGROUP')) throw err;
  }
}

function parseFields(fields: string[]): Record<string, string> {
  const data: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    data[fields[i]] = fields[i + 1];
  }
  return data;
}

async function writeAuditLog(userId: string, action: string, taskId: string): Promise<void> {
  await pool.query(
    `INSERT INTO "AuditLog" (id, "userId", action, entity, "entityId", "createdAt")
     VALUES ($1, $2, $3, 'Task', $4, NOW())`,
    [randomUUID(), userId, action, taskId],
  );
}

async function processMessage(id: string, fields: string[]): Promise<void> {
  const data = parseFields(fields);
  await writeAuditLog(data['userId'] ?? '', data['action'] ?? '', data['taskId'] ?? '');
  await redis.xack(STREAM, GROUP, id);
  console.log(`[ACK] ${id} — ${data['action']} task:${data['taskId']}`);
}

async function reapPending(): Promise<void> {
  type PendingEntry = [id: string, consumer: string, idleMs: number, deliveryCount: number];
  const pending = (await redis.xpending(STREAM, GROUP, '-', '+', 10)) as PendingEntry[];

  for (const [id, , , deliveryCount] of pending) {
    if (deliveryCount < MAX_RETRIES) continue;

    const msgs = (await redis.xrange(STREAM, id, id)) as Array<[string, string[]]>;
    if (msgs.length > 0) {
      const [, msgFields] = msgs[0];
      await redis.xadd(DLQ, '*', ...msgFields, 'originalId', id, 'failReason', 'max_retries_exceeded');
      console.warn(`[DLQ] ${id} moved after ${deliveryCount} failed attempts`);
    }
    await redis.xack(STREAM, GROUP, id);
  }
}

async function main(): Promise<void> {
  await ensureGroup();
  console.log(`Consumer "${CONSUMER}" listening on stream "${STREAM}" (group: "${GROUP}")\n`);

  for (;;) {
    try {
      await reapPending();

      type XReadResult = Array<[string, Array<[string, string[]]>]>;
      const result = (await redis.xreadgroup(
        'GROUP', GROUP, CONSUMER,
        'COUNT', '10',
        'BLOCK', '5000',
        'STREAMS', STREAM, '>',
      )) as XReadResult | null;

      if (!result) continue;

      for (const [, messages] of result) {
        for (const [id, fields] of messages) {
          try {
            await processMessage(id, fields);
          } catch (err) {
            console.error(`[ERROR] Failed to process ${id}:`, err);
          }
        }
      }
    } catch (err) {
      console.error('[CONSUMER ERROR]', err);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
