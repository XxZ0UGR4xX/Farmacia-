import { PAYMENT_METHODS, PAYMENT_STATUSES, PURCHASE_STATUSES, SUPPLIER_PAYMENT_METHODS } from '@farmacia/shared';
import { z } from 'zod';
import { paginationSchema, searchParam } from '../../shared/pagination';
import { isoDate, lotNumber, money, optionalText, quantity, unitCost } from '../../shared/schema-fields';

const itemSchema = z
  .object({
    productId: z.uuid('Selecciona un producto'),
    // En un pedido el lote aún no se conoce: es obligatorio al recibir
    lotNumber: lotNumber.nullish().or(z.literal('').transform(() => null)),
    expiresAt: isoDate('Fecha de caducidad').nullish().or(z.literal('').transform(() => null)),
    manufacturedAt: isoDate('Fecha de fabricación').nullish().or(z.literal('').transform(() => null)),
    quantity,
    unitCost: unitCost('El costo unitario'),
    discount: money('El descuento').default(0),
    /** Si se omite se usa el IVA del producto */
    taxRate: z.coerce.number().min(0, 'IVA inválido').max(1, 'IVA inválido').optional(),
  })
  .refine((i) => i.discount <= i.quantity * i.unitCost + 0.005, {
    message: 'El descuento no puede ser mayor que el importe de la partida',
    path: ['discount'],
  })
  .refine((i) => !i.manufacturedAt || !i.expiresAt || i.manufacturedAt <= i.expiresAt, {
    message: 'La fabricación no puede ser posterior a la caducidad',
    path: ['manufacturedAt'],
  });
export type PurchaseItemDto = z.infer<typeof itemSchema>;

const invoiceNumber = z
  .string()
  .trim()
  .toUpperCase()
  .max(60, 'Máximo 60 caracteres')
  .regex(/^[A-Z0-9][A-Z0-9 ./_-]*$/, 'Folio de factura inválido')
  .nullish()
  .or(z.literal('').transform(() => null))
  .transform((v) => v ?? null);

export const purchaseSchema = z
  .object({
    supplierId: z.uuid('Selecciona un proveedor'),
    invoiceNumber,
    purchaseDate: isoDate('Fecha de compra'),
    paymentMethod: z.enum(PAYMENT_METHODS, { error: 'Selecciona la forma de pago' }),
    /** Sólo a crédito; si se omite se calcula con los días de crédito del proveedor */
    paymentDueDate: isoDate('Fecha de vencimiento').nullish().or(z.literal('').transform(() => null)),
    notes: optionalText(1000),
    items: z.array(itemSchema).min(1, 'Agrega al menos un producto').max(200, 'Máximo 200 partidas por compra'),
  })
  .refine((p) => !p.paymentDueDate || p.paymentDueDate >= p.purchaseDate, {
    message: 'El vencimiento no puede ser anterior a la fecha de compra',
    path: ['paymentDueDate'],
  })
  .superRefine((p, ctx) => {
    // Un mismo lote de un producto no puede aparecer dos veces
    const seen = new Map<string, number>();
    p.items.forEach((item, index) => {
      if (!item.lotNumber) return;
      const key = `${item.productId}|${item.lotNumber}`;
      const first = seen.get(key);
      if (first !== undefined) {
        ctx.addIssue({
          code: 'custom',
          message: `El lote ${item.lotNumber} ya está en la partida ${first + 1}; suma las cantidades en una sola`,
          path: ['items', index, 'lotNumber'],
        });
      } else seen.set(key, index);
    });
  });
export type PurchaseDto = z.infer<typeof purchaseSchema>;

export const createPurchaseSchema = purchaseSchema.and(
  z.object({
    /** true: la mercancía llegó con la factura y se ingresa al inventario de inmediato */
    receive: z.boolean().default(false),
  }),
);

export const cancelPurchaseSchema = z.object({
  reason: z.string().trim().min(5, 'Explica el motivo (mínimo 5 caracteres)').max(255),
});

export const paymentSchema = z.object({
  amount: money('El importe').refine((n) => n > 0, 'El importe debe ser mayor a cero'),
  method: z.enum(SUPPLIER_PAYMENT_METHODS, { error: 'Selecciona la forma de pago' }),
  reference: optionalText(80),
  paidAt: isoDate('Fecha de pago').optional(),
});
export type PaymentDto = z.infer<typeof paymentSchema>;

export const listPurchasesSchema = paginationSchema
  .extend({
    q: searchParam,
    supplierId: z.uuid().optional(),
    status: z.enum(PURCHASE_STATUSES).optional(),
    paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
    overdue: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v === 'true'),
    from: isoDate('Fecha inicial').optional(),
    to: isoDate('Fecha final').optional(),
  })
  .refine((d) => !d.from || !d.to || d.from <= d.to, { message: 'La fecha inicial debe ser anterior a la final', path: ['from'] });
export type ListPurchasesDto = z.infer<typeof listPurchasesSchema>;
