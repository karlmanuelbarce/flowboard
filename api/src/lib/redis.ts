import 'dotenv/config';
import Redis from 'ioredis';

const redis = new Redis({
  host: process.env['REDIS_HOST'] ?? 'redis',
  port: Number(process.env['REDIS_PORT'] ?? 6379),
  enableOfflineQueue: false,
});

redis.on('error', (err: Error) => console.error('Redis error:', err));

export default redis;
