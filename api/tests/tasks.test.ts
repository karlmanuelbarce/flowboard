import request from 'supertest';
import { app, prisma, cleanDatabase, cleanRateLimits, setupUser } from './helpers';

let tokenA: string;
let tokenB: string;
let boardId: string;
let taskId: string;

beforeAll(async () => {
  await cleanDatabase();
  await cleanRateLimits();

  const userA = await setupUser('taskuser-a@test.com');
  tokenA = userA.accessToken;

  const userB = await setupUser('taskuser-b@test.com');
  tokenB = userB.accessToken;

  const boardRes = await request(app)
    .post('/boards')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ name: 'Test Board' });

  boardId = boardRes.body.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ─── Create ──────────────────────────────────────────────────────────────────

describe('POST /tasks', () => {
  it('creates a task with valid data', async () => {
    const res = await request(app)
      .post('/tasks')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ title: 'Test Task', priority: 'HIGH', boardId });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Test Task');
    expect(res.body.priority).toBe('HIGH');

    taskId = res.body.id;
  });

  it('returns 422 when title is missing', async () => {
    const res = await request(app)
      .post('/tasks')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ priority: 'HIGH', boardId });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toBe('Validation failed');
  });

  it('returns 403 for a boardId that belongs to another user', async () => {
    const res = await request(app)
      .post('/tasks')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ title: 'Steal task', boardId });

    expect(res.status).toBe(403);
  });

  it('returns 401 without auth token', async () => {
    const res = await request(app)
      .post('/tasks')
      .send({ title: 'No auth', boardId });

    expect(res.status).toBe(401);
  });

  it('returns 401 with an invalid JWT token', async () => {
    const res = await request(app)
      .post('/tasks')
      .set('Authorization', 'Bearer not.a.valid.jwt')
      .send({ title: 'Bad token', boardId });

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid or expired token');
  });
});

// ─── List ────────────────────────────────────────────────────────────────────

describe('GET /tasks', () => {
  it('returns tasks for the authenticated user', async () => {
    const res = await request(app)
      .get('/tasks')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('does not return tasks from other users', async () => {
    const res = await request(app)
      .get('/tasks')
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('filters tasks by boardId', async () => {
    const res = await request(app)
      .get(`/tasks?boardId=${boardId}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.every((t: { boardId: string }) => t.boardId === boardId)).toBe(true);
  });
});

// ─── Get by ID ───────────────────────────────────────────────────────────────

describe('GET /tasks/:id', () => {
  it('returns the task for the owner', async () => {
    const res = await request(app)
      .get(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(taskId);
  });

  it('returns 403 for another user\'s task', async () => {
    const res = await request(app)
      .get(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(403);
  });

  it('returns 404 for a non-existent task id', async () => {
    const res = await request(app)
      .get('/tasks/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(404);
  });

  it('returns 422 for a non-UUID task id', async () => {
    const res = await request(app)
      .get('/tasks/not-a-uuid')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(422);
    expect(res.body.error.message).toBe('Validation failed');
  });
});

// ─── Update ──────────────────────────────────────────────────────────────────

describe('PATCH /tasks/:id', () => {
  it('updates the task for the owner', async () => {
    const res = await request(app)
      .patch(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ status: 'IN_PROGRESS', title: 'Updated Task' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('IN_PROGRESS');
    expect(res.body.title).toBe('Updated Task');
  });

  it('returns 403 for another user\'s task', async () => {
    const res = await request(app)
      .patch(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ status: 'DONE' });

    expect(res.status).toBe(403);
  });
});

// ─── Delete ──────────────────────────────────────────────────────────────────

describe('DELETE /tasks/:id', () => {
  it('returns 403 for another user\'s task', async () => {
    const res = await request(app)
      .delete(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(403);
  });

  it('deletes the task for the owner', async () => {
    const res = await request(app)
      .delete(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(204);
  });

  it('returns 404 after deletion', async () => {
    const res = await request(app)
      .get(`/tasks/${taskId}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(404);
  });
});
