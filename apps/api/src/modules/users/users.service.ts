import { ALL_PERMISSIONS, OWNER_ROLE_CODE } from '@farmacia/shared';
import type { Prisma, UserStatus } from '../../generated/prisma/client';
import { generateTemporaryPassword, hashPassword } from '../../lib/crypto';
import { prisma, type DbClient } from '../../lib/prisma';
import { AppError } from '../../shared/errors';
import { paginated, toSkipTake, type Paginated } from '../../shared/pagination';
import type { AuthContext, ClientInfo } from '../../shared/request-context';
import { recordAudit } from '../audit/audit.service';
import { revokeAllUserSessions } from '../auth/auth.service';
import { invalidateUser } from '../auth/session-cache';
import { assertCanGrant } from '../roles/privileges';
import type {
  AdminResetPasswordDto,
  CreateUserDto,
  ListUsersDto,
  UpdateUserDto,
} from './users.schemas';

// -----------------------------------------------------------------------------
// DTO de salida
// -----------------------------------------------------------------------------

const userInclude = {
  role: { include: { permissions: { include: { permission: true } } } },
  branches: { include: { branch: true }, orderBy: { branch: { name: 'asc' } } },
} satisfies Prisma.UserInclude;

type UserWithRelations = Prisma.UserGetPayload<{ include: typeof userInclude }>;

export interface UserDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  phone: string | null;
  professionalLicense: string | null;
  status: UserStatus;
  isLocked: boolean;
  lockedUntil: string | null;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  role: { id: string; code: string; name: string };
  branches: { id: string; code: string; name: string }[];
  defaultBranchId: string | null;
}

function toDto(u: UserWithRelations, now = new Date()): UserDto {
  const isLocked = Boolean(u.lockedUntil && u.lockedUntil > now);
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    fullName: `${u.firstName} ${u.lastName}`.trim(),
    phone: u.phone,
    professionalLicense: u.professionalLicense,
    status: u.status,
    isLocked,
    lockedUntil: isLocked ? u.lockedUntil!.toISOString() : null,
    mustChangePassword: u.mustChangePassword,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
    role: { id: u.role.id, code: u.role.code, name: u.role.name },
    branches: u.branches.map((ub) => ({ id: ub.branch.id, code: ub.branch.code, name: ub.branch.name })),
    defaultBranchId: u.defaultBranchId,
  };
}

function rolePermissions(role: UserWithRelations['role']): string[] {
  return role.code === OWNER_ROLE_CODE ? [...ALL_PERMISSIONS] : role.permissions.map((rp) => rp.permission.key);
}

// -----------------------------------------------------------------------------
// Consultas
// -----------------------------------------------------------------------------

