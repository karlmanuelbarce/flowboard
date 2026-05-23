import request from 'supertest';
import { app, prisma, cleanDatabase, cleanRateLimits } from './helpers';

beforeAll(async () => {
  await cleanDatabase();
  await cleanRateLimits();
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ─── Register ────────────────────────────────────────────────────────────────

describe('POST /auth/register', () => {
  it('creates a new user and returns tokens', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'register@test.com', password: 'Password123!' });

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.user.email).toBe('register@test.com');
  });

  it('returns 409 for a duplicate email', async () => {
    await request(app)
      .post('/auth/register')
      .send({ email: 'duplicate@test.com', password: 'Password123!' });

    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'duplicate@test.com', password: 'Password123!' });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('Email already in use');
  });

  it('returns 422 when email is missing', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ password: 'Password123!' });

    expect(res.status).toBe(422);
  });

  it('returns 422 when password is missing', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'nopw@test.com' });

    expect(res.status).toBe(422);
  });
});

// ─── Login ───────────────────────────────────────────────────────────────────

describe('POST /auth/login', () => {
  beforeAll(async () => {
    await request(app)
      .post('/auth/register')
      .send({ email: 'login@test.com', password: 'Password123!' });
  });

  it('returns tokens with valid credentials', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'login@test.com', password: 'Password123!' });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
  });

  it('returns 401 for wrong password', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'login@test.com', password: 'WrongPassword!' });

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid credentials');
  });

  it('returns 401 for unknown email', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'nobody@test.com', password: 'Password123!' });

    expect(res.status).toBe(401);
  });
});

// ─── Refresh ─────────────────────────────────────────────────────────────────

describe('POST /auth/refresh', () => {
  let refreshToken: string;

  beforeAll(async () => {
    await request(app)
      .post('/auth/register')
      .send({ email: 'refresh@test.com', password: 'Password123!' });

    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'refresh@test.com', password: 'Password123!' });

    refreshToken = res.body.refreshToken;
  });

  it('returns new tokens with a valid refresh token', async () => {
    const res = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.refreshToken).toBeDefined();
  });

  it('returns 401 for an already-used refresh token (replay attack)', async () => {
    const loginRes = await request(app)
      .post('/auth/login')
      .send({ email: 'refresh@test.com', password: 'Password123!' });

    const token = loginRes.body.refreshToken;

    await request(app).post('/auth/refresh').send({ refreshToken: token });

    const res = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: token });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('REFRESH_TOKEN_REUSED');
  });

  it('returns 401 for an invalid token', async () => {
    const res = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: 'not.a.valid.token' });

    expect(res.status).toBe(401);
  });

  it('returns 422 when refresh token is missing', async () => {
    const res = await request(app).post('/auth/refresh').send({});
    expect(res.status).toBe(422);
  });
});

// ─── Logout ──────────────────────────────────────────────────────────────────

describe('POST /auth/logout', () => {
  it('returns 204 and invalidates the refresh token', async () => {
    await request(app)
      .post('/auth/register')
      .send({ email: 'logout@test.com', password: 'Password123!' });

    const loginRes = await request(app)
      .post('/auth/login')
      .send({ email: 'logout@test.com', password: 'Password123!' });

    const { refreshToken } = loginRes.body;

    const logoutRes = await request(app)
      .post('/auth/logout')
      .send({ refreshToken });

    expect(logoutRes.status).toBe(204);

    const refreshRes = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken });

    expect(refreshRes.status).toBe(401);
  });
});
