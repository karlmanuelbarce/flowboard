import request from 'supertest';
import { app, prisma, cleanDatabase, cleanRateLimits, setupUser } from './helpers';

let tokenA: string;
let tokenB: string;
let boardId: string;

beforeAll(async () => {
  await cleanDatabase();
  await cleanRateLimits();

  const userA = await setupUser('boarduser-a@test.com');
  tokenA = userA.accessToken;

  const userB = await setupUser('boarduser-b@test.com');
  tokenB = userB.accessToken;
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ─── Create ──────────────────────────────────────────────────────────────────

describe('POST /boards', () => {
  it('creates a board for the authenticated user', async () => {
    const res = await request(app)
      .post('/boards')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'My Board' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('My Board');

    boardId = res.body.id;
  });

  it('returns 401 without auth token', async () => {
    const res = await request(app).post('/boards').send({ name: 'No Auth' });
    expect(res.status).toBe(401);
  });

  it('returns 422 when name is missing', async () => {
    const res = await request(app)
      .post('/boards')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({});

    expect(res.status).toBe(422);
  });
});

// ─── List ────────────────────────────────────────────────────────────────────

describe('GET /boards', () => {
  it('returns only the authenticated user\'s boards', async () => {
    const res = await request(app)
      .get('/boards')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.every((b: { ownerId: string }) => b.ownerId !== undefined)).toBe(true);
  });

  it('does not return boards from other users', async () => {
    const res = await request(app)
      .get('/boards')
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('returns 401 without auth token', async () => {
    const res = await request(app).get('/boards');
    expect(res.status).toBe(401);
  });
});

// ─── Get by ID ───────────────────────────────────────────────────────────────

describe('GET /boards/:id', () => {
  it('returns the board with tasks for the owner', async () => {
    const res = await request(app)
      .get(`/boards/${boardId}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(boardId);
    expect(Array.isArray(res.body.tasks)).toBe(true);
  });

  it('returns 403 for another user\'s board', async () => {
    const res = await request(app)
      .get(`/boards/${boardId}`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(403);
  });

  it('returns 404 for a non-existent board id', async () => {
    const res = await request(app)
      .get('/boards/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(404);
  });
});

// ─── Delete ──────────────────────────────────────────────────────────────────

describe('DELETE /boards/:id', () => {
  it('returns 403 when another user tries to delete', async () => {
    const res = await request(app)
      .delete(`/boards/${boardId}`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(403);
  });

  it('deletes the board for the owner', async () => {
    const res = await request(app)
      .delete(`/boards/${boardId}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(204);
  });
});
