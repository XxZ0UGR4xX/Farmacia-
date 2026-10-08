import { ALL_PERMISSIONS, OWNER_ROLE_CODE } from '@farmacia/shared';
import { prisma } from '../../lib/prisma';
import type { AuthContext } from '../../shared/request-context';

/**
 * Caché en memoria del contexto de autorización por sesión.
 * Evita consultar la base en cada petición, y se invalida explícitamente al
 * cerrar sesión, cambiar contraseña, o modificar usuarios/roles.
 * Para varias instancias de la API, sustituir por Redis con la misma interfaz.
 */
const TTL_MS = 15_000;
const MAX_ENTRIES = 5_000;

interface Entry {
  value: AuthContext | null;
  userId: string | null;
  expiresAt: number;
}

const cache = new Map<string, Entry>();

async function load(sessionId: string): Promise<AuthContext | null> {
  const session = await prisma.userSession.findUnique({
    where: { id: sessionId },
    include: {
      user: {
        include: {
          role: { include: { permissions: { include: { permission: true } } } },
          branches: { select: { branchId: true } },
        },
      },
    },
  });
  const now = new Date();
  if (!session || session.revokedAt || session.expiresAt <= now) return null;
  const { user } = session;
  if (user.deletedAt || user.status !== 'ACTIVE') return null;

  const permissions =
    user.role.code === OWNER_ROLE_CODE
      ? new Set<string>(ALL_PERMISSIONS)
      : new Set(user.role.permissions.map((rp) => rp.permission.key));

  return {
    userId: user.id,
    sessionId: session.id,
    email: user.email,
    roleCode: user.role.code,
    permissions,
    branchIds: user.branches.map((b) => b.branchId),
    defaultBranchId: user.defaultBranchId,
  };
}

export async function getAuthContext(sessionId: string): Promise<AuthContext | null> {
  const hit = cache.get(sessionId);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const value = await load(sessionId);
  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(sessionId, { value, userId: value?.userId ?? null, expiresAt: Date.now() + TTL_MS });
  return value;
}

export function invalidateSession(sessionId: string): void {
  cache.delete(sessionId);
}

export function invalidateUser(userId: string): void {
  for (const [sid, entry] of cache) {
    if (entry.userId === userId) cache.delete(sid);
  }
}

/** Tras cambiar permisos de un rol: más simple y seguro vaciar todo. */
export function invalidateAll(): void {
  cache.clear();
}
