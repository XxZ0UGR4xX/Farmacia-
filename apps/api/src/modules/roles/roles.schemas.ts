import { isPermissionKey, type PermissionKey } from '@farmacia/shared';
import { z } from 'zod';

const permissionList = z
  .array(z.string().refine(isPermissionKey, { message: 'Permiso desconocido' }))
  .max(200)
  .transform((keys) => [...new Set(keys)] as PermissionKey[]);

const roleName = z.string().trim().min(2, 'El nombre debe tener al menos 2 caracteres').max(80);
const description = z
  .string()
  .trim()
  .max(255)
  .nullish()
  .transform((v) => (v ? v : null));

export const createRoleSchema = z.object({
  name: roleName,
  description,
  permissions: permissionList,
});
export type CreateRoleDto = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z.object({
  name: roleName.optional(),
  description: description.optional(),
  permissions: permissionList.optional(),
});
export type UpdateRoleDto = z.infer<typeof updateRoleSchema>;
