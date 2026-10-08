import type { RequestHandler } from 'express';
import { safeEqual } from '../lib/crypto';
import { CSRF_COOKIE, CSRF_HEADER } from '../modules/auth/cookies';
import { AppError } from '../shared/errors';

/**
 * Protección CSRF (double submit cookie) para endpoints autenticados por cookie.
 * Un sitio externo no puede leer la cookie csrf_token, por lo que no puede
 * replicarla en el header.
 */
export const requireCsrf: RequestHandler = (req, _res, next) => {
  const cookie: unknown = req.cookies?.[CSRF_COOKIE];
  const header = req.get(CSRF_HEADER);
  if (typeof cookie !== 'string' || !cookie || !header || !safeEqual(cookie, header)) {
    throw new AppError(403, 'CSRF_INVALID', 'Solicitud no válida. Recarga la página e intenta de nuevo.');
  }
  next();
};
