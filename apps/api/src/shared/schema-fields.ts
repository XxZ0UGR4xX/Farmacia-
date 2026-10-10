import { z } from 'zod';

/** Campos de validación reutilizados por varios módulos. */

/** Fecha "AAAA-MM-DD" que existe en el calendario. */
export const isoDate = (label: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label}: usa el formato AAAA-MM-DD`)
    .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), {
      message: `${label} inválida`,
    });

/** Texto opcional: recortado y vacío → null. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres`)
    .nullish()
    .transform((v) => (v ? v : null));

export const notes = optionalText(500);

export const quantity = z.coerce
  .number({ error: 'Cantidad inválida' })
  .int('La cantidad debe ser un número entero')
  .min(1, 'La cantidad debe ser mayor a cero')
  .max(1_000_000, 'Cantidad demasiado alta');

// El número de lote se guarda en mayúsculas para no duplicar "a123" y "A123"
export const lotNumber = z
  .string()
  .trim()
  .toUpperCase()
  .min(1, 'El número de lote es obligatorio')
  .max(60)
  .regex(/^[A-Z0-9][A-Z0-9 ./-]*$/, 'Lote inválido (letras, números, guiones, puntos o diagonales)');

const decimals = (places: number) => (n: number) => Math.abs(n * 10 ** places - Math.round(n * 10 ** places)) < 1e-6;

/** Monto en pesos con hasta 2 decimales (se acepta número o texto). */
export const money = (label: string) =>
  z.coerce
    .number({ error: `${label} inválido` })
    .min(0, `${label} no puede ser negativo`)
    .max(99_999_999.99, `${label} demasiado alto`)
    // Tolerancia por la representación binaria (45.1 * 100 = 4510.000000000001)
    .refine(decimals(2), { message: `${label}: máximo 2 decimales` });

/** Costo unitario: hasta 4 decimales. */
export const unitCost = (label = 'El costo') =>
  z.coerce
    .number({ error: `${label} inválido` })
    .min(0, `${label} no puede ser negativo`)
    .max(99_999_999.99)
    .refine(decimals(4), `${label}: máximo 4 decimales`);
