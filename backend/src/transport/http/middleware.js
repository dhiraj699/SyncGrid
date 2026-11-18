import { ZodError } from 'zod';
import { can } from '../../domain/access.js';
import { SheetNotFoundError } from '../../engine/sheetSession.js';
import { HttpError } from './httpError.js';

export const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

export const authenticate = (authService) =>
  asyncHandler(async (req, _res, next) => {
    const header = req.headers.authorization ?? '';
    req.user = await authService.authenticate(header.startsWith('Bearer ') ? header.slice(7) : null);
    next();
  });

export const requirePermission = (permission) => (req, _res, next) =>
  can(req.user.role, permission) ? next() : next(new HttpError(403, 'FORBIDDEN', 'Your role does not allow this action'));

export const createErrorHandler = (logger) => (error, _req, res, _next) => {
  if (error instanceof ZodError) return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid request', details: error.flatten() } });
  if (error instanceof SheetNotFoundError) return res.status(404).json({ error: { code: error.code, message: error.message } });
  if (error instanceof HttpError) return res.status(error.status).json({ error: { code: error.code, message: error.message } });
  logger.error({ err: error }, 'unhandled request error');
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' } });
};
