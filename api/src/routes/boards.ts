import { Router, Request, Response } from "express";

const router = Router();

router.get("/", async (req: Request, res: Response) => {
  res.status(501).json({ message: "not implemented" });
});

router.post("/", async (req: Request, res: Response) => {
  res.status(501).json({ message: "not implemented" });
});

router.get("/:id", async (req: Request, res: Response) => {
  res.status(501).json({ message: "not implemented" });
});

// owner-only
router.delete("/:id", async (req: Request, res: Response) => {
  res.status(501).json({ message: "not implemented" });
});

export default router;
