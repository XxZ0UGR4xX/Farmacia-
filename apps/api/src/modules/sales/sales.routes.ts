import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { uuidParam } from '../../shared/params';
import { clientInfo, currentBranchId, requireAuth } from '../../shared/request-context';
import * as returns from './returns.service';
import {
  cancelSaleSchema,
  createReturnSchema,
  createSaleSchema,
  listReturnsSchema,
  listSalesSchema,
  reviewReturnSchema,
} from './sales.schemas';
import * as sales from './sales.service';

export function salesRouter(): Router {
  const router = Router();
  router.use(authenticate);

  router.get('/', authorize('sales.view'), async (req, res) => {
    res.json(await sales.listSales(requireAuth(req), currentBranchId(req), listSalesSchema.parse(req.query)));
  });
  router.get('/:id', authorize('sales.view'), async (req, res) => {
    res.json({ sale: await sales.getSale(requireAuth(req), currentBranchId(req), uuidParam(req)) });
  });
  router.post('/', authorize('sales.create'), async (req, res) => {
    const dto = createSaleSchema.parse(req.body);
    res.status(201).json({ sale: await sales.createSale(requireAuth(req), currentBranchId(req), dto, clientInfo(req)) });
  });
  router.post('/:id/cancel', authorize('sales.cancel'), async (req, res) => {
    const id = uuidParam(req);
    const { reason } = cancelSaleSchema.parse(req.body);
    res.json({ sale: await sales.cancelSale(requireAuth(req), currentBranchId(req), id, reason, clientInfo(req)) });
  });
  router.post('/:id/returns', authorize('returns.create'), async (req, res) => {
    const id = uuidParam(req);
    const dto = createReturnSchema.parse(req.body);
    res.status(201).json({ sale: await returns.createReturn(requireAuth(req), currentBranchId(req), id, dto, clientInfo(req)) });
  });

  return router;
}

export function returnsRouter(): Router {
  const router = Router();
  router.use(authenticate);

  router.get('/', authorize('returns.view'), async (req, res) => {
    res.json(await returns.listReturns(currentBranchId(req), listReturnsSchema.parse(req.query)));
  });
  // Decidir el destino del producto devuelto mueve inventario: requiere poder ajustarlo
  router.post('/:id/items/:itemId/review', authorize('inventory.adjust'), async (req, res) => {
    const id = uuidParam(req);
    const itemId = uuidParam(req, 'itemId');
    const { decision, notes } = reviewReturnSchema.parse(req.body);
    await returns.reviewReturnItem(requireAuth(req), currentBranchId(req), id, itemId, decision, notes, clientInfo(req));
    res.status(204).end();
  });

  return router;
}
