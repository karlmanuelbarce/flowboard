import { z } from 'zod';

export const createBoardSchema = z.object({
  name: z.string().min(1),
});

export const updateBoardSchema = z.object({
  name: z.string().min(1).optional(),
});

export type CreateBoardInput = z.infer<typeof createBoardSchema>;
export type UpdateBoardInput = z.infer<typeof updateBoardSchema>;