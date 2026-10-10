import { formatPurchaseNumber, type NotificationSeverity, type NotificationType } from '@farmacia/shared';
import type { RequestHandler } from 'express';
import type { Prisma } from '../../generated/prisma/client';
import { dateOnly, todayISO } from '../../lib/dates';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import { getSetting } from '../settings/settings.service';

/**
 * Alertas automáticas. En lugar de dispararse con cada operación, se calculan a partir del
 * estado real (existencias, lotes, compras, devoluciones) y se concilian con las activas:
 *  - una condición nueva crea su alerta,
 *  - una que sigue vigente sólo actualiza su texto (no vuelve a marcarse como no leída),
 *  - una que ya no aplica se cierra (resolvedAt).
 * Cada condición tiene una clave (`dedupeKey`) y la base de datos no permite dos alertas
 * activas con la misma clave en una sucursal.
 */

export interface DesiredAlert {
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
}

/** Días antes del vencimiento de un pago a proveedor en que se avisa. */
const PAYMENT_NOTICE_DAYS = 3;
/** Un pedido sin recibir después de estos días genera aviso. */
const ORDER_STALE_DAYS = 7;

const dateFormat = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const fmtDate = (d: Date) => dateFormat.format(d);
const money = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
// El nombre comercial ya suele incluir la concentración ("Paracetamol 500 mg"): se usa tal cual
const productName = (name: string, _concentration: string | null) => name;

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export async function computeAlerts(branchId: string, today = todayISO()): Promise<Map<string, DesiredAlert>> {
  const desired = new Map<string, DesiredAlert>();
  const { criticalDays } = await getSetting('alerts.expiry');

  // 1. Existencias: agotados y stock bajo (sólo productos activos con mínimo definido)
  const stock = await prisma.$queryRaw<{ id: string; commercial_name: string; concentration: string | null; min_stock: number; available: number }[]>`
    SELECT p.id, p.commercial_name, p.concentration, i.min_stock,
      COALESCE(SUM(b.quantity) FILTER (WHERE b.status = 'ACTIVE' AND b.expires_at >= ${today}::date), 0)::int AS available
    FROM products p
    JOIN inventory i ON i.product_id = p.id AND i.branch_id = ${branchId}::uuid
    LEFT JOIN product_batches b ON b.product_id = p.id AND b.branch_id = ${branchId}::uuid
    WHERE p.deleted_at IS NULL AND p.status = 'ACTIVE' AND i.min_stock > 0
    GROUP BY p.id, i.min_stock
    HAVING COALESCE(SUM(b.quantity) FILTER (WHERE b.status = 'ACTIVE' AND b.expires_at >= ${today}::date), 0) <= i.min_stock`;
  for (const p of stock) {
    const name = productName(p.commercial_name, p.concentration);
    if (p.available === 0) {
      desired.set(`OUT_OF_STOCK:${p.id}`, {
        type: 'OUT_OF_STOCK',
        severity: 'CRITICAL',
        title: `${name} agotado`,
        message: `No hay existencia vendible de ${name} (mínimo ${p.min_stock}).`,
        entityType: 'product',
        entityId: p.id,
      });
    } else {
      desired.set(`LOW_STOCK:${p.id}`, {
        type: 'LOW_STOCK',
        severity: 'WARNING',
        title: `Stock bajo: ${name}`,
        message: `Quedan ${p.available} unidad(es) de ${name} (mínimo ${p.min_stock}).`,
        entityType: 'product',
        entityId: p.id,
      });
    }
  }

  // 2. Lotes caducados con existencia y lotes en ventana crítica
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + criticalDays);
  const batches = await prisma.productBatch.findMany({
    where: { branchId, quantity: { gt: 0 }, status: { in: ['ACTIVE', 'QUARANTINE'] }, expiresAt: { lt: limit } },
    include: { product: { select: { id: true, commercialName: true, concentration: true, deletedAt: true } } },
  });
  for (const b of batches) {
    if (b.product.deletedAt) continue;
    const name = productName(b.product.commercialName, b.product.concentration);
    const expires = dateOnly(b.expiresAt);
    const days = daysBetween(today, expires);
    if (days < 0) {
      desired.set(`EXPIRED:${b.id}`, {
        type: 'EXPIRED',
        severity: 'CRITICAL',
        title: `Lote caducado: ${name}`,
        message: `El lote ${b.lotNumber} caducó el ${fmtDate(b.expiresAt)} y tiene ${b.quantity} unidad(es). No se puede vender: dalo de baja.`,
        entityType: 'product',
        entityId: b.product.id,
      });
    } else {
      desired.set(`EXPIRING_SOON:${b.id}`, {
        type: 'EXPIRING_SOON',
        severity: 'WARNING',
        title: `Caduca pronto: ${name}`,
        message: `El lote ${b.lotNumber} caduca ${days === 0 ? 'hoy' : days === 1 ? 'mañana' : `en ${days} días`} (${fmtDate(b.expiresAt)}) y tiene ${b.quantity} unidad(es).`,
        entityType: 'product',
        entityId: b.product.id,
      });
    }
  }

  // 3. Pagos a proveedores por vencer o vencidos
  const notice = new Date(`${today}T00:00:00Z`);
  notice.setUTCDate(notice.getUTCDate() + PAYMENT_NOTICE_DAYS);
  const payable = await prisma.purchase.findMany({
    where: { branchId, status: 'RECEIVED', paymentStatus: { not: 'PAID' }, paymentDueDate: { lte: notice } },
    include: { supplier: { select: { tradeName: true } } },
  });
  for (const p of payable) {
    const balance = Number(p.total) - Number(p.amountPaid);
    const due = dateOnly(p.paymentDueDate!);
    const overdue = due < today;
    desired.set(`${overdue ? 'PAYMENT_OVERDUE' : 'PAYMENT_DUE'}:${p.id}`, {
      type: 'SUPPLIER_PAYMENT_DUE',
      severity: overdue ? 'CRITICAL' : 'WARNING',
      title: overdue ? `Pago vencido: ${p.supplier.tradeName}` : `Pago por vencer: ${p.supplier.tradeName}`,
      message: `Compra ${formatPurchaseNumber(p.number)}: saldo ${money.format(balance)}, ${overdue ? 'venció' : 'vence'} el ${fmtDate(p.paymentDueDate!)}.`,
      entityType: 'purchase',
      entityId: p.id,
    });
  }

  // 4. Pedidos que llevan días sin recibirse
  const stale = new Date(`${today}T00:00:00Z`);
  stale.setUTCDate(stale.getUTCDate() - ORDER_STALE_DAYS);
  const orders = await prisma.purchase.findMany({
    where: { branchId, status: { in: ['DRAFT', 'ORDERED'] }, purchaseDate: { lt: stale } },
    include: { supplier: { select: { tradeName: true } } },
  });
  for (const o of orders) {
    desired.set(`PURCHASE_PENDING:${o.id}`, {
      type: 'PURCHASE_PENDING',
      severity: 'INFO',
      title: `Pedido sin recibir: ${o.supplier.tradeName}`,
      message: `La compra ${formatPurchaseNumber(o.number)} está pendiente de recibir desde el ${fmtDate(o.purchaseDate)}.`,
      entityType: 'purchase',
      entityId: o.id,
    });
  }

  // 5. Productos devueltos esperando revisión (una alerta por sucursal)
  const pending = await prisma.returnItem.aggregate({
    where: { disposition: 'QUARANTINE', reviewedAt: null, return: { branchId } },
    _count: { _all: true },
    _sum: { quantity: true },
  });
  if (pending._count._all > 0) {
    desired.set('RETURNS_REVIEW', {
      type: 'INVENTORY_ANOMALY',
      severity: 'INFO',
      title: 'Devoluciones por revisar',
      message: `${pending._count._all} producto(s) devueltos (${pending._sum.quantity ?? 0} pieza(s)) esperan revisión antes de volver a la venta.`,
      entityType: 'returns',
      entityId: null,
    });
  }

  return desired;
}

