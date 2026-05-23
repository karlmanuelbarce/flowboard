import { Router, Request, Response } from "express";
import { authenticate } from "../middleware/authenticate";

const router = Router();

router.use(authenticate);

router.get("/", (_req: Request, res: Response) => {
  res.status(501).json({ message: "not implemented" });
});

export default router;
