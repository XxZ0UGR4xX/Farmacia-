import { hasPermission, NOTIFICATION_PERMISSIONS, NOTIFICATION_TYPES, type NotificationType } from '@farmacia/shared';
import type { Prisma } from '../../generated/prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../shared/errors';
import type { AuthContext } from '../../shared/request-context';
import { ensureFreshAlerts } from './alerts.service';

const SEVERITY_ORDER = { CRITICAL: 0, WARNING: 1, INFO: 2 } as const;

/** Tipos de alerta que el usuario puede ver según sus permisos. */
function visibleTypes(auth: AuthContext): NotificationType[] {
  return NOTIFICATION_TYPES.filter((t) => NOTIFICATION_PERMISSIONS[t].some((p) => hasPermission(auth.roleCode, auth.permissions, p)));
}

/** Enlace de la interfaz al que lleva cada alerta. */
function linkFor(entityType: string | null, entityId: string | null): string | null {
  if (entityType === 'product' && entityId) return `/inventario/existencias/${entityId}`;
  if (entityType === 'purchase' && entityId) return `/compras/historial/${entityId}`;
  if (entityType === 'returns') return '/ventas/devoluciones';
  return null;
}

function baseWhere(auth: AuthContext, branchId: string): Prisma.NotificationWhereInput {
  return { OR: [{ branchId }, { branchId: null }], resolvedAt: null, type: { in: visibleTypes(auth) } };
}

export async function listNotifications(auth: AuthContext, branchId: string, opts: { type?: NotificationType; unread?: boolean }) {
  await ensureFreshAlerts(branchId);
  const where: Prisma.NotificationWhereInput = {
    ...baseWhere(auth, branchId),
    ...(opts.type ? { type: opts.type } : {}),
    ...(opts.unread ? { reads: { none: { userId: auth.userId } } } : {}),
  };
  const rows = await prisma.notification.findMany({
    where,
    include: { reads: { where: { userId: auth.userId }, select: { readAt: true } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  rows.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.createdAt.getTime() - a.createdAt.getTime());
  const summary = await notificationsSummary(auth, branchId);
  return {
    data: rows.map((n) => ({
      id: n.id,
      type: n.type,
      severity: n.severity,
      title: n.title,
      message: n.message,
      link: linkFor(n.entityType, n.entityId),
      read: n.reads.length > 0,
      createdAt: n.createdAt.toISOString(),
    })),
    summary,
  };
}

export async function notificationsSummary(auth: AuthContext, branchId: string) {
  await ensureFreshAlerts(branchId);
  const where = baseWhere(auth, branchId);
  const [unread, bySeverity] = await Promise.all([
    prisma.notification.count({ where: { ...where, reads: { none: { userId: auth.userId } } } }),
    prisma.notification.groupBy({ by: ['severity'], where, _count: { _all: true } }),
  ]);
  return {
    unread,
    total: bySeverity.reduce((s, g) => s + g._count._all, 0),
    critical: bySeverity.find((g) => g.severity === 'CRITICAL')?._count._all ?? 0,
  };
}

export async function markRead(auth: AuthContext, branchId: string, id: string) {
  const n = await prisma.notification.findFirst({ where: { id, ...baseWhere(auth, branchId) }, select: { id: true } });
  if (!n) throw AppError.notFound('La notificación no existe');
  await prisma.notificationRead.upsert({
    where: { notificationId_userId: { notificationId: id, userId: auth.userId } },
    create: { notificationId: id, userId: auth.userId },
    update: {},
  });
}

export async function markAllRead(auth: AuthContext, branchId: string) {
  const unread = await prisma.notification.findMany({
    where: { ...baseWhere(auth, branchId), reads: { none: { userId: auth.userId } } },
    select: { id: true },
  });
  if (unread.length) {
    await prisma.notificationRead.createMany({ data: unread.map((n) => ({ notificationId: n.id, userId: auth.userId })), skipDuplicates: true });
  }
  return { marked: unread.length };
}
