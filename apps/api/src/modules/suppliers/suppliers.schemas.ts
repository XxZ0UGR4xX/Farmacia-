import { RFC_REGEX } from '@farmacia/shared';
import { z } from 'zod';
import { paginationSchema, searchParam } from '../../shared/pagination';
import { optionalText } from '../../shared/schema-fields';

const rfc = z
  .string()
  .trim()
  .toUpperCase()
  .regex(RFC_REGEX, 'RFC inválido (12 o 13 caracteres, p. ej. ABC010203XY1)')
  .nullish()
  .or(z.literal(''))
  .transform((v) => (v ? v : null));

const email = z
  .union([z.literal(''), z.email('Correo inválido').max(160)])
  .nullish()
  .transform((v) => (v ? v.toLowerCase() : null));

const phone = z
  .string()
  .trim()
  .regex(/^[0-9+()\s.-]{7,30}$/, 'Teléfono inválido')
  .nullish()
  .or(z.literal(''))
  .transform((v) => (v ? v : null));

export const supplierSchema = z.object({
  tradeName: z.string().trim().min(2, 'El nombre comercial es obligatorio').max(160),
  legalName: optionalText(200),
  rfc,
  phone,
  email,
  address: optionalText(255),
  contactName: optionalText(120),
  paymentTerms: optionalText(160),
  creditDays: z.coerce
    .number({ error: 'Días de crédito inválidos' })
    .int('Debe ser un número entero')
    .min(0, 'No puede ser negativo')
    .max(365, 'Máximo 365 días')
    .default(0),
  notes: optionalText(2000),
});
export type SupplierDto = z.infer<typeof supplierSchema>;

export const listSuppliersSchema = paginationSchema.extend({
  q: searchParam,
  status: z.enum(['active', 'inactive', 'all']).default('active'),
});
export type ListSuppliersDto = z.infer<typeof listSuppliersSchema>;

export const supplierStatusSchema = z.object({ isActive: z.boolean() });
