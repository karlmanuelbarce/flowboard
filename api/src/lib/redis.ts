import 'dotenv/config';
import Redis from 'ioredis';
import logger from './logger';

const redis = new Redis({
  host: process.env['REDIS_HOST'] ?? 'redis',
  port: Number(process.env['REDIS_PORT'] ?? 6379),
  enableOfflineQueue: false,
});

redis.on('error', (err: Error) => logger.error({ err }, 'Redis error'));

export default redis;
