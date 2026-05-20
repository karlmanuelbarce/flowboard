import redis from './redis';

export interface TaskEvent {
  taskId: string;
  action: 'CREATED' | 'UPDATED' | 'DELETED';
  userId: string;
  payload: Record<string, unknown>;
}

export const publishTaskEvent = async (event: TaskEvent): Promise<void> => {
  await redis.xadd(
    'tasks:events',
    '*',
    'action',  event.action,
    'taskId',  event.taskId,
    'userId',  event.userId,
    'payload', JSON.stringify(event.payload),
    'ts',      Date.now().toString(),
  );
};
