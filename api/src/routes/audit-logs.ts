import { Router, Request, Response } from "express";
import { authenticate } from "../middleware/authenticate";
import { asyncHandler } from "../middleware/async-handler";
import { prisma } from "../middleware/db";

const router = Router();

router.use(authenticate);

router.get("/", asyncHandler(async (req: Request, res: Response) => {
  const logs = await prisma.auditLog.findMany({
    where: { userId: req.user!.userId },
    orderBy: { createdAt: "desc" },
  });
  res.json(logs);
}));

export default router;
