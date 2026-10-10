import { NOTIFICATION_TYPES } from '@farmacia/shared';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { uuidParam } from '../../shared/params';
import { currentBranchId, requireAuth } from '../../shared/request-context';
import * as service from './notifications.service';

const listSchema = z.object({
  type: z.enum(NOTIFICATION_TYPES).optional(),
  unread: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

export function notificationsRouter(): Router {
  const router = Router();
  router.use(authenticate, authorize('notifications.view'));

  router.get('/', async (req, res) => {
    res.json(await service.listNotifications(requireAuth(req), currentBranchId(req), listSchema.parse(req.query)));
  });
  // Contador de la campana (la interfaz lo consulta cada minuto)
  router.get('/summary', async (req, res) => {
    res.json(await service.notificationsSummary(requireAuth(req), currentBranchId(req)));
  });
  router.post('/read-all', async (req, res) => {
    res.json(await service.markAllRead(requireAuth(req), currentBranchId(req)));
  });
  router.post('/:id/read', async (req, res) => {
    await service.markRead(requireAuth(req), currentBranchId(req), uuidParam(req));
    res.status(204).end();
  });

  return router;
}
