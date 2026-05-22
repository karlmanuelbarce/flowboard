import { Request, Response, NextFunction } from 'express';
import type { ParamsDictionary } from 'express-serve-static-core';
import { ZodSchema, ZodError } from 'zod';

function formatZodError(err: ZodError, res: Response) {
  return res.status(400).json({
    error: {
      status: 400,
      message: 'Validation failed',
      details: err.issues.map(e => ({ field: e.path.join('.'), message: e.message })),
    },
  });
}

export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) return formatZodError(err, res);
      next(err);
    }
  };
}

export function validateParams(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.params = schema.parse(req.params) as ParamsDictionary;
      next();
    } catch (err) {
      if (err instanceof ZodError) return formatZodError(err, res);
      next(err);
    }
  };
}