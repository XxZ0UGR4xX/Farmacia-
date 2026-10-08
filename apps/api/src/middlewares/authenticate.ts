import type { RequestHandler } from 'express';
import { getAuthContext } from '../modules/auth/session-cache';
import { verifyAccessToken } from '../modules/auth/tokens';
import { AppError } from '../shared/errors';

/** Exige un access token válido (header Authorization: Bearer) y una sesión activa. */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const header = req.get('authorization');
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  if (!match?.[1]) throw AppError.unauthenticated();

  const payload = verifyAccessToken(match[1]);
  const ctx = await getAuthContext(payload.sid);
  // Sesión revocada (logout, cambio de contraseña) o usuario desactivado
  if (!ctx || ctx.userId !== payload.sub) {
    throw AppError.unauthenticated('Tu sesión ya no es válida. Inicia sesión de nuevo.', 'INVALID_TOKEN');
  }
  req.auth = ctx;
  next();
};
