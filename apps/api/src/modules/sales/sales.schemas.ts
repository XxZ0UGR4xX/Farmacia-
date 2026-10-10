import { RETURN_DISPOSITIONS, SALE_PAYMENT_METHODS, SALE_STATUSES } from '@farmacia/shared';
import { z } from 'zod';
import { paginationSchema, searchParam } from '../../shared/pagination';
import { isoDate, money, optionalText, quantity } from '../../shared/schema-fields';

const positiveMoney = (label: string) => money(label).refine((n) => n > 0, `${label} debe ser mayor a cero`);

export const salePaymentSchema = z
  .object({
    method: z.enum(SALE_PAYMENT_METHODS, { error: 'Forma de pago inválida' }),
    amount: positiveMoney('El importe'),
    /** Sólo efectivo: lo que entregó el cliente (para calcular el cambio) */
    received: money('El efectivo recibido').optional(),
    reference: optionalText(80),
  })
  .refine((p) => p.method === 'CASH' || p.received === undefined, { message: 'Sólo el efectivo lleva importe recibido', path: ['received'] })
  .refine((p) => p.received === undefined || p.received + 0.005 >= p.amount, {
    message: 'El efectivo recibido no alcanza',
    path: ['received'],
  });

export const createSaleSchema = z
  .object({
    /** Lo genera el punto de venta por cada cobro: un reintento devuelve la misma venta */
    clientRequestId: z.uuid().optional(),
    items: z
      .array(
        z.object({
          productId: z.uuid('Producto inválido'),
          quantity,
          discount: money('El descuento').default(0),
        }),
      )
      .min(1, 'Agrega al menos un producto')
      .max(100, 'Máximo 100 productos por venta'),
    payments: z.array(salePaymentSchema).min(1, 'Indica cómo paga el cliente').max(4, 'Máximo 4 formas de pago'),
    /** Quien cobra confirma que revisó la receta de los productos que la requieren */
    prescriptionChecked: z.boolean().default(false),
    /** Total que vio el cajero; si los precios cambiaron mientras tanto, la venta se rechaza */
    expectedTotal: money('El total').optional(),
    notes: optionalText(500),
  })
  .superRefine((d, ctx) => {
    const seen = new Set<string>();
    d.items.forEach((item, index) => {
      if (seen.has(item.productId)) {
        ctx.addIssue({ code: 'custom', message: 'Producto repetido: suma la cantidad en una sola partida', path: ['items', index, 'productId'] });
      }
      seen.add(item.productId);
    });
    if (d.payments.filter((p) => p.method === 'CASH').length > 1) {
      ctx.addIssue({ code: 'custom', message: 'Registra el efectivo en un solo pago', path: ['payments'] });
    }
  });
export type CreateSaleDto = z.infer<typeof createSaleSchema>;

export const listSalesSchema = paginationSchema
  .extend({
    q: searchParam,
    status: z.enum(SALE_STATUSES).optional(),
    userId: z.uuid().optional(),
    paymentMethod: z.enum(SALE_PAYMENT_METHODS).optional(),
    from: isoDate('Fecha inicial').optional(),
    to: isoDate('Fecha final').optional(),
  })
  .refine((d) => !d.from || !d.to || d.from <= d.to, { message: 'La fecha inicial debe ser anterior a la final', path: ['from'] });
export type ListSalesDto = z.infer<typeof listSalesSchema>;

export const cancelSaleSchema = z.object({
  reason: z.string().trim().min(5, 'Explica el motivo (mínimo 5 caracteres)').max(255),
});

export const createReturnSchema = z
  .object({
    reason: z.string().trim().min(3, 'Indica el motivo de la devolución').max(255),
    refundMethod: z.enum(SALE_PAYMENT_METHODS, { error: 'Indica cómo se reembolsa' }),
    notes: optionalText(500),
    items: z
      .array(
        z.object({
          saleItemId: z.uuid('Partida inválida'),
          quantity,
          disposition: z.enum(RETURN_DISPOSITIONS).default('QUARANTINE'),
        }),
      )
      .min(1, 'Selecciona al menos un producto')
      .max(100),
  })
  .superRefine((d, ctx) => {
    const seen = new Set<string>();
    d.items.forEach((item, index) => {
      if (seen.has(item.saleItemId)) ctx.addIssue({ code: 'custom', message: 'Partida repetida', path: ['items', index, 'saleItemId'] });
      seen.add(item.saleItemId);
    });
  });
export type CreateReturnDto = z.infer<typeof createReturnSchema>;

export const reviewReturnSchema = z.object({
  decision: z.enum(['RESTOCK', 'DISCARD'], { error: 'Indica si regresa al inventario o se desecha' }),
  notes: optionalText(255),
});

export const listReturnsSchema = paginationSchema.extend({
  q: searchParam,
  pending: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type ListReturnsDto = z.infer<typeof listReturnsSchema>;