/** Concilia las alertas activas de la sucursal con las condiciones actuales. */
export async function refreshAlerts(branchId: string, today = todayISO()) {
  const desired = await computeAlerts(branchId, today);
  return prisma.$transaction(async (tx) => {
    // Una sola conciliación a la vez por sucursal
    const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${`alerts:${branchId}`})) AS locked`;
    if (!lock?.locked) return { created: 0, updated: 0, resolved: 0, skipped: true };

    const active = await tx.notification.findMany({ where: { branchId, resolvedAt: null, dedupeKey: { not: null } } });
    let created = 0;
    let updated = 0;
    let resolved = 0;
    const toResolve: string[] = [];
    for (const n of active) {
      const want = desired.get(n.dedupeKey!);
      if (!want) {
        toResolve.push(n.id);
        continue;
      }
      if (want.title !== n.title || want.message !== n.message || want.severity !== n.severity) {
        await tx.notification.update({ where: { id: n.id }, data: { title: want.title, message: want.message, severity: want.severity } });
        updated++;
      }
      desired.delete(n.dedupeKey!);
    }
    if (toResolve.length) {
      resolved = (await tx.notification.updateMany({ where: { id: { in: toResolve } }, data: { resolvedAt: new Date() } })).count;
    }
    if (desired.size) {
      const data: Prisma.NotificationCreateManyInput[] = [...desired.entries()].map(([dedupeKey, a]) => ({ branchId, dedupeKey, ...a }));
      created = (await tx.notification.createMany({ data, skipDuplicates: true })).count;
    }
    return { created, updated, resolved, skipped: false };
  });
}

const lastRefresh = new Map<string, number>();
const REFRESH_EVERY_MS = 60_000;

/** Tras una operación que cambia existencias, compras o devoluciones: revisar en la próxima consulta. */
export function markAlertsStale(branchId: string) {
  lastRefresh.delete(branchId);
}

/** Refresca si la última revisión de la sucursal tiene más de un minuto. */
export async function ensureFreshAlerts(branchId: string) {
  const last = lastRefresh.get(branchId) ?? 0;
  if (Date.now() - last < REFRESH_EVERY_MS) return;
  lastRefresh.set(branchId, Date.now());
  try {
    await refreshAlerts(branchId);
  } catch (err) {
    lastRefresh.delete(branchId);
    logger.error({ err, branchId }, 'No se pudieron actualizar las alertas');
  }
}

/** Revisión periódica de todas las sucursales activas (la arranca el servidor). */
export function startAlertsScheduler(intervalMs = 10 * 60_000) {
  const run = async () => {
    const branches = await prisma.branch.findMany({ where: { isActive: true }, select: { id: true } });
    for (const b of branches) await ensureFreshAlerts(b.id);
  };
  const timer = setInterval(() => void run().catch((err: unknown) => logger.error({ err }, 'Revisión de alertas falló')), intervalMs);
  timer.unref();
  void run().catch((err: unknown) => logger.error({ err }, 'Revisión de alertas falló'));
  return () => clearInterval(timer);
}

/**
 * Middleware: cuando una petición que modifica datos termina bien, las alertas de la sucursal
 * se vuelven a calcular en la siguiente consulta (la campana se actualiza al instante).
 */
export const refreshAlertsAfterChanges: RequestHandler = (req, res, next) => {
  if (req.method !== 'GET') {
    res.on('finish', () => {
      if (res.statusCode >= 300 || !req.auth) return;
      const requested = req.get('x-branch-id');
      const branchId = requested && req.auth.branchIds.includes(requested) ? requested : (req.auth.defaultBranchId ?? req.auth.branchIds[0]);
      if (branchId) markAlertsStale(branchId);
    });
  }
  next();
};
