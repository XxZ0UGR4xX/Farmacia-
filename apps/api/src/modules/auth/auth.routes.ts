import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { requireCsrf } from '../../middlewares/csrf';
import type { RateLimiters } from '../../middlewares/rate-limit';
import * as controller from './auth.controller';

export function authRouter(limiters: RateLimiters): Router {
  const router = Router();

  router.post('/login', limiters.loginPerIp, limiters.login, controller.login);
  // Endpoints autenticados por cookie: requieren token CSRF
  router.post('/refresh', limiters.refresh, requireCsrf, controller.refresh);
  router.post('/logout', requireCsrf, controller.logout);

  router.post('/forgot-password', limiters.passwordReset, controller.forgotPassword);
  router.post('/reset-password', limiters.passwordReset, controller.resetPassword);

  router.get('/me', authenticate, controller.me);
  router.post('/change-password', authenticate, controller.changePassword);

  return router;
}
