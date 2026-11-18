import pino from 'pino';
import { config } from './env.js';

export const logger = pino({
  level: config.LOG_LEVEL,
  base: { service: 'syncgrid-api' },
  redact: ['req.headers.authorization', 'token', 'password'],
});
