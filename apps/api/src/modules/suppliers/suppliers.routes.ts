import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { uuidParam } from '../../shared/params';
import { clientInfo, currentBranchId, requireAuth } from '../../shared/request-context';
import { listSuppliersSchema, supplierSchema, supplierStatusSchema } from './suppliers.schemas';
import * as service from './suppliers.service';

export function suppliersRouter(): Router {
  const router = Router();
  router.use(authenticate);

  router.get('/', authorize('suppliers.view'), async (req, res) => {
    res.json(await service.listSuppliers(currentBranchId(req), listSuppliersSchema.parse(req.query)));
  });
  // Selector del formulario de compras: basta con poder registrar compras
  router.get('/options', authorize('purchases.create'), async (_req, res) => {
    res.json({ items: await service.supplierOptions() });
  });
  router.get('/:id', authorize('suppliers.view'), async (req, res) => {
    res.json({ supplier: await service.getSupplier(currentBranchId(req), uuidParam(req)) });
  });
  router.post('/', authorize('suppliers.manage'), async (req, res) => {
    const dto = supplierSchema.parse(req.body);
    res.status(201).json({ supplier: await service.createSupplier(requireAuth(req), dto, clientInfo(req)) });
  });
  router.patch('/:id', authorize('suppliers.manage'), async (req, res) => {
    const id = uuidParam(req);
    const dto = supplierSchema.partial().parse(req.body);
    res.json({ supplier: await service.updateSupplier(requireAuth(req), currentBranchId(req), id, dto, clientInfo(req)) });
  });
  router.patch('/:id/status', authorize('suppliers.manage'), async (req, res) => {
    const id = uuidParam(req);
    const { isActive } = supplierStatusSchema.parse(req.body);
    res.json({ supplier: await service.setSupplierActive(requireAuth(req), currentBranchId(req), id, isActive, clientInfo(req)) });
  });

  return router;
}
