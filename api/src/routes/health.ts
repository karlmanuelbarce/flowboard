import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "../middleware/db";
import redis from "../lib/redis";
import { AppError } from "../errors/AppError";
import { asyncHandler } from "../middleware/async-handler";

const router = Router();

router.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

router.get("/ready", asyncHandler(async (_req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    await redis.ping();
    res.json({ status: "ready", db: "ok", redis: "ok" });
  } catch (err) {
    next(new AppError("Service not ready", 503, "NOT_READY"));
  }
}));

export default router;
