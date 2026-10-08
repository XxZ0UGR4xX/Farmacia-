import { z } from 'zod';
import { paginationSchema, searchParam } from '../../shared/pagination';
import { newPasswordSchema } from '../auth/auth.schemas';

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Correo electrónico inválido').max(160));

const personName = (label: string) =>
  z.string().trim().min(1, `${label} es obligatorio`).max(80, `${label}: máximo 80 caracteres`);

/** Texto opcional: cadena vacía → null (permite borrar el valor al editar). */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres`)
    .nullish()
    .transform((v) => (v ? v : null));

const branchIds = z
  .array(z.uuid('Sucursal inválida'))
  .min(1, 'Asigna al menos una sucursal')
  .max(50)
  .transform((ids) => [...new Set(ids)]);

const defaultBranchInList = (d: { branchIds?: string[]; defaultBranchId?: string | null }) =>
  !d.branchIds || !d.defaultBranchId || d.branchIds.includes(d.defaultBranchId);
const defaultBranchIssue = {
  message: 'La sucursal predeterminada debe estar entre las sucursales asignadas',
  path: ['defaultBranchId'],
};

export const createUserSchema = z
  .object({
    email,
    firstName: personName('El nombre'),
    lastName: personName('El apellido'),
    phone: optionalText(30),
    professionalLicense: optionalText(40),
    roleId: z.uuid('Selecciona un rol'),
    branchIds,
    defaultBranchId: z.uuid().nullish(),
    /** Si se omite, el sistema genera una contraseña temporal segura. */
    temporaryPassword: newPasswordSchema.optional(),
  })
  .refine(defaultBranchInList, defaultBranchIssue);
export type CreateUserDto = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    email: email.optional(),
    firstName: personName('El nombre').optional(),
    lastName: personName('El apellido').optional(),
    phone: optionalText(30).optional(),
    professionalLicense: optionalText(40).optional(),
    roleId: z.uuid('Selecciona un rol').optional(),
    branchIds: branchIds.optional(),
    defaultBranchId: z.uuid().nullish(),
  })
  .refine(defaultBranchInList, defaultBranchIssue);
export type UpdateUserDto = z.infer<typeof updateUserSchema>;

export const listUsersSchema = paginationSchema.extend({
  q: searchParam,
  roleId: z.uuid().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});
export type ListUsersDto = z.infer<typeof listUsersSchema>;

export const adminResetPasswordSchema = z.object({
  temporaryPassword: newPasswordSchema.optional(),
});
export type AdminResetPasswordDto = z.infer<typeof adminResetPasswordSchema>;
