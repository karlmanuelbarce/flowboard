import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

import { validate } from "../middleware/validation";
import { asyncHandler } from "../middleware/async-handler";
import { rateLimiter, loginRateLimiter } from "../middleware/rateLimiter";
import { prisma } from "../middleware/db";
import redis from "../lib/redis";
import { AppError } from "../errors/AppError";
import { registerSchema, loginSchema } from "../schemas/auth.schema";

const router = Router();

const SALT_ROUNDS = 12;
const ACCESS_EXPIRY = "15m";
const REFRESH_EXPIRY = "7d";
const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;

async function signTokens(userId: string, email: string) {
  const tokenId = randomUUID();

  const accessToken = jwt.sign(
    { userId, email },
    process.env["JWT_ACCESS_SECRET"]!,
    { expiresIn: ACCESS_EXPIRY }
  );

  const refreshToken = jwt.sign(
    { userId, email, tokenId },
    process.env["JWT_REFRESH_SECRET"]!,
    { expiresIn: REFRESH_EXPIRY }
  );

  await redis.set(`refresh:${userId}:${tokenId}`, "1", "EX", REFRESH_TTL_SECONDS);

  return { accessToken, refreshToken };
}

router.post("/register", asyncHandler(rateLimiter), validate(registerSchema), asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    res.status(409).json({ error: { status: 409, message: "Email already in use" } });
    return;
  }

  const hashed = await bcrypt.hash(password, SALT_ROUNDS);
  const user = await prisma.user.create({
    data: { email, password: hashed },
    include: { boards: true },
  });

  const tokens = await signTokens(user.id, user.email);
  res.status(201).json({ user: { id: user.id, email: user.email, boards: user.boards }, ...tokens });
}));

router.post("/login", asyncHandler(loginRateLimiter), validate(loginSchema), asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;

  const user = await prisma.user.findUnique({
    where: { email },
    include: { boards: true },
  });
  if (!user) {
    res.status(401).json({ error: { status: 401, message: "Invalid credentials" } });
    return;
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    res.status(401).json({ error: { status: 401, message: "Invalid credentials" } });
    return;
  }

  const tokens = await signTokens(user.id, user.email);
  res.json({ user: { id: user.id, email: user.email, boards: user.boards }, ...tokens });
}));

router.post("/refresh", asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    throw new AppError("Refresh token required", 400, "MISSING_REFRESH_TOKEN");
  }

  let payload: { userId: string; email: string; tokenId: string };
  try {
    payload = jwt.verify(refreshToken, process.env["JWT_REFRESH_SECRET"]!) as typeof payload;
  } catch {
    throw new AppError("Invalid or expired refresh token", 401, "INVALID_REFRESH_TOKEN");
  }

  const { userId, email, tokenId } = payload;
  const key = `refresh:${userId}:${tokenId}`;

  const exists = await redis.get(key);
  if (!exists) {
    // Token already used or never issued — possible replay attack
    throw new AppError("Refresh token not found or already used", 401, "REFRESH_TOKEN_REUSED");
  }

  await redis.del(key);

  const tokens = await signTokens(userId, email);
  res.json({ success: true, data: tokens });
}));

router.post("/logout", asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = req.body;

  if (refreshToken) {
    try {
      const payload = jwt.verify(refreshToken, process.env["JWT_REFRESH_SECRET"]!) as { userId: string; tokenId: string };
      await redis.del(`refresh:${payload.userId}:${payload.tokenId}`);
    } catch {
      // Invalid token — nothing to delete
    }
  }

  res.status(204).send();
}));

export default router;
