import { ALL_PERMISSIONS, type PermissionKey } from './permissions';

/** Rol con acceso total. Pasa cualquier verificación de permisos (incluso futuros). */
export const OWNER_ROLE_CODE = 'OWNER';

export type SystemRoleCode = 'OWNER' | 'ADMIN' | 'DOCTOR' | 'PHARMACIST' | 'CASHIER' | 'WAREHOUSE';

interface RoleDefinition {
  name: string;
  description: string;
  permissions: readonly PermissionKey[];
}

const exclude = (...keys: PermissionKey[]) => ALL_PERMISSIONS.filter((p) => !keys.includes(p));

/** Roles iniciales del sistema. El propietario puede crear roles adicionales. */
export const SYSTEM_ROLES: Record<SystemRoleCode, RoleDefinition> = {
  OWNER: {
    name: 'Propietario',
    description: 'Doctor / dueño. Acceso total al sistema.',
    permissions: ALL_PERMISSIONS,
  },
  ADMIN: {
    name: 'Administrador',
    description: 'Acceso administrativo completo excepto la gestión de roles.',
    permissions: exclude('roles.manage'),
  },
  DOCTOR: {
    name: 'Doctor',
    description: 'Consulta de inventario, pacientes y registro de recetas.',
    permissions: [
      'dashboard.view',
      'products.view',
      'inventory.view',
      'expirations.view',
      'sales.view',
      'patients.view',
      'patients.manage',
      'prescriptions.view',
      'prescriptions.manage',
      'notifications.view',
    ],
  },
  PHARMACIST: {
    name: 'Farmacéutico',
    description: 'Inventario, ventas y productos.',
    permissions: [
      'dashboard.view',
      'products.view',
      'products.create',
      'products.edit',
      'inventory.view',
      'inventory.adjust',
      'inventory.movements.view',
      'expirations.view',
      'sales.view',
      'sales.create',
      'sales.discount',
      'returns.view',
      'returns.create',
      'patients.view',
      'patients.manage',
      'prescriptions.view',
      'prescriptions.manage',
      'suppliers.view',
      'purchases.view',
      'notifications.view',
    ],
  },
  CASHIER: {
    name: 'Cajero',
    description: 'Ventas y consultas básicas.',
    permissions: [
      'products.view',
      'inventory.view',
      'sales.view',
      'sales.create',
      'returns.view',
      'patients.view',
      'notifications.view',
    ],
  },
  WAREHOUSE: {
    name: 'Almacenista',
    description: 'Inventario, compras y recepción de mercancía.',
    permissions: [
      'dashboard.view',
      'products.view',
      'inventory.view',
      'inventory.adjust',
      'inventory.movements.view',
      'expirations.view',
      'purchases.view',
      'purchases.create',
      'purchases.receive',
      'suppliers.view',
      'suppliers.manage',
      'notifications.view',
    ],
  },
};

/** Regla central de autorización compartida por backend y frontend. */
export function hasPermission(
  roleCode: string,
  granted: ReadonlySet<string> | readonly string[],
  required: PermissionKey,
): boolean {
  if (roleCode === OWNER_ROLE_CODE) return true;
  return Array.isArray(granted)
    ? granted.includes(required)
    : (granted as ReadonlySet<string>).has(required);
}

/**
 * Regla anti-escalamiento: un usuario sólo puede otorgar (o administrar a quien tenga)
 * un rol cuyos permisos él mismo posee. El propietario puede todo; nadie más otorga OWNER.
 */
export function canGrantRole(
  actorRoleCode: string,
  actorPermissions: ReadonlySet<string> | readonly string[],
  role: { code: string; permissions: readonly string[] },
): boolean {
  if (actorRoleCode === OWNER_ROLE_CODE) return true;
  if (role.code === OWNER_ROLE_CODE) return false;
  const granted: ReadonlySet<string> = Array.isArray(actorPermissions)
    ? new Set(actorPermissions)
    : (actorPermissions as ReadonlySet<string>);
  return role.permissions.every((p) => granted.has(p));
}
