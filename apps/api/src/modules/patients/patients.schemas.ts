import { LICENSE_REGEX } from '@farmacia/shared';
import { z } from 'zod';
import { paginationSchema, searchParam } from '../../shared/pagination';
import { isoDate, optionalText } from '../../shared/schema-fields';

const name = (label: string, max: number) => z.string().trim().min(1, `${label} es obligatorio`).max(max);

export const patientSchema = z.object({
  firstName: name('El nombre', 80),
  lastName: name('El apellido', 120),
  birthDate: isoDate('Fecha de nacimiento')
    .refine((v) => v >= '1900-01-01', 'Fecha de nacimiento inválida')
    .nullish()
    .or(z.literal('').transform(() => null)),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+()\s.-]{7,30}$/, 'Teléfono inválido')
    .nullish()
    .or(z.literal('').transform(() => null)),
  email: z
    .union([z.literal(''), z.email('Correo inválido').max(160)])
    .nullish()
    .transform((v) => (v ? v.toLowerCase() : null)),
  address: optionalText(255),
  /** Notas administrativas (contacto, preferencias). No es expediente clínico. */
  notes: optionalText(1000),
});
export type PatientDto = z.infer<typeof patientSchema>;

export const listPatientsSchema = paginationSchema.extend({ q: searchParam });

export const prescriptionSchema = z.object({
  patientId: z.uuid('Selecciona al paciente'),
  doctorName: z.string().trim().min(3, 'Indica el nombre del médico').max(160),
  doctorLicense: z
    .string()
    .trim()
    .regex(LICENSE_REGEX, 'La cédula profesional tiene 7 u 8 dígitos')
    .nullish()
    .or(z.literal('').transform(() => null)),
  issuedAt: isoDate('Fecha de la receta'),
  notes: optionalText(1000),
  items: z
    .array(
      z.object({
        productId: z.uuid().nullish(),
        // Tal como viene escrito en la receta
        medicationName: z.string().trim().min(2, 'Indica el medicamento').max(200),
        dose: optionalText(100),
        frequency: optionalText(100),
        duration: optionalText(100),
        instructions: optionalText(500),
      }),
    )
    .min(1, 'Agrega al menos un medicamento')
    .max(20, 'Máximo 20 medicamentos'),
});
export type PrescriptionDto = z.infer<typeof prescriptionSchema>;

export const listPrescriptionsSchema = paginationSchema.extend({
  q: searchParam,
  patientId: z.uuid().optional(),
  from: isoDate('Fecha inicial').optional(),
  to: isoDate('Fecha final').optional(),
  includeVoided: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type ListPrescriptionsDto = z.infer<typeof listPrescriptionsSchema>;

export const voidPrescriptionSchema = z.object({
  reason: z.string().trim().min(5, 'Explica el motivo (mínimo 5 caracteres)').max(255),
});
