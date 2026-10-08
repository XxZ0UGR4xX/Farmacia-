import { PRESENTATION_LABELS } from '@farmacia/shared';
import { Router, type Request, type Response } from 'express';
import { todayISO } from '../../lib/dates';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { sendCsv, toCsv } from '../../shared/csv';
import { uuidParam } from '../../shared/params';
import { clientInfo, currentBranchId, requireAuth } from '../../shared/request-context';
import {
  adjustmentSchema,
  batchesQuerySchema,
  entrySchema,
  movementsQuerySchema,
  stockQuerySchema,
} from './inventory.schemas';
import * as service from './inventory.service';

const STOCK_STATUS_LABELS = { OUT: 'Agotado', LOW: 'Stock bajo', OK: 'Disponible', OVER: 'Exceso' } as const;

const controller = {
  async stock(req: Request, res: Response) {
    res.json(await service.getStock(requireAuth(req), currentBranchId(req), stockQuerySchema.parse(req.query)));
  },
  async stockExport(req: Request, res: Response) {
    const auth = requireAuth(req);
    const rows = await service.getStockForExport(auth, currentBranchId(req), stockQuerySchema.parse(req.query));
    const withValue = rows.some((r) => r.value !== undefined);
    const headers = [
      'SKU', 'Código de barras', 'Producto', 'Concentración', 'Presentación', 'Categoría', 'Disponible',
      'Caducado', 'Cuarentena', 'Mínimo', 'Máximo', 'Ubicación', 'Próxima caducidad', 'Estado',
      ...(withValue ? ['Valor al costo'] : []),
    ];
    const csv = toCsv(
      headers,
      rows.map((r) => [
        r.sku, r.barcode, r.commercialName, r.concentration,
        [PRESENTATION_LABELS[r.presentation], r.contentQuantity].filter(Boolean).join(' '),
        r.category, r.available, r.expired, r.quarantine, r.minStock, r.maxStock, r.location,
        r.nextExpiry, STOCK_STATUS_LABELS[r.stockStatus],
        ...(withValue ? [r.value] : []),
      ]),
    );
    sendCsv(res, `existencias_${todayISO()}.csv`, csv);
  },
  async productInventory(req: Request, res: Response) {
    res.json(await service.getProductInventory(requireAuth(req), currentBranchId(req), uuidParam(req, 'productId')));
  },
  async batches(req: Request, res: Response) {
    res.json(await service.listBatches(requireAuth(req), currentBranchId(req), batchesQuerySchema.parse(req.query)));
  },
  async movements(req: Request, res: Response) {
    res.json(await service.listMovements(requireAuth(req), currentBranchId(req), movementsQuerySchema.parse(req.query)));
  },
  async movementsExport(req: Request, res: Response) {
    const rows = await service.getMovementsForExport(requireAuth(req), currentBranchId(req), movementsQuerySchema.parse(req.query));
    const { MOVEMENT_TYPE_LABELS, ADJUSTMENT_REASON_LABELS } = service.exportLabels;
    const csv = toCsv(
      ['Fecha y hora', 'Usuario', 'SKU', 'Producto', 'Lote', 'Caducidad del lote', 'Tipo', 'Motivo', 'Cantidad anterior', 'Cambio', 'Cantidad nueva', 'Observaciones', 'Referencia'],
      rows.map((m) => [
        m.createdAt, m.user.fullName, m.product.sku,
        [m.product.commercialName, m.product.concentration].filter(Boolean).join(' '),
        m.batch.lotNumber, m.batch.expiresAt,
        MOVEMENT_TYPE_LABELS[m.type as keyof typeof MOVEMENT_TYPE_LABELS] ?? m.type,
        m.reason ? (ADJUSTMENT_REASON_LABELS[m.reason as keyof typeof ADJUSTMENT_REASON_LABELS] ?? m.reason) : null,
        m.quantityBefore, m.quantityChange, m.quantityAfter, m.notes,
        m.referenceType ? `${m.referenceType}${m.referenceId ? ` ${m.referenceId}` : ''}` : null,
      ]),
    );
    sendCsv(res, `movimientos_${todayISO()}.csv`, csv);
  },
  async entry(req: Request, res: Response) {
    const dto = entrySchema.parse(req.body);
    res.status(201).json(await service.registerEntry(requireAuth(req), currentBranchId(req), dto, clientInfo(req)));
  },
  async adjustment(req: Request, res: Response) {
    const dto = adjustmentSchema.parse(req.body);
    res.status(201).json({ movement: await service.adjustBatch(requireAuth(req), currentBranchId(req), dto, clientInfo(req)) });
  },
};

export function inventoryRouter(): Router {
  const router = Router();
  router.use(authenticate);

  router.get('/stock', authorize('inventory.view'), controller.stock);
  router.get('/stock/export', authorize('inventory.view'), controller.stockExport);
  router.get('/products/:productId', authorize('inventory.view'), controller.productInventory);
  router.get('/batches', authorize('inventory.view'), controller.batches);
  router.get('/movements', authorize('inventory.movements.view'), controller.movements);
  router.get('/movements/export', authorize('inventory.movements.view'), controller.movementsExport);
  router.post('/entries', authorize('inventory.adjust'), controller.entry);
  router.post('/adjustments', authorize('inventory.adjust'), controller.adjustment);

  return router;
}

