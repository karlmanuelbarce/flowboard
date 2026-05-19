import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthPayload {
  userId: string;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: { status: 401, message: 'Unauthorized' } });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, process.env['JWT_ACCESS_SECRET']!) as AuthPayload;
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: { status: 401, message: 'Invalid or expired token' } });
  }
}
