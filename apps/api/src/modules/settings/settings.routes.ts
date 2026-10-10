import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { env } from '../../config/env';
import { todayISO } from '../../lib/dates';
import { getCatalogDefaults } from './settings.service';

export function settingsRouter(): Router {
  const router = Router();
  router.use(authenticate);
  // Valores predeterminados para capturar productos (margen, IVA, stock mínimo, moneda)
  router.get('/defaults', authorize('products.view'), async (_req, res) => {
    res.json(await getCatalogDefaults());
  });
  // Fecha de la farmacia: la interfaz no depende del reloj ni de la zona horaria de cada equipo
  router.get('/clock', (_req, res) => {
    res.json({ today: todayISO(), timeZone: env.APP_TIMEZONE, now: new Date().toISOString() });
  });
  return router;
}
