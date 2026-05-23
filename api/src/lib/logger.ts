import pino from 'pino';

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  redact: ['req.headers.authorization', 'body.password', 'body.refreshToken'],
  transport: process.env['NODE_ENV'] === 'development'
    ? { target: 'pino-pretty' }
    : undefined,
});

export default logger;
