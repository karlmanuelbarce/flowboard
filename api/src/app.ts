import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';
import logger from './lib/logger';
import { AppError } from './errors/AppError';
import authRouter from './routes/auth';
import boardsRouter from './routes/boards';
import tasksRouter from './routes/tasks';
import auditLogsRouter from './routes/audit-logs';
import healthRouter from './routes/health';

const app = express();

// Trust proxy headers for correct IP detection behind Nginx/load balancer
app.set('trust proxy', 1);

// Security headers (X-Content-Type-Options, X-Frame-Options, etc.)
app.use(helmet());

// CORS — only allow configured origins
app.use(cors({
  origin: process.env['ALLOWED_ORIGINS']?.split(',') ?? ['http://localhost:3000'],
  credentials: true,
}));

// Body size limit — prevent large-payload DoS
app.use(express.json({ limit: '10kb' }));

// Structured request logging — method, path, status, duration
app.use(pinoHttp({ logger }));

app.use(healthRouter);
app.use('/auth', authRouter);
app.use('/boards', boardsRouter);
app.use('/tasks', tasksRouter);
app.use('/audit-logs', auditLogsRouter);

// Global error handler — no stack traces exposed in production
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: { status: err.statusCode, message: err.message, code: err.code } });
    return;
  }
  if (process.env['NODE_ENV'] !== 'production') {
    logger.error(err);
  }
  res.status(500).json({ error: { status: 500, message: 'Internal server error' } });
});

export default app;