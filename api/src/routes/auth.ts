import { Router, Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

import { validate } from "../middleware/validation";
import { asyncHandler } from "../middleware/async-handler";
import { prisma } from "../middleware/db";
import { registerSchema, loginSchema } from "../schemas/auth.schema";

const router = Router();

const SALT_ROUNDS = 10;
const ACCESS_EXPIRY = "15m";
const REFRESH_EXPIRY = "7d";

function signTokens(userId: string, email: string) {
  const accessToken = jwt.sign(
    { userId, email },
    process.env["JWT_ACCESS_SECRET"]!,
    { expiresIn: ACCESS_EXPIRY }
  );
  const refreshToken = jwt.sign(
    { userId, email },
    process.env["JWT_REFRESH_SECRET"]!,
    { expiresIn: REFRESH_EXPIRY }
  );
  return { accessToken, refreshToken };
}

router.post("/register", validate(registerSchema), asyncHandler(async (req: Request, res: Response) => {
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

  const tokens = signTokens(user.id, user.email);
  res.status(201).json({ user: { id: user.id, email: user.email, boards: user.boards }, ...tokens });
}));

router.post("/login", validate(loginSchema), asyncHandler(async (req: Request, res: Response) => {
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

  const tokens = signTokens(user.id, user.email);
  res.json({ user: { id: user.id, email: user.email, boards: user.boards }, ...tokens });
}));

router.post("/refresh", asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    res.status(400).json({ error: { status: 400, message: "Refresh token required" } });
    return;
  }

  try {
    const payload = jwt.verify(refreshToken, process.env["JWT_REFRESH_SECRET"]!) as { userId: string; email: string };
    const tokens = signTokens(payload.userId, payload.email);
    res.json(tokens);
  } catch {
    res.status(401).json({ error: { status: 401, message: "Invalid or expired refresh token" } });
  }
}));

router.post("/logout", (_req: Request, res: Response) => {
  res.status(204).send();
});

export default router;
