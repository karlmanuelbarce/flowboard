import { randomUUID } from 'crypto';
import request from 'supertest';
import { app, prisma, cleanDatabase, cleanRateLimits, setupUser } from './helpers';

let token: string;
let userId: string;

beforeAll(async () => {
  await cleanDatabase();
  await cleanRateLimits();

  const { accessToken } = await setupUser('audituser@test.com');
  token = accessToken;

  const user = await prisma.user.findUnique({ where: { email: 'audituser@test.com' } });
  userId = user!.id;

  await prisma.auditLog.createMany({
    data: [
      { id: randomUUID(), action: 'CREATED', entity: 'Task', entityId: randomUUID(), userId },
      { id: randomUUID(), action: 'UPDATED', entity: 'Task', entityId: randomUUID(), userId },
    ],
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET /audit-logs', () => {
  it('returns audit logs for the authenticated user', async () => {
    const res = await request(app)
      .get('/audit-logs')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(2);
    expect(res.body.every((log: { userId: string }) => log.userId === userId)).toBe(true);
  });

  it('does not return audit logs from other users', async () => {
    const otherUser = await setupUser('other-audituser@test.com');
    const res = await request(app)
      .get('/audit-logs')
      .set('Authorization', `Bearer ${otherUser.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('returns 401 without an auth token', async () => {
    const res = await request(app).get('/audit-logs');
    expect(res.status).toBe(401);
  });

  it('returns 401 with an invalid token', async () => {
    const res = await request(app)
      .get('/audit-logs')
      .set('Authorization', 'Bearer not.a.valid.jwt');

    expect(res.status).toBe(401);
  });
});
