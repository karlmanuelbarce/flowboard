import request from 'supertest';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import redis from '../src/lib/redis';

export { app, prisma, redis };

export async function cleanDatabase() {
  await prisma.auditLog.deleteMany();
  await prisma.task.deleteMany();
  await prisma.board.deleteMany();
  await prisma.user.deleteMany();
}

export async function waitForRedis() {
  if (redis.status === 'ready') return;
  await new Promise<void>((resolve, reject) => {
    redis.once('ready', resolve);
    redis.once('error', reject);
  });
}

export async function cleanRateLimits() {
  await waitForRedis();
  const patterns = ['rate:*', 'loginAttempt:*', 'loginLock:*'];
  for (const pattern of patterns) {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) await redis.del(...keys);
  }
}

export async function registerUser(email: string, password: string) {
  return request(app).post('/auth/register').send({ email, password });
}

export async function loginUser(email: string, password: string) {
  const res = await request(app).post('/auth/login').send({ email, password });
  return res.body as { accessToken: string; refreshToken: string };
}

export async function setupUser(email = 'user@test.com', password = 'Password123!') {
  await registerUser(email, password);
  return loginUser(email, password);
}
