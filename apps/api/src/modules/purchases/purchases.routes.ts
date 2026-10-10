import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { uuidParam } from '../../shared/params';
import { clientInfo, currentBranchId, requireAuth } from '../../shared/request-context';
import {
  cancelPurchaseSchema,
  createPurchaseSchema,
  listPurchasesSchema,
  paymentSchema,
  purchaseSchema,
} from './purchases.schemas';
import * as service from './purchases.service';

/**
 * Las compras muestran costos: quien puede ver compras ve los importes de la factura
 * (es el documento con el que trabaja), aunque no tenga acceso a los márgenes.
 */
export function purchasesRouter(): Router {
  const router = Router();
  router.use(authenticate);

  router.get('/', authorize('purchases.view'), async (req, res) => {
    res.json(await service.listPurchases(currentBranchId(req), listPurchasesSchema.parse(req.query)));
  });
  router.get('/:id', authorize('purchases.view'), async (req, res) => {
    res.json({ purchase: await service.getPurchase(currentBranchId(req), uuidParam(req)) });
  });
  router.post('/', authorize('purchases.create'), async (req, res) => {
    const dto = createPurchaseSchema.parse(req.body);
    res.status(201).json({ purchase: await service.createPurchase(requireAuth(req), currentBranchId(req), dto, clientInfo(req)) });
  });
  router.put('/:id', authorize('purchases.create'), async (req, res) => {
    const id = uuidParam(req);
    const dto = purchaseSchema.parse(req.body);
    res.json({ purchase: await service.updatePurchase(requireAuth(req), currentBranchId(req), id, dto, clientInfo(req)) });
  });
  router.post('/:id/receive', authorize('purchases.receive'), async (req, res) => {
    const id = uuidParam(req);
    res.json({ purchase: await service.receivePurchase(requireAuth(req), currentBranchId(req), id, clientInfo(req)) });
  });
  router.post('/:id/cancel', authorize('purchases.cancel'), async (req, res) => {
    const id = uuidParam(req);
    const { reason } = cancelPurchaseSchema.parse(req.body);
    res.json({ purchase: await service.cancelPurchase(requireAuth(req), currentBranchId(req), id, reason, clientInfo(req)) });
  });
  router.post('/:id/payments', authorize('purchases.pay'), async (req, res) => {
    const id = uuidParam(req);
    const dto = paymentSchema.parse(req.body);
    res.status(201).json({ purchase: await service.addPayment(requireAuth(req), currentBranchId(req), id, dto, clientInfo(req)) });
  });

  return router;
}
