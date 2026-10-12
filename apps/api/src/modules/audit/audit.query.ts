import { AUDIT_ACTIONS, AUDIT_GROUPS, auditGroup, isAuditAction, SECURITY_ALERT_ACTIONS, type AuditGroup } from '@farmacia/shared';
import { z } from 'zod';
import { env } from '../../config/env';
import type { Prisma } from '../../generated/prisma/client';
import { endOfDayExclusive, startOfDay } from '../../lib/dates';
import { prisma } from '../../lib/prisma';
import { paginated, paginationSchema, searchParam, toSkipTake } from '../../shared/pagination';
import { isoDate } from '../../shared/schema-fields';

/**
 * Consulta de la bitácora de auditoría (sólo lectura: la base de datos impide modificarla
 * o borrarla). Muestra quién hizo qué, cuándo, desde dónde y en qué sucursal.
 */

const flag = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => v === 'true');

export const listAuditSchema = paginationSchema.extend({
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  from: isoDate('Fecha inicial').optional(),
  to: isoDate('Fecha final').optional(),
  userId: z.uuid('Usuario inválido').optional(),
  group: z.enum(Object.keys(AUDIT_GROUPS) as [AuditGroup, ...AuditGroup[]]).optional(),
  action: z
    .string()
    .optional()
    .refine((v) => v === undefined || v === '' || isAuditAction(v), 'Acción desconocida')
    .transform((v) => v || undefined),
  entityType: z.string().trim().max(40).optional().transform((v) => v || undefined),
  entityId: searchParam,
  security: flag,
});
export type ListAuditDto = z.output<typeof listAuditSchema>;

const ACTIONS_BY_GROUP = Object.keys(AUDIT_ACTIONS).reduce(
  (acc, action) => {
    (acc[auditGroup(action)] ??= []).push(action);
    return acc;
  },
  {} as Record<AuditGroup, string[]>,
);

function buildWhere(q: ListAuditDto): Prisma.AuditLogWhereInput {
  const actions: Prisma.StringFilter[] = [];
  if (q.action) actions.push({ equals: q.action });
  if (q.group) actions.push({ in: ACTIONS_BY_GROUP[q.group] ?? [] });
  if (q.security) actions.push({ in: [...SECURITY_ALERT_ACTIONS] });
  return {
    ...(q.from || q.to
      ? { createdAt: { ...(q.from ? { gte: startOfDay(q.from) } : {}), ...(q.to ? { lt: endOfDayExclusive(q.to) } : {}) } }
      : {}),
    ...(q.userId ? { userId: q.userId } : {}),
    ...(q.entityType ? { entityType: q.entityType } : {}),
    ...(q.entityId ? { entityId: q.entityId } : {}),
    ...(actions.length ? { AND: actions.map((a) => ({ action: a })) } : {}),
  };
}

const include = {
  user: { select: { id: true, firstName: true, lastName: true, email: true } },
  branch: { select: { id: true, name: true } },
} as const;

type AuditRow = Prisma.AuditLogGetPayload<{ include: typeof include }>;

const toDto = (r: AuditRow) => ({
  id: r.id,
  createdAt: r.createdAt.toISOString(),
  action: r.action,
  group: auditGroup(r.action),
  user: r.user ? { id: r.user.id, fullName: `${r.user.firstName} ${r.user.lastName}`.trim(), email: r.user.email } : null,
  branch: r.branch,
  entityType: r.entityType,
  entityId: r.entityId,
  ipAddress: r.ipAddress,
  userAgent: r.userAgent,
  metadata: r.metadata,
});

export async function listAudit(q: ListAuditDto) {
  const where = buildWhere(q);
  const [rows, total, security] = await Promise.all([
    prisma.auditLog.findMany({ where, include, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...toSkipTake(q) }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.count({ where: { AND: [where, { action: { in: [...SECURITY_ALERT_ACTIONS] } }] } }),
  ]);
  return { ...paginated(rows.map(toDto), total, q), summary: { total, security } };
}

/** Usuarios que aparecen en la bitácora (para el filtro), incluidos los dados de baja. */
export async function auditUsers() {
  const users = await prisma.user.findMany({
    where: { auditLogs: { some: {} } },
    select: { id: true, firstName: true, lastName: true, email: true },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
  });
  return users.map((u) => ({ id: u.id, fullName: `${u.firstName} ${u.lastName}`.trim(), email: u.email }));
}

export const AUDIT_EXPORT_LIMIT = 10_000;

const stamp = new Intl.DateTimeFormat('en-CA', {
  timeZone: env.APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** Filas para el CSV (más recientes primero, con un tope para no saturar el servidor). */
export async function auditExportRows(q: ListAuditDto) {
  const rows = await prisma.auditLog.findMany({ where: buildWhere(q), include, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: AUDIT_EXPORT_LIMIT });
  return rows.map((r) => [
    stamp.format(r.createdAt).replace(',', ''),
    r.user ? `${r.user.firstName} ${r.user.lastName}`.trim() : 'Sistema / sin sesión',
    r.user?.email ?? '',
    AUDIT_ACTIONS[r.action as keyof typeof AUDIT_ACTIONS] ?? r.action,
    AUDIT_GROUPS[auditGroup(r.action)],
    r.branch?.name ?? '',
    r.entityType ?? '',
    r.entityId ?? '',
    r.ipAddress ?? '',
    r.metadata === null ? '' : JSON.stringify(r.metadata),
  ]);
}

export const AUDIT_EXPORT_HEADERS = ['Fecha', 'Usuario', 'Correo', 'Acción', 'Grupo', 'Sucursal', 'Entidad', 'Id', 'IP', 'Detalle'];
