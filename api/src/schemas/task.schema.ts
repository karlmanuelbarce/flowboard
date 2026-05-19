import { z } from 'zod';

const TaskStatus = z.enum(['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE']);
const Priority = z.enum(['LOW', 'MEDIUM', 'HIGH']);

export const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  status: TaskStatus.default('TODO'),
  priority: Priority.default('MEDIUM'),
  boardId: z.string().uuid(),
});

export const updateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  status: TaskStatus.optional(),
  priority: Priority.optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
