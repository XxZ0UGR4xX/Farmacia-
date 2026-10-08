import { PRESENTATIONS, PRODUCT_STATUSES } from '@farmacia/shared';
import { z } from 'zod';
import { paginationSchema, searchParam } from '../../shared/pagination';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres`)
    .nullish()
    .transform((v) => (v ? v : null));

/** Monto en pesos con hasta 2 decimales (se acepta número o texto). */
const money = (label: string) =>
  z.coerce
    .number({ error: `${label} inválido` })
    .min(0, `${label} no puede ser negativo`)
    .max(99_999_999.99, `${label} demasiado alto`)
    // Tolerancia por la representación binaria (45.1 * 100 = 4510.000000000001)
    .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, { message: `${label}: máximo 2 decimales` });

const barcode = z
  .string()
  .trim()
  .regex(/^[0-9A-Za-z-]{4,64}$/, 'Código de barras inválido (4 a 64 letras, números o guiones)')
  .nullish()
  .or(z.literal(''))
  .transform((v) => (v ? v : null));

const sku = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{2,40}$/, 'SKU inválido (letras, números o guiones)')
  .optional()
  .or(z.literal('').transform(() => undefined));

const productFields = {
  barcode,
  commercialName: z.string().trim().min(2, 'El nombre comercial es obligatorio').max(160),
  genericName: optionalText(160),
  activeIngredient: optionalText(200),
  categoryId: z.uuid('Selecciona una categoría'),
  presentation: z.enum(PRESENTATIONS, { error: 'Selecciona una presentación' }),
  concentration: optionalText(60),
  pharmaceuticalForm: optionalText(60),
  contentQuantity: optionalText(60),
  laboratoryId: z.uuid().nullish().or(z.literal('')).transform((v) => (v ? v : null)),
  manufacturer: optionalText(160),
  purchasePrice: money('El precio de compra'),
  salePrice: money('El precio de venta'),
  taxRate: z.coerce.number().min(0, 'IVA inválido').max(1, 'IVA inválido'),
  requiresPrescription: z.boolean(),
  isControlled: z.boolean(),
  status: z.enum(PRODUCT_STATUSES),
  description: optionalText(2000),
  indications: optionalText(2000),
  observations: optionalText(2000),
  // Parámetros de inventario de la sucursal actual
  minStock: z.coerce.number().int('Debe ser un número entero').min(0, 'No puede ser negativo').max(1_000_000),
  maxStock: z.coerce
    .number()
    .int('Debe ser un número entero')
    .min(0, 'No puede ser negativo')
    .max(1_000_000)
    .nullish()
    .or(z.literal('').transform(() => null)),
  location: optionalText(80),
};

const stockRange = (d: { minStock?: number; maxStock?: number | null }) =>
  d.maxStock == null || d.minStock == null || d.maxStock >= d.minStock;
const stockRangeIssue = { message: 'El stock máximo debe ser mayor o igual al mínimo', path: ['maxStock'] };

export const createProductSchema = z
  .object({
    ...productFields,
    sku,
    purchasePrice: productFields.purchasePrice.default(0),
    taxRate: productFields.taxRate.default(0),
    requiresPrescription: productFields.requiresPrescription.default(false),
    isControlled: productFields.isControlled.default(false),
    status: productFields.status.default('ACTIVE'),
    minStock: productFields.minStock.optional(),
  })
  .refine(stockRange, stockRangeIssue);
export type CreateProductDto = z.infer<typeof createProductSchema>;

export const updateProductSchema = z
  .object(productFields)
  .partial()
  .refine(stockRange, stockRangeIssue);
export type UpdateProductDto = z.infer<typeof updateProductSchema>;

const boolParam = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

export const listProductsSchema = paginationSchema.extend({
  q: searchParam,
  categoryId: z.uuid().optional(),
  laboratoryId: z.uuid().optional(),
  status: z.enum(PRODUCT_STATUSES).optional(),
  requiresPrescription: boolParam,
  sort: z.enum(['name', 'price_asc', 'price_desc', 'recent']).default('name'),
});
export type ListProductsDto = z.infer<typeof listProductsSchema>;
