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
import { catalogRouter } from './modules/catalogs/catalogs.routes';
import { inventoryRouter } from './modules/inventory/inventory.routes';
import { UPLOADS_URL_PREFIX, uploadsRoot } from './modules/products/product-images';
import { refreshAlertsAfterChanges } from './modules/notifications/alerts.service';
import { notificationsRouter } from './modules/notifications/notifications.routes';
import { patientsRouter, prescriptionsRouter } from './modules/patients/patients.routes';
import { productsRouter } from './modules/products/products.routes';
import { purchasesRouter } from './modules/purchases/purchases.routes';
import { returnsRouter, salesRouter } from './modules/sales/sales.routes';
import { settingsRouter } from './modules/settings/settings.routes';
import { suppliersRouter } from './modules/suppliers/suppliers.routes';
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
      serializers: {
        // Datos personales fuera de la bitácora: en pacientes y recetas no se registra la búsqueda
        req(req: { url?: string; query?: unknown; params?: unknown }) {
          if (req.url && /^\/api\/v1\/(patients|prescriptions)/.test(req.url)) {
            return { ...req, url: req.url.split('?')[0], query: undefined };
          }
          return req;
        },
      },
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
      allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Branch-Id'],
      exposedHeaders: ['X-Request-Id'],
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/health', async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // Imágenes de productos (no sensibles). Nombres impredecibles; sin listado de carpetas.
  app.use(
    UPLOADS_URL_PREFIX,
    express.static(uploadsRoot(), { index: false, dotfiles: 'deny', maxAge: '30d', immutable: true }),
  );

  app.use('/api', limiters.api);
  app.use('/api/v1/auth', authRouter(limiters));
  app.use('/api/v1/users', usersRouter());
  app.use('/api/v1/roles', rolesRouter());
  app.use('/api/v1/permissions', permissionsRouter());
  app.use('/api/v1/branches', branchesRouter());
  app.use('/api/v1/categories', catalogRouter('category'));
  app.use('/api/v1/laboratories', catalogRouter('laboratory'));
  app.use('/api/v1/products', refreshAlertsAfterChanges, productsRouter());
  app.use('/api/v1/inventory', refreshAlertsAfterChanges, inventoryRouter());
  app.use('/api/v1/suppliers', suppliersRouter());
  app.use('/api/v1/purchases', refreshAlertsAfterChanges, purchasesRouter());
  app.use('/api/v1/sales', refreshAlertsAfterChanges, salesRouter());
  app.use('/api/v1/returns', refreshAlertsAfterChanges, returnsRouter());
  app.use('/api/v1/notifications', notificationsRouter());
  app.use('/api/v1/patients', patientsRouter());
  app.use('/api/v1/prescriptions', prescriptionsRouter());
  app.use('/api/v1/settings', settingsRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
