// src/validate.ts
import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
 
export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({
          error: {
            status: 400,
            message: 'Validation failed',
            details: err.issues.map(e => ({
              field: e.path.join('.'),
              message: e.message
            }))
          }
        });
      }
      next(err);
    }
  };
}