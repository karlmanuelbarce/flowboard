//Express app setup — middleware stack, route mounting, global error handler
import express, { Request, Response, NextFunction } from 'express';
import authRouter from './routes/auth';
import boardsRouter from './routes/boards';
import tasksRouter from './routes/tasks';
import auditLogsRouter from './routes/audit-logs';
import healthRouter from './routes/health';

const app = express();

app.use(express.json()); // Built-in middleware for parsing JSON bodies

app.use(healthRouter);
app.use('/auth', authRouter);
app.use('/boards', boardsRouter);
app.use('/tasks', tasksRouter);
app.use('/audit-logs', auditLogsRouter);

// Global error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: { status: 500, message: 'Internal server error' } });
});

export default app;