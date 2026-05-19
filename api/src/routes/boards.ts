import { Router, Request, Response } from "express";

import { validate } from "../middleware/validation";
import { asyncHandler } from "../middleware/async-handler";
import { authenticate } from "../middleware/authenticate";
import { prisma } from "../middleware/db";
import { createBoardSchema } from "../schemas/boards.schema";

const router = Router();

router.use(authenticate);

router.get("/", asyncHandler(async (req: Request, res: Response) => {
  const boards = await prisma.board.findMany({
    orderBy: { createdAt: "desc" },
  });
  res.json(boards);
}));

router.post("/", validate(createBoardSchema), asyncHandler(async (req: Request, res: Response) => {
  const board = await prisma.board.create({
    data: { ...req.body, ownerId: req.user!.userId },
  });
  res.status(201).json(board);
}));

router.get("/:id", asyncHandler(async (req: Request, res: Response) => {
  const board = await prisma.board.findUnique({
    where: { id: req.params.id as string },
    include: { tasks: true },
  });
  if (!board) {
    res.status(404).json({ error: { status: 404, message: "Board not found" } });
    return;
  }
  res.json(board);
}));

// owner-only
router.delete("/:id", asyncHandler(async (req: Request, res: Response) => {
  await prisma.board.delete({ where: { id: req.params.id as string } });
  res.status(204).send();
}));

export default router;
