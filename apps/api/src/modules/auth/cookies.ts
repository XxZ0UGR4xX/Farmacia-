import type { CookieOptions, Response } from 'express';
import { env } from '../../config/env';
import { generateToken } from '../../lib/crypto';

export const REFRESH_COOKIE = 'rt';
export const CSRF_COOKIE = 'csrf_token';
export const CSRF_HEADER = 'x-csrf-token';

/** El refresh token sólo viaja a los endpoints de autenticación. */
const REFRESH_COOKIE_PATH = '/api/v1/auth';

function baseOptions(): CookieOptions {
  return { secure: env.COOKIE_SECURE, sameSite: 'strict' };
}

/**
 * Emite la cookie del refresh token (httpOnly) y la cookie CSRF (legible por JS
 * para el patrón "double submit"). Sin "Recordarme" son cookies de sesión.
 */
export function setAuthCookies(
  res: Response,
  refreshToken: string,
  rememberMe: boolean,
  sessionExpiresAt: Date,
): void {
  const persistence: CookieOptions = rememberMe
    ? { maxAge: Math.max(0, sessionExpiresAt.getTime() - Date.now()) }
    : {};

  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...baseOptions(),
    ...persistence,
    httpOnly: true,
    path: REFRESH_COOKIE_PATH,
  });
  res.cookie(CSRF_COOKIE, generateToken(24), {
    ...baseOptions(),
    ...persistence,
    httpOnly: false,
    path: '/',
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { ...baseOptions(), httpOnly: true, path: REFRESH_COOKIE_PATH });
  res.clearCookie(CSRF_COOKIE, { ...baseOptions(), path: '/' });
}
