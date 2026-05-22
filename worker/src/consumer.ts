import 'dotenv/config';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { Pool } from 'pg';
import logger from './lib/logger';

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
    logger.info({ group: GROUP, stream: STREAM }, 'Created consumer group');
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
  logger.info({ messageId: id, action: data['action'], taskId: data['taskId'] }, 'Message processed');
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
      logger.warn({ messageId: id, deliveryCount, dlq: DLQ }, 'Message moved to DLQ');
    }
    await redis.xack(STREAM, GROUP, id);
  }
}

async function main(): Promise<void> {
  await ensureGroup();
  logger.info({ consumer: CONSUMER, stream: STREAM, group: GROUP }, 'Worker listening');

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
            logger.error({ err, messageId: id }, 'Failed to process message');
          }
        }
      }
    } catch (err) {
      logger.error({ err }, 'Consumer loop error');
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

main().catch((err) => {
  logger.error({ err }, 'Fatal worker error');
  process.exit(1);
});
