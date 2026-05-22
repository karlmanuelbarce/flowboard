import { Router, Request, Response } from "express";
import { z } from "zod";

import { validate, validateParams } from "../middleware/validation";
import { asyncHandler } from "../middleware/async-handler";
import { authenticate } from "../middleware/authenticate";
import { prisma } from "../middleware/db";
import { publishTaskEvent } from "../lib/events";
import { createTaskSchema, updateTaskSchema } from "../schemas/task.schema";

const router = Router();
const idParamsSchema = z.object({ id: z.uuid() });

router.use(authenticate);

router.get("/", asyncHandler(async (req: Request, res: Response) => {
  const { boardId } = req.query;
  const tasks = await prisma.task.findMany({
    where: {
      board: { ownerId: req.user!.userId },
      ...(boardId ? { boardId: String(boardId) } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(tasks);
}));

router.post("/", validate(createTaskSchema), asyncHandler(async (req: Request, res: Response) => {
  const { title, description, status, priority, boardId } = req.body;

  const board = await prisma.board.findFirst({
    where: { id: boardId, ownerId: req.user!.userId },
  });
  if (!board) {
    res.status(404).json({ error: { status: 404, message: "Board not found" } });
    return;
  }

  const task = await prisma.task.create({ data: { title, description, status, priority, boardId } });
  await publishTaskEvent({ taskId: task.id, action: 'CREATED', userId: req.user!.userId, payload: task as Record<string, unknown> });
  res.status(201).json(task);
}));

router.get("/:id", validateParams(idParamsSchema), asyncHandler(async (req: Request, res: Response) => {
  const task = await prisma.task.findFirst({
    where: { id: String(req.params.id), board: { ownerId: req.user!.userId } },
  });
  if (!task) {
    res.status(404).json({ error: { status: 404, message: "Task not found" } });
    return;
  }
  res.json(task);
}));

router.patch("/:id", validateParams(idParamsSchema), validate(updateTaskSchema), asyncHandler(async (req: Request, res: Response) => {
  const existing = await prisma.task.findFirst({
    where: { id: String(req.params.id), board: { ownerId: req.user!.userId } },
  });
  if (!existing) {
    res.status(404).json({ error: { status: 404, message: "Task not found" } });
    return;
  }

  const { title, description, status, priority } = req.body;
  const task = await prisma.task.update({ where: { id: existing.id }, data: { title, description, status, priority } });
  await publishTaskEvent({ taskId: task.id, action: 'UPDATED', userId: req.user!.userId, payload: task as Record<string, unknown> });
  res.json(task);
}));

router.delete("/:id", validateParams(idParamsSchema), asyncHandler(async (req: Request, res: Response) => {
  const existing = await prisma.task.findFirst({
    where: { id: String(req.params.id), board: { ownerId: req.user!.userId } },
  });
  if (!existing) {
    res.status(404).json({ error: { status: 404, message: "Task not found" } });
    return;
  }
  await prisma.task.delete({ where: { id: existing.id } });
  await publishTaskEvent({ taskId: existing.id, action: 'DELETED', userId: req.user!.userId, payload: { id: existing.id } });
  res.status(204).send();
}));

export default router;
