import {
  ALL_PERMISSIONS,
  OWNER_ROLE_CODE,
  PERMISSIONS,
  SYSTEM_ROLES,
  type SystemRoleCode,
} from '@farmacia/shared';
import type { PrismaClient } from '../../src/generated/prisma/client';

export const MAIN_BRANCH_CODE = 'MATRIZ';

/** Configuración inicial de la farmacia (editable desde el módulo de Configuración). */
export const DEFAULT_SETTINGS: Record<string, { value: unknown; description: string }> = {
  'pharmacy.profile': {
    value: { name: 'Mi Farmacia', logoUrl: null, phone: null, email: null, address: null },
    description: 'Datos generales de la farmacia',
  },
  'pharmacy.fiscal': {
    value: { rfc: null, legalName: null, taxRegime: null, fiscalAddress: null, zipCode: null },
    description: 'Datos fiscales',
  },
  'pharmacy.currency': {
    value: { code: 'MXN', symbol: '$', locale: 'es-MX' },
    description: 'Moneda',
  },
  'pharmacy.taxes': {
    value: { defaultRate: 0, pricesIncludeTax: true, rates: [0, 0.16] },
    description: 'Impuestos (IVA). Medicamentos suelen ser tasa 0 %.',
  },
  'inventory.defaults': {
    value: { defaultMarginPercent: 30, defaultMinStock: 5 },
    description: 'Margen y stock mínimo predeterminados',
  },
  'alerts.expiry': {
    value: { criticalDays: 30, warningDays: 90 },
    description: 'Días de alerta de caducidad',
  },
};

/** Registra el catálogo de permisos. Devuelve los que no existían (nuevos en esta versión). */
export async function seedPermissions(prisma: PrismaClient): Promise<string[]> {
  const existing = new Set((await prisma.permission.findMany({ select: { key: true } })).map((p) => p.key));
  const added: string[] = [];
  for (const key of ALL_PERMISSIONS) {
    const def = PERMISSIONS[key];
    if (!existing.has(key)) added.push(key);
    await prisma.permission.upsert({
      where: { key },
      update: { module: def.module, description: def.description },
      create: { key, module: def.module, description: def.description },
    });
  }
  return added;
}

/**
 * Crea los roles del sistema. A los roles existentes NO se les reescriben los
 * permisos (respeta personalizaciones del propietario), excepto OWNER, que
 * siempre recibe todos. Los permisos NUEVOS de una actualización sí se otorgan
 * a los roles del sistema que los incluyen por definición.
 */
export async function seedRoles(prisma: PrismaClient, newPermissions: readonly string[] = []): Promise<void> {
  const permissions = await prisma.permission.findMany();
  const idByKey = new Map(permissions.map((p) => [p.key, p.id]));

  for (const [code, def] of Object.entries(SYSTEM_ROLES) as [SystemRoleCode, (typeof SYSTEM_ROLES)[SystemRoleCode]][]) {
    const existing = await prisma.role.findUnique({ where: { code } });
    const role =
      existing ??
      (await prisma.role.create({
        data: { code, name: def.name, description: def.description, isSystem: true },
      }));

    const keys = !existing || code === OWNER_ROLE_CODE ? def.permissions : def.permissions.filter((k) => newPermissions.includes(k));
    if (keys.length) {
      const data = keys
        .map((key) => idByKey.get(key))
        .filter((id): id is string => Boolean(id))
        .map((permissionId) => ({ roleId: role.id, permissionId }));
      await prisma.rolePermission.createMany({ data, skipDuplicates: true });
    }
  }
}

export async function seedMainBranch(prisma: PrismaClient) {
  return prisma.branch.upsert({
    where: { code: MAIN_BRANCH_CODE },
    update: {},
    create: { code: MAIN_BRANCH_CODE, name: 'Matriz' },
  });
}

export async function seedSettings(prisma: PrismaClient): Promise<void> {
  for (const [key, { value, description }] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.setting.upsert({
      where: { key },
      update: {},
      create: { key, value: value as object, description },
    });
  }
}

export interface OwnerInput {
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
}

/** Crea el usuario propietario si no existe. Devuelve true si lo creó. */
export async function seedOwner(prisma: PrismaClient, input: OwnerInput, branchId: string): Promise<boolean> {
  const email = input.email.trim().toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) return false;

  const role = await prisma.role.findUniqueOrThrow({ where: { code: OWNER_ROLE_CODE } });
  await prisma.user.create({
    data: {
      email,
      passwordHash: input.passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      roleId: role.id,
      defaultBranchId: branchId,
      branches: { create: { branchId } },
    },
  });
  return true;
}
