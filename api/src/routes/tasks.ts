import { Router, Request, Response } from "express";

import { validate } from "../middleware/validation";
import { asyncHandler } from "../middleware/async-handler";
import { authenticate } from "../middleware/authenticate";
import { prisma } from "../middleware/db";
import { createTaskSchema, updateTaskSchema } from "../schemas/task.schema";

const router = Router();

router.use(authenticate);

function auditLog(userId: string, action: string, entityId: string) {
  return prisma.auditLog.create({
    data: { userId, action, entity: "Task", entityId },
  });
}

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
  await auditLog(req.user!.userId, "CREATE", task.id);
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
  const task = await prisma.task.update({ where: { id }, data: req.body });
  await auditLog(req.user!.userId, "UPDATE", task.id);
  res.json(task);
}));

router.delete("/:id", asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  await prisma.task.delete({ where: { id } });
  await auditLog(req.user!.userId, "DELETE", id);
  res.status(204).send();
}));

export default router;
