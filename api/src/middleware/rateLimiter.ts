import { Request, Response, NextFunction } from 'express';
import redis from '../lib/redis';
import { AppError } from '../errors/AppError';

const WINDOW_SECONDS = 15 * 60; // 15 minutes
const MAX_REQUESTS = 100;

export const rateLimiter = async (req: Request, res: Response, next: NextFunction) => {
  const ip = req.ip ?? 'unknown';
  const key = `rate:${ip}`;

  const count = await redis.incr(key);

  if (count === 1) {
    await redis.expire(key, WINDOW_SECONDS);
  }

  if (count > MAX_REQUESTS) {
    throw new AppError('Too many requests', 429, 'RATE_LIMIT_EXCEEDED');
  }

  next();
};
