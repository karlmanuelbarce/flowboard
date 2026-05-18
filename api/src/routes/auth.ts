import { Router, Request, Response } from "express";

const router = Router();

router.post("/register", async (req: Request, res: Response) => {
  res.status(501).json({ message: "not implemented" });
});

router.post("/login", async (req: Request, res: Response) => {
  res.status(501).json({ message: "not implemented" });
});

router.post("/refresh", async (req: Request, res: Response) => {
  res.status(501).json({ message: "not implemented" });
});

router.post("/logout", async (req: Request, res: Response) => {
  res.status(501).json({ message: "not implemented" });
});

export default router;
