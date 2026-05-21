import request from 'supertest';
import { app, prisma, cleanRateLimits } from './helpers';

beforeAll(async () => {
  await cleanRateLimits();
});

afterAll(async () => {
  await cleanRateLimits();
  await prisma.$disconnect();
});

describe('Rate Limiter', () => {
  it('allows requests under the limit', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'anyone@test.com', password: 'anything' });

    // 401 (wrong creds) — not 429 (rate limited)
    expect(res.status).toBe(401);
  });

  it('returns 429 after exceeding 100 requests', async () => {
    await cleanRateLimits();

    // Send 100 requests to exhaust the limit
    for (let i = 0; i < 100; i++) {
      await request(app)
        .post('/auth/login')
        .send({ email: 'flood@test.com', password: 'wrong' });
    }

    // The 101st should be rate limited
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'flood@test.com', password: 'wrong' });

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  }, 60000); // 60s timeout — 101 sequential requests
});
