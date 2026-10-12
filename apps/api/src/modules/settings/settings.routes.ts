import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env';
import { todayISO } from '../../lib/dates';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { uuidParam } from '../../shared/params';
import { clientInfo, requireAuth } from '../../shared/request-context';
import {
  branchSchema,
  createBranch,
  EDITABLE_SETTING_KEYS,
  getCatalogDefaults,
  listBranches,
  listSettings,
  updateBranch,
  updateSetting,
} from './settings.service';

const settingKey = z.enum(EDITABLE_SETTING_KEYS as [string, ...string[]], { error: 'Sección de configuración desconocida' });

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

  router.get('/', authorize('settings.view'), async (_req, res) => {
    res.json({ settings: await listSettings() });
  });

  router.get('/branches', authorize('settings.view'), async (_req, res) => {
    res.json({ branches: await listBranches() });
  });
  router.post('/branches', authorize('settings.manage'), async (req, res) => {
    const dto = branchSchema.parse(req.body);
    res.status(201).json({ branch: await createBranch(requireAuth(req), dto, clientInfo(req)) });
  });
  router.patch('/branches/:id', authorize('settings.manage'), async (req, res) => {
    const id = uuidParam(req);
    const dto = branchSchema.partial().parse(req.body);
    res.json({ branch: await updateBranch(requireAuth(req), id, dto, clientInfo(req)) });
  });

  router.put('/:key', authorize('settings.manage'), async (req, res) => {
    const key = settingKey.parse(req.params.key) as (typeof EDITABLE_SETTING_KEYS)[number];
    res.json({ settings: await updateSetting(requireAuth(req), key, req.body, clientInfo(req)) });
  });

  return router;
}
