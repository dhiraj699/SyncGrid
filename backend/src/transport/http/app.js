import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { createCorsOriginMatcher } from '../../config/cors.js';
import { createErrorHandler } from './middleware.js';
import { createAuthRouter } from './routes/auth.routes.js';
import { createSheetsRouter } from './routes/sheets.routes.js';

export function createApp({ config, authService, registry, history, store, logger }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  const corsOrigin = createCorsOriginMatcher(config.CORS_ORIGIN || config.CLIENT_ORIGIN, config.NODE_ENV === 'production');
  app.use(cors({ origin: corsOrigin, credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: '100kb' }));

  app.get('/healthz', (_req, res) => res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) }));
  app.use('/api/auth', createAuthRouter({ authService, store }));
  app.use('/api/sheets', createSheetsRouter({ authService, registry, history, store }));
  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));
  app.use(createErrorHandler(logger));
  return app;
}
