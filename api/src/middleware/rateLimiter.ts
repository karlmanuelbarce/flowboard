import { Request, Response, NextFunction } from 'express';
import redis from '../lib/redis';
import { AppError } from '../errors/AppError';

const WINDOW_SECONDS = 15 * 60;
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

// Stricter limiter for /auth/login: 10 attempts per 60s, then 15-min lockout
const LOGIN_WINDOW_SECONDS = 60;
const LOGIN_MAX_ATTEMPTS = 10;
const LOGIN_LOCKOUT_SECONDS = 15 * 60;

export const loginRateLimiter = async (req: Request, _res: Response, next: NextFunction) => {
  const ip = req.ip ?? 'unknown';
  const lockKey = `loginLock:${ip}`;
  const countKey = `loginAttempt:${ip}`;

  const locked = await redis.get(lockKey);
  if (locked) {
    const ttl = await redis.ttl(lockKey);
    throw new AppError(
      `Too many login attempts. Try again in ${Math.ceil(ttl / 60)} minute(s).`,
      429,
      'LOGIN_LOCKED',
    );
  }

  const count = await redis.incr(countKey);
  if (count === 1) {
    await redis.expire(countKey, LOGIN_WINDOW_SECONDS);
  }

  if (count > LOGIN_MAX_ATTEMPTS) {
    await redis.set(lockKey, '1', 'EX', LOGIN_LOCKOUT_SECONDS);
    throw new AppError(
      'Too many login attempts. Try again in 15 minute(s).',
      429,
      'LOGIN_LOCKED',
    );
  }

  next();
};
