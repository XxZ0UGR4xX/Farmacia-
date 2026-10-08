import {
  ALL_PERMISSIONS,
  isSensitivePermission,
  OWNER_ROLE_CODE,
  PERMISSION_MODULE_LABELS,
  PERMISSIONS,
  type PermissionKey,
  type PermissionModule,
} from '@farmacia/shared';
import type { Prisma } from '../../generated/prisma/client';
import { prisma, type DbClient } from '../../lib/prisma';
import { AppError } from '../../shared/errors';
import type { AuthContext, ClientInfo } from '../../shared/request-context';
import { recordAudit } from '../audit/audit.service';
import { invalidateAll } from '../auth/session-cache';
import { assertCanGrant, missingPermissions } from './privileges';
import type { CreateRoleDto, UpdateRoleDto } from './roles.schemas';

// -----------------------------------------------------------------------------
// Catálogo de permisos
// -----------------------------------------------------------------------------

export interface PermissionGroup {
  module: PermissionModule;
  label: string;
  permissions: { key: PermissionKey; description: string; sensitive: boolean }[];
}

export function listPermissionGroups(): PermissionGroup[] {
  return (Object.keys(PERMISSION_MODULE_LABELS) as PermissionModule[])
    .map((module) => ({
      module,
      label: PERMISSION_MODULE_LABELS[module],
      permissions: ALL_PERMISSIONS.filter((key) => PERMISSIONS[key].module === module).map((key) => ({
        key,
        description: PERMISSIONS[key].description,
        sensitive: isSensitivePermission(key),
      })),
    }))
    .filter((g) => g.permissions.length > 0);
}

// -----------------------------------------------------------------------------
// Roles
// -----------------------------------------------------------------------------

const roleInclude = {
  permissions: { include: { permission: true } },
  _count: { select: { users: { where: { deletedAt: null } } } },
} satisfies Prisma.RoleInclude;

type RoleWithRelations = Prisma.RoleGetPayload<{ include: typeof roleInclude }>;

export interface RoleDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  /** Propietario: acceso total e inmutable */
  isOwner: boolean;
  permissions: PermissionKey[];
  userCount: number;
}

function permissionKeys(role: { code: string; permissions: { permission: { key: string } }[] }): PermissionKey[] {
  if (role.code === OWNER_ROLE_CODE) return [...ALL_PERMISSIONS];
  return role.permissions.map((rp) => rp.permission.key as PermissionKey).sort();
}

function toDto(role: RoleWithRelations): RoleDto {
  return {
    id: role.id,
    code: role.code,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    isOwner: role.code === OWNER_ROLE_CODE,
    permissions: permissionKeys(role),
    userCount: role._count.users,
  };
}

// Orden de presentación: propietario primero, luego roles del sistema, luego personalizados
const SYSTEM_ORDER = ['OWNER', 'ADMIN', 'DOCTOR', 'PHARMACIST', 'CASHIER', 'WAREHOUSE'];

export async function listRoles(): Promise<RoleDto[]> {
  const roles = await prisma.role.findMany({ include: roleInclude });
  const rank = (code: string) => {
    const i = SYSTEM_ORDER.indexOf(code);
    return i === -1 ? SYSTEM_ORDER.length : i;
  };
  return roles
    .sort((a, b) => rank(a.code) - rank(b.code) || a.name.localeCompare(b.name, 'es'))
    .map(toDto);
}

async function findRoleOrThrow(db: DbClient, id: string): Promise<RoleWithRelations> {
  const role = await db.role.findUnique({ where: { id }, include: roleInclude });
  if (!role) throw AppError.notFound('Rol no encontrado');
  return role;
}

export async function getRole(id: string): Promise<RoleDto> {
  return toDto(await findRoleOrThrow(prisma, id));
}

function assertCanGrantAll(actor: AuthContext, permissions: readonly string[]): void {
  const missing = missingPermissions(actor, permissions);
  if (missing.length) {
    throw new AppError(403, 'FORBIDDEN', 'No puedes otorgar permisos que tú no tienes', { missing });
  }
}

