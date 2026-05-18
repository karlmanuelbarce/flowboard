import { Router, Request, Response } from "express";
import { z } from "zod";

import { validate } from "../middleware/validation";
import { asyncHandler } from "../middleware/async-handler";
import { prisma } from "../middleware/db";
import { createTaskSchema, updateTaskSchema } from "../schemas/task.schema";

const router = Router();

router.get("/", asyncHandler(async (req: Request, res: Response) => {
  const { boardId } = req.query;
  const tasks = await prisma.task.findMany({
    where: boardId ? { boardId: String(boardId) } : undefined,
    orderBy: { createdAt: "desc" },
  });
  res.json(tasks);
}));

router.post("/", validate(createTaskSchema), asyncHandler(async (req: Request, res: Response) => {
  const task = await prisma.task.create({ data: req.body });
  res.status(201).json(task);
}));

router.get("/:id", asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const task = await prisma.task.findUnique({ where: { id } });
  if (!task) {
    res.status(404).json({ error: { status: 404, message: "Task not found" } });
    return;
  }
  res.json(task);
}));

router.patch("/:id", validate(updateTaskSchema), asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const task = await prisma.task.update({
    where: { id },
    data: req.body,
  });
  res.json(task);
}));

router.delete("/:id", asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  await prisma.task.delete({ where: { id } });
  res.status(204).send();
}));

export default router;
