import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { loginSchema } from '../../schemas.js';
import { asyncHandler, authenticate } from '../middleware.js';

export function createAuthRouter({ authService, store }) {
  const router = Router();
  const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 50, standardHeaders: true, legacyHeaders: false });

  router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    res.json(await authService.login(email, password));
  }));

  router.get('/me', authenticate(authService), (req, res) => res.json({ user: req.user }));

  router.get('/directory', authenticate(authService), asyncHandler(async (_req, res) => {
    const users = await store.listUsers();
    res.json({ users: users.map(({ id, name, initials, color, role }) => ({ id, name, initials, color, role })) });
  }));

  return router;
}