export async function listUsers(query: ListUsersDto): Promise<Paginated<UserDto>> {
  const where: Prisma.UserWhereInput = {
    deletedAt: null,
    ...(query.roleId ? { roleId: query.roleId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.q
      ? {
          OR: [
            { firstName: { contains: query.q, mode: 'insensitive' } },
            { lastName: { contains: query.q, mode: 'insensitive' } },
            { email: { contains: query.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      include: userInclude,
      orderBy: [{ status: 'asc' }, { firstName: 'asc' }, { lastName: 'asc' }],
      ...toSkipTake(query),
    }),
    prisma.user.count({ where }),
  ]);
  const now = new Date();
  return paginated(
    rows.map((u) => toDto(u, now)),
    total,
    query,
  );
}

export async function getUser(id: string): Promise<UserDto & { activeSessions: number }> {
  const user = await findUserOrThrow(prisma, id);
  const activeSessions = await prisma.userSession.count({
    where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } },
  });
  return { ...toDto(user), activeSessions };
}

// -----------------------------------------------------------------------------
// Reglas
// -----------------------------------------------------------------------------

async function findUserOrThrow(db: DbClient, id: string): Promise<UserWithRelations> {
  const user = await db.user.findFirst({ where: { id, deletedAt: null }, include: userInclude });
  if (!user) throw AppError.notFound('Usuario no encontrado');
  return user;
}

async function findRoleOrThrow(db: DbClient, roleId: string) {
  const role = await db.role.findUnique({
    where: { id: roleId },
    include: { permissions: { include: { permission: true } } },
  });
  if (!role) throw AppError.badRequest('El rol seleccionado no existe', [{ path: 'roleId', message: 'Rol inválido' }]);
  const permissions =
    role.code === OWNER_ROLE_CODE ? [...ALL_PERMISSIONS] : role.permissions.map((rp) => rp.permission.key);
  return { id: role.id, code: role.code, name: role.name, permissions };
}

async function assertBranchesExist(db: DbClient, branchIds: string[]): Promise<void> {
  const count = await db.branch.count({ where: { id: { in: branchIds }, isActive: true } });
  if (count !== branchIds.length) {
    throw AppError.badRequest('Alguna de las sucursales no existe o está inactiva', [
      { path: 'branchIds', message: 'Sucursal inválida' },
    ]);
  }
}

/** Sólo se administra a usuarios cuyo rol el actor podría otorgar (un administrador no edita al propietario). */
function assertCanManage(actor: AuthContext, target: UserWithRelations): void {
  assertCanGrant(
    actor,
    { code: target.role.code, permissions: rolePermissions(target.role) },
    'No puedes administrar a un usuario con un rol superior al tuyo',
  );
}

function assertNotSelf(actor: AuthContext, targetId: string, message: string): void {
  if (actor.userId === targetId) throw AppError.businessRule(message);
}

/** Defensa en profundidad: siempre debe quedar al menos un propietario activo. */
async function assertOwnerRemains(db: DbClient, target: UserWithRelations): Promise<void> {
  if (target.role.code !== OWNER_ROLE_CODE || target.status !== 'ACTIVE') return;
  const others = await db.user.count({
    where: { id: { not: target.id }, deletedAt: null, status: 'ACTIVE', role: { code: OWNER_ROLE_CODE } },
  });
  if (others === 0) {
    throw AppError.businessRule('Debe existir al menos un propietario activo en el sistema');
  }
}

async function assertEmailAvailable(db: DbClient, email: string, exceptUserId?: string): Promise<void> {
  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (existing && existing.id !== exceptUserId) {
    throw AppError.conflict('Ya existe un usuario con ese correo', [
      { path: 'email', message: 'Este correo ya está registrado' },
    ]);
  }
}

function resolveDefaultBranch(branchIds: string[], requested: string | null | undefined, current?: string | null) {
  if (requested) return requested;
  if (current && branchIds.includes(current)) return current;
  return branchIds[0] ?? null;
}

// -----------------------------------------------------------------------------
// Comandos
// -----------------------------------------------------------------------------

export async function createUser(
  actor: AuthContext,
  dto: CreateUserDto,
  client: ClientInfo,
): Promise<{ user: UserDto; temporaryPassword: string }> {
  const role = await findRoleOrThrow(prisma, dto.roleId);
  assertCanGrant(actor, role);
  await assertBranchesExist(prisma, dto.branchIds);
  await assertEmailAvailable(prisma, dto.email);

  const temporaryPassword = dto.temporaryPassword ?? generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  const defaultBranchId = resolveDefaultBranch(dto.branchIds, dto.defaultBranchId);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: dto.email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        professionalLicense: dto.professionalLicense,
        roleId: role.id,
        defaultBranchId,
        mustChangePassword: true, // Debe elegir su propia contraseña al entrar
        branches: { create: dto.branchIds.map((branchId) => ({ branchId })) },
      },
      include: userInclude,
    });
    await recordAudit(
      {
        action: 'USER_CREATE',
        userId: actor.userId,
        entityType: 'user',
        entityId: created.id,
        metadata: { email: created.email, role: role.code, branchIds: dto.branchIds },
        client,
      },
      tx,
    );
    return created;
  });

  return { user: toDto(user), temporaryPassword };
}

export async function updateUser(
  actor: AuthContext,
  id: string,
  dto: UpdateUserDto,
  client: ClientInfo,
): Promise<UserDto> {
  const target = await findUserOrThrow(prisma, id);
  assertCanManage(actor, target);

  const roleChanges = dto.roleId !== undefined && dto.roleId !== target.roleId;
  let newRole: Awaited<ReturnType<typeof findRoleOrThrow>> | null = null;
  if (roleChanges) {
    assertNotSelf(actor, id, 'No puedes cambiar tu propio rol');
    newRole = await findRoleOrThrow(prisma, dto.roleId!);
    assertCanGrant(actor, newRole);
    if (newRole.code !== OWNER_ROLE_CODE) await assertOwnerRemains(prisma, target);
  }
  if (dto.branchIds) await assertBranchesExist(prisma, dto.branchIds);
  if (dto.email && dto.email !== target.email) await assertEmailAvailable(prisma, dto.email, id);

  const currentBranchIds = target.branches.map((b) => b.branchId);
  const branchIds = dto.branchIds ?? currentBranchIds;
  const defaultBranchId = resolveDefaultBranch(branchIds, dto.defaultBranchId, target.defaultBranchId);
  if (!branchIds.includes(defaultBranchId ?? '')) {
    throw AppError.badRequest('La sucursal predeterminada debe estar entre las sucursales asignadas', [
      { path: 'defaultBranchId', message: 'Sucursal no asignada' },
    ]);
  }

  // Bitácora de cambios (sin datos sensibles)
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const track = (field: string, from: unknown, to: unknown) => {
    if (to !== undefined && JSON.stringify(from) !== JSON.stringify(to)) changes[field] = { from, to };
  };
  track('email', target.email, dto.email);
  track('firstName', target.firstName, dto.firstName);
  track('lastName', target.lastName, dto.lastName);
  track('phone', target.phone, dto.phone);
  track('professionalLicense', target.professionalLicense, dto.professionalLicense);
  track('role', target.role.code, newRole?.code);
  track('branchIds', [...currentBranchIds].sort(), dto.branchIds ? [...dto.branchIds].sort() : undefined);
  track('defaultBranchId', target.defaultBranchId, defaultBranchId);

  if (Object.keys(changes).length === 0) return toDto(target);

  const updated = await prisma.$transaction(async (tx) => {
    if (dto.branchIds) {
      await tx.userBranch.deleteMany({ where: { userId: id, branchId: { notIn: dto.branchIds } } });
      await tx.userBranch.createMany({
        data: dto.branchIds.map((branchId) => ({ userId: id, branchId })),
        skipDuplicates: true,
      });
    }
    const user = await tx.user.update({
      where: { id },
      data: {
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        professionalLicense: dto.professionalLicense,
        roleId: newRole?.id,
        defaultBranchId,
      },
      include: userInclude,
    });
    await recordAudit(
      { action: 'USER_UPDATE', userId: actor.userId, entityType: 'user', entityId: id, metadata: changes as Prisma.InputJsonValue, client },
      tx,
    );
    return user;
  });

  // Permisos y sucursales cambian de inmediato en las sesiones abiertas
  invalidateUser(id);
  return toDto(updated);
}

