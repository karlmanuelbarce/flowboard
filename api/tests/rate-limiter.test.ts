import request from 'supertest';
import { app, prisma, cleanRateLimits } from './helpers';

beforeAll(async () => {
  await cleanRateLimits();
});

afterAll(async () => {
  await cleanRateLimits();
  await prisma.$disconnect();
});

// ─── General rate limiter ────────────────────────────────────────────────────

describe('General rate limiter (rateLimiter)', () => {
  it('allows requests under the limit', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'ratelimit-check@test.com' });

    // 422 (validation error) — not 429
    expect(res.status).toBe(422);
  });
});

// ─── Login rate limiter ──────────────────────────────────────────────────────

describe('Login rate limiter (loginRateLimiter)', () => {
  beforeEach(async () => {
    await cleanRateLimits();
  });

  it('allows login attempts under the limit', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'nobody@test.com', password: 'wrong' });

    // 401 (wrong creds) — not 429
    expect(res.status).toBe(401);
  });

  it('returns 429 LOGIN_LOCKED after 10 failed attempts', async () => {
    for (let i = 0; i < 10; i++) {
      await request(app)
        .post('/auth/login')
        .send({ email: 'flood@test.com', password: 'wrong' });
    }

    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'flood@test.com', password: 'wrong' });

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('LOGIN_LOCKED');
  });

  it('continues returning 429 while lockout is active', async () => {
    for (let i = 0; i < 11; i++) {
      await request(app)
        .post('/auth/login')
        .send({ email: 'flood@test.com', password: 'wrong' });
    }

    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'flood@test.com', password: 'wrong' });

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('LOGIN_LOCKED');
  });
});
