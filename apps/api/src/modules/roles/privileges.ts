import { canGrantRole, OWNER_ROLE_CODE } from '@farmacia/shared';
import { AppError } from '../../shared/errors';
import type { AuthContext } from '../../shared/request-context';

/**
 * Regla anti-escalamiento de privilegios: nadie puede otorgar (ni administrar a
 * usuarios con) permisos que él mismo no tiene. El propietario puede todo.
 */
export function canGrant(actor: AuthContext, role: { code: string; permissions: readonly string[] }): boolean {
  return canGrantRole(actor.roleCode, actor.permissions, role);
}

export function assertCanGrant(
  actor: AuthContext,
  role: { code: string; permissions: readonly string[] },
  message = 'No puedes asignar un rol con permisos que tú no tienes',
): void {
  if (!canGrant(actor, role)) throw AppError.forbidden(message);
}

/** Permisos que el actor no tiene y quiere otorgar (para mensajes claros). */
export function missingPermissions(actor: AuthContext, permissions: readonly string[]): string[] {
  if (actor.roleCode === OWNER_ROLE_CODE) return [];
  return permissions.filter((p) => !actor.permissions.has(p));
}
