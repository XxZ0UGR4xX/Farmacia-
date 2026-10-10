import { ADJUSTMENT_REASONS, MOVEMENT_TYPES, REASONS_BY_DIRECTION } from '@farmacia/shared';
import { z } from 'zod';
import { paginationSchema, searchParam } from '../../shared/pagination';
import { isoDate, lotNumber, notes, quantity, unitCost } from '../../shared/schema-fields';

/** Entrada manual: carga inicial de inventario o ajuste positivo con lote nuevo. */
export const entrySchema = z
  .object({
    productId: z.uuid('Selecciona un producto'),
    lotNumber,
    expiresAt: isoDate('Fecha de caducidad'),
    manufacturedAt: isoDate('Fecha de fabricación').nullish(),
    quantity,
    unitCost: unitCost().optional(),
    type: z.enum(['INITIAL_STOCK', 'ADJUSTMENT_IN']).default('INITIAL_STOCK'),
    reason: z.enum(ADJUSTMENT_REASONS).nullish(),
    notes,
  })
  .refine((d) => !d.manufacturedAt || d.manufacturedAt <= d.expiresAt, {
    message: 'La fabricación no puede ser posterior a la caducidad',
    path: ['manufacturedAt'],
  })
  .refine((d) => d.type !== 'ADJUSTMENT_IN' || d.reason, {
    message: 'Indica el motivo del ajuste',
    path: ['reason'],
  });
export type EntryDto = z.infer<typeof entrySchema>;

/** Ajuste manual sobre un lote existente: siempre con motivo (regla 4). */
export const adjustmentSchema = z
  .object({
    batchId: z.uuid('Selecciona un lote'),
    direction: z.enum(['IN', 'OUT']),
    quantity,
    reason: z.enum(ADJUSTMENT_REASONS, { error: 'Selecciona el motivo del ajuste' }),
    notes,
  })
  .refine((d) => REASONS_BY_DIRECTION[d.direction].includes(d.reason), {
    message: 'Ese motivo no aplica a este tipo de ajuste',
    path: ['reason'],
  })
  .refine((d) => d.reason !== 'OTHER' || d.notes, {
    message: 'Describe el motivo en las observaciones',
    path: ['notes'],
  });
export type AdjustmentDto = z.infer<typeof adjustmentSchema>;

export const stockQuerySchema = paginationSchema.extend({
  q: searchParam,
  categoryId: z.uuid().optional(),
  stockStatus: z.enum(['OUT', 'LOW', 'OK', 'OVER']).optional(),
  sort: z.enum(['name', 'stock', 'expiry']).default('name'),
});
export type StockQueryDto = z.infer<typeof stockQuerySchema>;

export const batchesQuerySchema = paginationSchema.extend({
  q: searchParam,
  productId: z.uuid().optional(),
  expiry: z.enum(['EXPIRED', 'CRITICAL', 'WARNING', 'OK']).optional(),
  status: z.enum(['AVAILABLE', 'DEPLETED', 'QUARANTINE', 'ALL']).default('AVAILABLE'),
});
export type BatchesQueryDto = z.infer<typeof batchesQuerySchema>;

const typeList = z
  .union([z.enum(MOVEMENT_TYPES), z.array(z.enum(MOVEMENT_TYPES))])
  .transform((v) => (Array.isArray(v) ? v : [v]))
  .optional();

export const movementsQuerySchema = paginationSchema
  .extend({
    q: searchParam,
    type: typeList,
    productId: z.uuid().optional(),
    batchId: z.uuid().optional(),
    userId: z.uuid().optional(),
    from: isoDate('Fecha inicial').optional(),
    to: isoDate('Fecha final').optional(),
  })
  .refine((d) => !d.from || !d.to || d.from <= d.to, { message: 'La fecha inicial debe ser anterior a la final', path: ['from'] });
export type MovementsQueryDto = z.infer<typeof movementsQuerySchema>;