export async function setUserStatus(
  actor: AuthContext,
  id: string,
  status: UserStatus,
  client: ClientInfo,
): Promise<UserDto> {
  assertNotSelf(actor, id, 'No puedes desactivar tu propia cuenta');
  const target = await findUserOrThrow(prisma, id);
  assertCanManage(actor, target);
  if (target.status === status) return toDto(target);
  if (status === 'INACTIVE') await assertOwnerRemains(prisma, target);

  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({ where: { id }, data: { status }, include: userInclude });
    let revokedSessions = 0;
    if (status === 'INACTIVE') revokedSessions = await revokeAllUserSessions(tx, id, 'USER_DEACTIVATED');
    await recordAudit(
      {
        action: status === 'INACTIVE' ? 'USER_DEACTIVATE' : 'USER_ACTIVATE',
        userId: actor.userId,
        entityType: 'user',
        entityId: id,
        metadata: { email: user.email, revokedSessions },
        client,
      },
      tx,
    );
    return user;
  });
  invalidateUser(id);
  return toDto(updated);
}

export async function adminResetPassword(
  actor: AuthContext,
  id: string,
  dto: AdminResetPasswordDto,
  client: ClientInfo,
): Promise<{ temporaryPassword: string }> {
  assertNotSelf(actor, id, 'Para cambiar tu propia contraseña usa "Mi perfil"');
  const target = await findUserOrThrow(prisma, id);
  assertCanManage(actor, target);

  const temporaryPassword = dto.temporaryPassword ?? generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
        mustChangePassword: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    // Invalida enlaces de recuperación pendientes y cierra todas sus sesiones
    await tx.passwordResetToken.updateMany({ where: { userId: id, usedAt: null }, data: { usedAt: new Date() } });
    const revokedSessions = await revokeAllUserSessions(tx, id, 'ADMIN_PASSWORD_RESET');
    await recordAudit(
      {
        action: 'USER_PASSWORD_RESET_BY_ADMIN',
        userId: actor.userId,
        entityType: 'user',
        entityId: id,
        metadata: { email: target.email, revokedSessions },
        client,
      },
      tx,
    );
  });
  invalidateUser(id);
  return { temporaryPassword };
}

export async function unlockUser(actor: AuthContext, id: string, client: ClientInfo): Promise<UserDto> {
  const target = await findUserOrThrow(prisma, id);
  assertCanManage(actor, target);

  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id },
      data: { lockedUntil: null, failedLoginAttempts: 0 },
      include: userInclude,
    });
    await recordAudit(
      { action: 'USER_UNLOCK', userId: actor.userId, entityType: 'user', entityId: id, metadata: { email: user.email }, client },
      tx,
    );
    return user;
  });
  return toDto(updated);
}

export async function revokeSessions(
  actor: AuthContext,
  id: string,
  client: ClientInfo,
): Promise<{ revokedSessions: number }> {
  assertNotSelf(actor, id, 'Para cerrar tus sesiones usa "Cerrar sesión" o cambia tu contraseña');
  const target = await findUserOrThrow(prisma, id);
  assertCanManage(actor, target);

  const revokedSessions = await prisma.$transaction(async (tx) => {
    const count = await revokeAllUserSessions(tx, id, 'ADMIN_REVOKED');
    await recordAudit(
      {
        action: 'USER_SESSIONS_REVOKED',
        userId: actor.userId,
        entityType: 'user',
        entityId: id,
        metadata: { email: target.email, revokedSessions: count },
        client,
      },
      tx,
    );
    return count;
  });
  invalidateUser(id);
  return { revokedSessions };
}
