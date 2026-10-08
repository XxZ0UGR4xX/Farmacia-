import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { pinoHttp } from 'pino-http';
import { z } from 'zod';
import { env, trustProxySetting } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { errorHandler, notFoundHandler } from './middlewares/error-handler';
import { createRateLimiters } from './middlewares/rate-limit';
import { authRouter } from './modules/auth/auth.routes';
import { branchesRouter } from './modules/branches/branches.routes';
import { permissionsRouter, rolesRouter } from './modules/roles/roles.routes';
import { usersRouter } from './modules/users/users.routes';

// Mensajes de validación en español
z.config(z.locales.es());

export interface AppOptions {
  rateLimitEnabled?: boolean;
}

export function createApp(options: AppOptions = {}): Express {
  const app = express();
  const limiters = createRateLimiters(options.rateLimitEnabled ?? env.RATE_LIMIT_ENABLED);

  app.disable('x-powered-by');
  app.set('trust proxy', trustProxySetting());

  app.use((req, res, next) => {
    req.id = randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
  });
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).id,
      autoLogging: { ignore: (req) => req.url === '/api/health' },
    }),
  );

  // La API sólo responde JSON: CSP muy restrictiva
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  const allowedOrigins = env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || allowedOrigins.includes(origin)),
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
      exposedHeaders: ['X-Request-Id'],
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/health', async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  app.use('/api', limiters.api);
  app.use('/api/v1/auth', authRouter(limiters));
  app.use('/api/v1/users', usersRouter());
  app.use('/api/v1/roles', rolesRouter());
  app.use('/api/v1/permissions', permissionsRouter());
  app.use('/api/v1/branches', branchesRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
