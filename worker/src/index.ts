import 'dotenv/config';
import Redis from 'ioredis';
import logger from './lib/logger';
import { handleTaskCreated } from './handlers/taskCreated';
import { handleTaskUpdated } from './handlers/taskUpdated';
import { handleTaskDeleted } from './handlers/taskDeleted';

const STREAM = 'tasks:events';
const GROUP = 'audit-group';
const CONSUMER = 'worker-1';
const DLQ = 'tasks:events:dlq';
const MAX_RETRIES = 3;

const redis = new Redis({
  host: process.env['REDIS_HOST'] ?? 'localhost',
  port: Number(process.env['REDIS_PORT'] ?? 6379),
});

function parseFields(fields: string[]): Record<string, string> {
  const data: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    data[fields[i]] = fields[i + 1];
  }
  return data;
}

async function ensureGroup(): Promise<void> {
  try {
    await redis.xgroup('CREATE', STREAM, GROUP, '0', 'MKSTREAM');
    logger.info({ group: GROUP, stream: STREAM }, 'Created consumer group');
  } catch (err) {
    if (!(err instanceof Error) || !err.message.includes('BUSYGROUP')) throw err;
  }
}

async function dispatch(action: string, userId: string, taskId: string): Promise<void> {
  switch (action) {
    case 'CREATED': return handleTaskCreated(userId, taskId);
    case 'UPDATED': return handleTaskUpdated(userId, taskId);
    case 'DELETED': return handleTaskDeleted(userId, taskId);
    default: logger.warn({ action }, 'Unknown action — skipping');
  }
}

async function processMessage(id: string, fields: string[]): Promise<void> {
  const data = parseFields(fields);
  await dispatch(data['action'] ?? '', data['userId'] ?? '', data['taskId'] ?? '');
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
