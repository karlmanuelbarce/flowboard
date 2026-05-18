import { Router, Request, Response } from "express";

const router = Router();

// owner-only
router.get("/", async (req: Request, res: Response) => {
  res.status(501).json({ message: "not implemented" });
});

export default router;
