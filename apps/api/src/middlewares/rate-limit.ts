import type { Request, RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { AppError } from '../shared/errors';

interface LimiterOptions {
  windowMs: number;
  limit: number;
  message: string;
  key?: (req: Request) => string;
}

function createLimiter(enabled: boolean, opts: LimiterOptions): RequestHandler {
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => !enabled,
    keyGenerator: opts.key ?? ((req) => ipKeyGenerator(req.ip ?? '')),
    handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', opts.message)),
  });
}

export interface RateLimiters {
  api: RequestHandler;
  login: RequestHandler;
  loginPerIp: RequestHandler;
  passwordReset: RequestHandler;
  refresh: RequestHandler;
}

/** Se crean por instancia de app (cada prueba tiene contadores independientes). */
export function createRateLimiters(enabled: boolean): RateLimiters {
  const minute = 60_000;
  return {
    api: createLimiter(enabled, {
      windowMs: minute,
      limit: 600,
      message: 'Demasiadas solicitudes. Espera un momento.',
    }),
    // Por IP + correo: frena ataques dirigidos a una cuenta
    login: createLimiter(enabled, {
      windowMs: 15 * minute,
      limit: 10,
      message: 'Demasiados intentos de inicio de sesión. Intenta más tarde.',
      key: (req) => {
        const email: unknown = (req.body as { email?: unknown } | undefined)?.email;
        const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
        return `${ipKeyGenerator(req.ip ?? '')}|${normalized}`;
      },
    }),
    // Por IP: frena ataques que prueban muchos correos
    loginPerIp: createLimiter(enabled, {
      windowMs: 15 * minute,
      limit: 50,
      message: 'Demasiados intentos de inicio de sesión. Intenta más tarde.',
    }),
    passwordReset: createLimiter(enabled, {
      windowMs: 60 * minute,
      limit: 5,
      message: 'Demasiadas solicitudes de recuperación. Intenta más tarde.',
    }),
    refresh: createLimiter(enabled, {
      windowMs: minute,
      limit: 60,
      message: 'Demasiadas solicitudes. Espera un momento.',
    }),
  };
}
