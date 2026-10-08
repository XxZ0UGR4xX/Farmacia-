import { ADJUSTMENT_REASONS, MOVEMENT_TYPES, REASONS_BY_DIRECTION } from '@farmacia/shared';
import { z } from 'zod';
import { paginationSchema, searchParam } from '../../shared/pagination';

const isoDate = (label: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label}: usa el formato AAAA-MM-DD`)
    .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), {
      message: `${label} inválida`,
    });

const notes = z
  .string()
  .trim()
  .max(500, 'Máximo 500 caracteres')
  .nullish()
  .transform((v) => (v ? v : null));

const quantity = z.coerce
  .number({ error: 'Cantidad inválida' })
  .int('La cantidad debe ser un número entero')
  .min(1, 'La cantidad debe ser mayor a cero')
  .max(1_000_000, 'Cantidad demasiado alta');

/** Entrada manual: carga inicial de inventario o ajuste positivo con lote nuevo. */
export const entrySchema = z
  .object({
    productId: z.uuid('Selecciona un producto'),
    // El número de lote se guarda en mayúsculas para no duplicar "a123" y "A123"
    lotNumber: z
      .string()
      .trim()
      .toUpperCase()
      .min(1, 'El número de lote es obligatorio')
      .max(60)
      .regex(/^[A-Z0-9][A-Z0-9 ./-]*$/, 'Lote inválido (letras, números, guiones, puntos o diagonales)'),
    expiresAt: isoDate('Fecha de caducidad'),
    manufacturedAt: isoDate('Fecha de fabricación').nullish(),
    quantity,
    unitCost: z.coerce
      .number()
      .min(0, 'El costo no puede ser negativo')
      .max(99_999_999.99)
      .refine((n) => Math.abs(n * 10_000 - Math.round(n * 10_000)) < 1e-6, 'Máximo 4 decimales')
      .optional(),
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
