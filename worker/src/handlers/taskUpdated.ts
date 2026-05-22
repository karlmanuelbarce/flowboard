import { randomUUID } from 'crypto';
import { pool } from '../lib/db';

export async function handleTaskUpdated(userId: string, taskId: string): Promise<void> {
  await pool.query(
    `INSERT INTO "AuditLog" (id, "userId", action, entity, "entityId", "createdAt")
     VALUES ($1, $2, 'UPDATED', 'Task', $3, NOW())`,
    [randomUUID(), userId, taskId],
  );
}