async function assertNameAvailable(db: DbClient, name: string, exceptId?: string): Promise<void> {
  const existing = await db.role.findFirst({
    where: { name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (existing) {
    throw AppError.conflict('Ya existe un rol con ese nombre', [{ path: 'name', message: 'Nombre en uso' }]);
  }
}

/** Código estable a partir del nombre: "Auxiliar de mostrador" → "AUXILIAR_DE_MOSTRADOR". */
async function generateRoleCode(db: DbClient, name: string): Promise<string> {
  const base =
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 30) || 'ROL';
  const taken = new Set(
    (await db.role.findMany({ where: { code: { startsWith: base } }, select: { code: true } })).map((r) => r.code),
  );
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}_${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

async function replacePermissions(db: DbClient, roleId: string, keys: readonly string[]): Promise<void> {
  const permissions = await db.permission.findMany({ where: { key: { in: [...keys] } }, select: { id: true } });
  await db.rolePermission.deleteMany({ where: { roleId } });
  if (permissions.length) {
    await db.rolePermission.createMany({ data: permissions.map((p) => ({ roleId, permissionId: p.id })) });
  }
}

export async function createRole(actor: AuthContext, dto: CreateRoleDto, client: ClientInfo): Promise<RoleDto> {
  assertCanGrantAll(actor, dto.permissions);
  await assertNameAvailable(prisma, dto.name);

  const role = await prisma.$transaction(async (tx) => {
    const created = await tx.role.create({
      data: { code: await generateRoleCode(tx, dto.name), name: dto.name, description: dto.description, isSystem: false },
    });
    await replacePermissions(tx, created.id, dto.permissions);
    await recordAudit(
      {
        action: 'ROLE_CREATE',
        userId: actor.userId,
        entityType: 'role',
        entityId: created.id,
        metadata: { code: created.code, name: created.name, permissions: dto.permissions },
        client,
      },
      tx,
    );
    return findRoleOrThrow(tx, created.id);
  });
  return toDto(role);
}

export async function updateRole(
  actor: AuthContext,
  id: string,
  dto: UpdateRoleDto,
  client: ClientInfo,
): Promise<RoleDto> {
  const role = await findRoleOrThrow(prisma, id);
  if (role.code === OWNER_ROLE_CODE) {
    throw AppError.businessRule('El rol Propietario siempre tiene acceso total y no se puede modificar');
  }
  const current = permissionKeys(role);
  assertCanGrant(actor, { code: role.code, permissions: current }, 'No puedes modificar un rol con permisos que tú no tienes');
  if (actor.roleCode === role.code) {
    throw AppError.businessRule('No puedes modificar tu propio rol; pídeselo al propietario');
  }
  if (dto.permissions) assertCanGrantAll(actor, dto.permissions);
  if (dto.name && dto.name !== role.name) await assertNameAvailable(prisma, dto.name, id);

  const added = dto.permissions?.filter((p) => !current.includes(p)) ?? [];
  const removed = dto.permissions ? current.filter((p) => !dto.permissions!.includes(p)) : [];
  const details: Record<string, { from: unknown; to: unknown }> = {};
  if (dto.name !== undefined && dto.name !== role.name) details.name = { from: role.name, to: dto.name };
  if (dto.description !== undefined && dto.description !== role.description) {
    details.description = { from: role.description, to: dto.description };
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (Object.keys(details).length) {
      await tx.role.update({ where: { id }, data: { name: dto.name, description: dto.description } });
      await recordAudit(
        { action: 'ROLE_UPDATE', userId: actor.userId, entityType: 'role', entityId: id, metadata: details as Prisma.InputJsonValue, client },
        tx,
      );
    }
    if (added.length || removed.length) {
      await replacePermissions(tx, id, dto.permissions!);
      await recordAudit(
        {
          action: 'ROLE_PERMISSIONS_CHANGE',
          userId: actor.userId,
          entityType: 'role',
          entityId: id,
          metadata: { role: role.code, added, removed, affectedUsers: role._count.users },
          client,
        },
        tx,
      );
    }
    return findRoleOrThrow(tx, id);
  });

  // Los permisos cambian de inmediato para todas las sesiones abiertas
  if (added.length || removed.length) invalidateAll();
  return toDto(updated);
}

export async function deleteRole(actor: AuthContext, id: string, client: ClientInfo): Promise<void> {
  const role = await findRoleOrThrow(prisma, id);
  if (role.isSystem) throw AppError.businessRule('Los roles del sistema no se pueden eliminar');
  assertCanGrant(actor, { code: role.code, permissions: permissionKeys(role) }, 'No puedes eliminar un rol con permisos que tú no tienes');

  // Incluye usuarios desactivados: conservan el rol en su historial
  const assigned = await prisma.user.count({ where: { roleId: id } });
  if (assigned > 0) {
    throw AppError.businessRule(
      `El rol está asignado a ${assigned} usuario(s). Reasígnalos a otro rol antes de eliminarlo.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.role.delete({ where: { id } });
    await recordAudit(
      {
        action: 'ROLE_DELETE',
        userId: actor.userId,
        entityType: 'role',
        entityId: id,
        metadata: { code: role.code, name: role.name, permissions: permissionKeys(role) },
        client,
      },
      tx,
    );
  });
}
