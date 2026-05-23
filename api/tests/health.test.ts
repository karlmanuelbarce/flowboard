import request from 'supertest';
import logger from '../src/lib/logger';
import { app, prisma, redis } from './helpers';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Redis error handler', () => {
  it('logs redis connection errors without crashing', () => {
    const spy = jest.spyOn(logger, 'error').mockImplementation(() => logger);
    redis.emit('error', new Error('test connection error'));
    expect(spy).toHaveBeenCalledWith({ err: expect.any(Error) }, 'Redis error');
    spy.mockRestore();
  });
});

describe('Body size limit', () => {
  it('returns 413 when request body exceeds 10kb', async () => {
    const res = await request(app)
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: 'a'.repeat(11_000) }));

    expect(res.status).toBe(413);
  });
});

describe('GET /health', () => {
  it('returns ok with uptime', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.uptime).toBe('number');
  });
});

describe('GET /ready', () => {
  it('returns ready when db and redis are reachable', async () => {
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.db).toBe('ok');
    expect(res.body.redis).toBe('ok');
  });

  it('returns 503 when Redis is unavailable', async () => {
    jest.spyOn(redis, 'ping').mockRejectedValueOnce(new Error('Redis down'));

    const res = await request(app).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('NOT_READY');

    jest.restoreAllMocks();
  });

  it('returns 503 when PostgreSQL is unavailable', async () => {
    jest.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('DB down'));

    const res = await request(app).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('NOT_READY');

    jest.restoreAllMocks();
  });
});
