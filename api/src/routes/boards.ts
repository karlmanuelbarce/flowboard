import { Router, Request, Response } from "express";
import { z } from "zod";

import { validate, validateParams } from "../middleware/validation";
import { asyncHandler } from "../middleware/async-handler";
import { authenticate } from "../middleware/authenticate";
import { prisma } from "../middleware/db";
import { createBoardSchema } from "../schemas/boards.schema";

const router = Router();
const idParamsSchema = z.object({ id: z.uuid() });

router.use(authenticate);

router.get("/", asyncHandler(async (req: Request, res: Response) => {
  const boards = await prisma.board.findMany({
    where: { ownerId: req.user!.userId },
    orderBy: { createdAt: "desc" },
  });
  res.json(boards);
}));

router.post("/", validate(createBoardSchema), asyncHandler(async (req: Request, res: Response) => {
  const { name } = req.body;
  const board = await prisma.board.create({
    data: { name, ownerId: req.user!.userId },
  });
  res.status(201).json(board);
}));

router.get("/:id", validateParams(idParamsSchema), asyncHandler(async (req: Request, res: Response) => {
  const board = await prisma.board.findFirst({
    where: { id: String(req.params.id), ownerId: req.user!.userId },
    include: { tasks: true },
  });
  if (!board) {
    res.status(404).json({ error: { status: 404, message: "Board not found" } });
    return;
  }
  res.json(board);
}));

router.delete("/:id", validateParams(idParamsSchema), asyncHandler(async (req: Request, res: Response) => {
  const board = await prisma.board.findFirst({
    where: { id: String(req.params.id), ownerId: req.user!.userId },
  });
  if (!board) {
    res.status(404).json({ error: { status: 404, message: "Board not found" } });
    return;
  }
  await prisma.board.delete({ where: { id: board.id } });
  res.status(204).send();
}));

export default router;
