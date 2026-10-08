import type { Request, Response } from 'express';
import { AppError } from '../../shared/errors';
import { clientInfo, requireAuth } from '../../shared/request-context';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
} from './auth.schemas';
import * as authService from './auth.service';
import { clearAuthCookies, REFRESH_COOKIE, setAuthCookies } from './cookies';

function sendSession(res: Response, session: authService.IssuedSession): void {
  setAuthCookies(res, session.refreshToken, session.rememberMe, session.sessionExpiresAt);
  // El refresh token NUNCA viaja en el cuerpo: sólo en la cookie httpOnly
  res.json({
    accessToken: session.accessToken,
    expiresIn: session.accessTokenExpiresIn,
    user: session.user,
  });
}

function refreshCookie(req: Request): string | undefined {
  const value: unknown = req.cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' && value ? value : undefined;
}

export async function login(req: Request, res: Response) {
  const dto = loginSchema.parse(req.body);
  sendSession(res, await authService.login(dto, clientInfo(req)));
}

export async function refresh(req: Request, res: Response) {
  try {
    sendSession(res, await authService.refresh(refreshCookie(req), clientInfo(req)));
  } catch (err) {
    // En carrera entre pestañas la cookie vigente es válida: no borrarla
    if (!(err instanceof AppError && err.code === 'REFRESH_RACE')) clearAuthCookies(res);
    throw err;
  }
}

export async function logout(req: Request, res: Response) {
  await authService.logout(refreshCookie(req), clientInfo(req));
  clearAuthCookies(res);
  res.status(204).end();
}

export async function me(req: Request, res: Response) {
  res.json({ user: await authService.getProfile(requireAuth(req).userId) });
}

const GENERIC_RESET_MESSAGE =
  'Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.';

export async function forgotPassword(req: Request, res: Response) {
  const dto = forgotPasswordSchema.parse(req.body);
  await authService.requestPasswordReset(dto, clientInfo(req));
  res.status(202).json({ message: GENERIC_RESET_MESSAGE });
}

export async function resetPassword(req: Request, res: Response) {
  const dto = resetPasswordSchema.parse(req.body);
  await authService.resetPassword(dto, clientInfo(req));
  res.json({ message: 'Contraseña actualizada. Ya puedes iniciar sesión.' });
}

export async function changePassword(req: Request, res: Response) {
  const dto = changePasswordSchema.parse(req.body);
  await authService.changePassword(requireAuth(req), dto, clientInfo(req));
  res.json({ message: 'Contraseña actualizada. Se cerraron tus otras sesiones.' });
}
