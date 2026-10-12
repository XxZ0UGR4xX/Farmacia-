import { bucketsInRange, formatSaleNumber, hasPermission, type ReportGroupBy } from '@farmacia/shared';
import { Prisma } from '../../generated/prisma/client';
import { env } from '../../config/env';
import { dateOnly, endOfDayExclusive, startOfDay, todayISO } from '../../lib/dates';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../shared/errors';
import type { AuthContext } from '../../shared/request-context';
import { getSetting } from '../settings/settings.service';
import type { RangeDto } from './reports.schemas';

/**
 * Reportes y dashboard. Sólo lectura: todo se calcula de las tablas de operación
 * (ventas, devoluciones, lotes, movimientos, compras) de la sucursal en curso.
 * - Las fechas se agrupan en la zona horaria de la farmacia.
 * - Ventas brutas = ventas vigentes (no canceladas) por fecha de venta;
 *   las devoluciones se restan en la fecha en que se hicieron.
 * - Costos, utilidad y compras sólo con el permiso reports.financial.
 */

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const ratio = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 10_000) / 10_000 : null);

const can = (auth: AuthContext, key: Parameters<typeof hasPermission>[2]) => hasPermission(auth.roleCode, auth.permissions, key);
export const isFinancial = (auth: AuthContext) => can(auth, 'reports.financial');

const tz = () => env.APP_TIMEZONE;
const bucketSql = (column: Prisma.Sql, unit: ReportGroupBy) =>
  Prisma.sql`to_char(date_trunc(${unit}::text, ${column} AT TIME ZONE ${tz()}::text), 'YYYY-MM-DD')`;

function window(range: Pick<RangeDto, 'from' | 'to'>) {
  return { start: startOfDay(range.from), end: endOfDayExclusive(range.to) };
}

function shiftDate(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const byKey = <T extends { bucket: string }>(rows: T[]) => new Map(rows.map((r) => [r.bucket, r]));

// -----------------------------------------------------------------------------
// Ventas
// -----------------------------------------------------------------------------

interface SalesBucketRow {
  bucket: string;
  count: number;
  units: number;
  total: number;
  subtotal: number;
  tax: number;
  discount: number;
  cost: number;
}
interface ReturnsBucketRow {
  bucket: string;
  count: number;
  units: number;
  refunds: number;
  subtotal: number;
  cost: number;
}

/** Ventas vigentes por periodo. `createdById` limita a las ventas de un usuario. */
function salesBuckets(branchId: string, start: Date, end: Date, unit: ReportGroupBy, createdById?: string) {
  return prisma.$queryRaw<SalesBucketRow[]>`
    SELECT ${bucketSql(Prisma.sql`s.created_at`, unit)} AS bucket,
      COUNT(*)::int AS count,
      COALESCE(SUM(u.units), 0)::int AS units,
      SUM(s.total)::float8 AS total,
      SUM(s.subtotal)::float8 AS subtotal,
      SUM(s.tax_total)::float8 AS tax,
      SUM(s.discount_total)::float8 AS discount,
      SUM(s.cost_total)::float8 AS cost
    FROM sales s
    LEFT JOIN LATERAL (SELECT SUM(si.quantity) AS units FROM sale_items si WHERE si.sale_id = s.id) u ON true
    WHERE s.branch_id = ${branchId}::uuid AND s.status <> 'CANCELLED'
      AND s.created_at >= ${start} AND s.created_at < ${end}
      ${createdById ? Prisma.sql`AND s.created_by_id = ${createdById}::uuid` : Prisma.empty}
    GROUP BY 1`;
}

/** Devoluciones por periodo (fecha de la devolución), con la parte sin IVA y el costo de lo devuelto. */
function returnsBuckets(branchId: string, start: Date, end: Date, unit: ReportGroupBy, userId?: string) {
  return prisma.$queryRaw<ReturnsBucketRow[]>`
    SELECT ${bucketSql(Prisma.sql`r.created_at`, unit)} AS bucket,
      COUNT(DISTINCT r.id)::int AS count,
      SUM(ri.quantity)::int AS units,
      SUM(ri.refund_amount)::float8 AS refunds,
      SUM(si.subtotal * ri.quantity / si.quantity)::float8 AS subtotal,
      SUM(si.unit_cost * ri.quantity)::float8 AS cost
    FROM returns r
    JOIN return_items ri ON ri.return_id = r.id
    JOIN sale_items si ON si.id = ri.sale_item_id
    WHERE r.branch_id = ${branchId}::uuid AND r.created_at >= ${start} AND r.created_at < ${end}
      ${userId ? Prisma.sql`AND r.user_id = ${userId}::uuid` : Prisma.empty}
    GROUP BY 1`;
}

export async function salesReport(auth: AuthContext, branchId: string, range: RangeDto) {
  const fin = isFinancial(auth);
  const { start, end } = window(range);
  const inRange = Prisma.sql`s.branch_id = ${branchId}::uuid AND s.created_at >= ${start} AND s.created_at < ${end}`;

  const [pricing, sales, returns, cancelled, byMethod, refundsByMethod, byCashier, byCategory, byHour] = await Promise.all([
    getSetting('inventory.defaults'),
    salesBuckets(branchId, start, end, range.groupBy),
    returnsBuckets(branchId, start, end, range.groupBy),
    prisma.sale.aggregate({
      where: { branchId, status: 'CANCELLED', createdAt: { gte: start, lt: end } },
      _count: { _all: true },
      _sum: { total: true },
    }),
    prisma.$queryRaw<{ method: string; count: number; amount: number }[]>`
      SELECT p.method::text AS method, COUNT(DISTINCT s.id)::int AS count, SUM(p.amount)::float8 AS amount
      FROM sale_payments p JOIN sales s ON s.id = p.sale_id
      WHERE ${inRange} AND s.status <> 'CANCELLED'
      GROUP BY 1 ORDER BY amount DESC`,
    prisma.return.groupBy({
      by: ['refundMethod'],
      where: { branchId, createdAt: { gte: start, lt: end } },
      _sum: { refundTotal: true },
    }),
    prisma.$queryRaw<{ id: string; first_name: string; last_name: string; count: number; total: number; discount: number; cancelled: number }[]>`
      SELECT u.id, u.first_name, u.last_name,
        COUNT(*) FILTER (WHERE s.status <> 'CANCELLED')::int AS count,
        COALESCE(SUM(s.total) FILTER (WHERE s.status <> 'CANCELLED'), 0)::float8 AS total,
        COALESCE(SUM(s.discount_total) FILTER (WHERE s.status <> 'CANCELLED'), 0)::float8 AS discount,
        COUNT(*) FILTER (WHERE s.status = 'CANCELLED')::int AS cancelled
      FROM sales s JOIN users u ON u.id = s.created_by_id
      WHERE ${inRange}
      GROUP BY u.id ORDER BY total DESC, u.first_name`,
    prisma.$queryRaw<{ id: string; name: string; units: number; total: number; profit: number }[]>`
      SELECT c.id, c.name, SUM(si.quantity)::int AS units, SUM(si.total)::float8 AS total,
        SUM(si.subtotal - si.unit_cost * si.quantity)::float8 AS profit
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      JOIN products p ON p.id = si.product_id
      JOIN categories c ON c.id = p.category_id
      WHERE ${inRange} AND s.status <> 'CANCELLED'
      GROUP BY c.id ORDER BY total DESC, c.name`,
    prisma.$queryRaw<{ hour: number; count: number; total: number }[]>`
      SELECT EXTRACT(HOUR FROM s.created_at AT TIME ZONE ${tz()}::text)::int AS hour,
        COUNT(*)::int AS count, SUM(s.total)::float8 AS total
      FROM sales s
      WHERE ${inRange} AND s.status <> 'CANCELLED'
      GROUP BY 1 ORDER BY 1`,
  ]);

  const salesBy = byKey(sales);
  const returnsBy = byKey(returns);
  const series = bucketsInRange(range.from, range.to, range.groupBy).map((period) => {
    const s = salesBy.get(period);
    const r = returnsBy.get(period);
    const gross = num(s?.total);
    const refunds = num(r?.refunds);
    return {
      period,
      count: s?.count ?? 0,
      units: s?.units ?? 0,
      gross: r2(gross),
      refunds: r2(refunds),
      net: r2(gross - refunds),
      ...(fin ? { profit: r2(num(s?.subtotal) - num(s?.cost) - (num(r?.subtotal) - num(r?.cost))) } : {}),
    };
  });

  const sum = <T>(rows: T[], f: (r: T) => number) => rows.reduce((acc, r) => acc + f(r), 0);
  const count = sum(sales, (s) => s.count);
  const gross = sum(sales, (s) => num(s.total));
  const refunds = sum(returns, (r) => num(r.refunds));
  // Ingresos sin IVA y costo, ambos netos de devoluciones
  const revenue = sum(sales, (s) => num(s.subtotal)) - sum(returns, (r) => num(r.subtotal));
  const cost = sum(sales, (s) => num(s.cost)) - sum(returns, (r) => num(r.cost));
  const profit = revenue - cost;

  const refundMap = Object.fromEntries(refundsByMethod.map((r) => [r.refundMethod, r2(num(r._sum.refundTotal))]));
  const methods = new Set([...byMethod.map((m) => m.method), ...Object.keys(refundMap)]);

  return {
    range,
    financial: fin,
    totals: {
      count,
      units: sum(sales, (s) => s.units),
      gross: r2(gross),
      discount: r2(sum(sales, (s) => num(s.discount))),
      tax: r2(sum(sales, (s) => num(s.tax))),
      refunds: r2(refunds),
      returns: sum(returns, (r) => r.count),
      returnedUnits: sum(returns, (r) => r.units),
      net: r2(gross - refunds),
      averageTicket: count ? r2(gross / count) : 0,
      cancelled: { count: cancelled._count._all, total: r2(num(cancelled._sum.total)) },
      ...(fin
        ? {
            revenue: r2(revenue),
            cost: r2(cost),
            profit: r2(profit),
            // Margen sobre la venta (sin IVA) y sobre el costo; el propietario elige cuál se destaca
            margin: ratio(profit, revenue),
            markup: ratio(profit, cost),
            marginBasis: pricing.marginBasis,
          }
        : {}),
    },
    series,
    byMethod: [...methods].map((method) => {
      const m = byMethod.find((x) => x.method === method);
      const amount = num(m?.amount);
      const refunded = refundMap[method] ?? 0;
      return { method, count: m?.count ?? 0, amount: r2(amount), refunds: refunded, net: r2(amount - refunded) };
    }),
    byCashier: byCashier.map((c) => ({
      userId: c.id,
      fullName: `${c.first_name} ${c.last_name}`.trim(),
      count: c.count,
      total: r2(c.total),
      averageTicket: c.count ? r2(c.total / c.count) : 0,
      discount: r2(c.discount),
      cancelled: c.cancelled,
    })),
    byCategory: byCategory.map((c) => ({
      categoryId: c.id,
      name: c.name,
      units: c.units,
      total: r2(c.total),
      ...(fin ? { profit: r2(c.profit) } : {}),
    })),
    byHour: byHour.map((h) => ({ hour: h.hour, count: h.count, total: r2(h.total) })),
  };
}

// -----------------------------------------------------------------------------
// Productos: más vendidos y sin movimiento
// -----------------------------------------------------------------------------

export async function productsReport(auth: AuthContext, branchId: string, range: RangeDto, limit = 50) {
  const fin = isFinancial(auth);
  const { start, end } = window(range);
  const today = todayISO();

  const [top, slow, sold] = await Promise.all([
    prisma.$queryRaw<{ id: string; sku: string; name: string; category: string; units: number; returned: number; sales: number; total: number; profit: number }[]>`
      SELECT p.id, p.sku, p.commercial_name AS name, c.name AS category,
        SUM(si.quantity)::int AS units, SUM(si.returned_qty)::int AS returned, COUNT(DISTINCT s.id)::int AS sales,
        SUM(si.total)::float8 AS total, SUM(si.subtotal - si.unit_cost * si.quantity)::float8 AS profit
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      JOIN products p ON p.id = si.product_id
      JOIN categories c ON c.id = p.category_id
      WHERE s.branch_id = ${branchId}::uuid AND s.status <> 'CANCELLED' AND s.created_at >= ${start} AND s.created_at < ${end}
      GROUP BY p.id, c.name
      ORDER BY units DESC, total DESC, p.commercial_name
      LIMIT ${limit}`,
    // Con existencia vendible y sin ventas en el periodo; se ordena por el dinero detenido (a precio de venta)
    prisma.$queryRaw<{ id: string; sku: string; name: string; category: string; units: number; cost: number; retail: number; last_sale: Date | null; total_count: number }[]>`
      WITH stock AS (
        SELECT b.product_id, SUM(b.quantity)::int AS units, SUM(b.quantity * b.unit_cost)::float8 AS cost
        FROM product_batches b
        WHERE b.branch_id = ${branchId}::uuid AND b.status = 'ACTIVE' AND b.quantity > 0 AND b.expires_at >= ${today}::date
        GROUP BY b.product_id
      ), sold AS (
        SELECT DISTINCT si.product_id
        FROM sale_items si JOIN sales s ON s.id = si.sale_id
        WHERE s.branch_id = ${branchId}::uuid AND s.status <> 'CANCELLED' AND s.created_at >= ${start} AND s.created_at < ${end}
      )
      SELECT p.id, p.sku, p.commercial_name AS name, c.name AS category, st.units, st.cost,
        (st.units * p.sale_price)::float8 AS retail,
        (SELECT MAX(s2.created_at) FROM sale_items si2 JOIN sales s2 ON s2.id = si2.sale_id
          WHERE si2.product_id = p.id AND s2.branch_id = ${branchId}::uuid AND s2.status <> 'CANCELLED') AS last_sale,
        COUNT(*) OVER ()::int AS total_count
      FROM stock st
      JOIN products p ON p.id = st.product_id
      JOIN categories c ON c.id = p.category_id
      WHERE p.deleted_at IS NULL AND p.status = 'ACTIVE' AND NOT EXISTS (SELECT 1 FROM sold WHERE sold.product_id = p.id)
      ORDER BY retail DESC, p.commercial_name
      LIMIT ${limit}`,
    prisma.$queryRaw<{ products: number }[]>`
      SELECT COUNT(DISTINCT si.product_id)::int AS products
      FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE s.branch_id = ${branchId}::uuid AND s.status <> 'CANCELLED' AND s.created_at >= ${start} AND s.created_at < ${end}`,
  ]);

  return {
    range,
    financial: fin,
    productsSold: sold[0]?.products ?? 0,
    top: top.map((p) => ({
      productId: p.id,
      sku: p.sku,
      name: p.name,
      category: p.category,
      units: p.units,
      returned: p.returned,
      sales: p.sales,
      total: r2(p.total),
      ...(fin ? { profit: r2(p.profit) } : {}),
    })),
    slowCount: slow[0]?.total_count ?? 0,
    slow: slow.map((p) => ({
      productId: p.id,
      sku: p.sku,
      name: p.name,
      category: p.category,
      stock: p.units,
      retailValue: r2(p.retail),
      ...(fin ? { costValue: r2(p.cost) } : {}),
      lastSale: p.last_sale ? p.last_sale.toISOString() : null,
    })),
  };
}

// -----------------------------------------------------------------------------
// Inventario (fotografía al día de hoy)
// -----------------------------------------------------------------------------

export async function inventoryReport(auth: AuthContext, branchId: string) {
  const fin = isFinancial(auth);
  const today = todayISO();
  const { criticalDays } = await getSetting('alerts.expiry');
  const critical = shiftDate(today, criticalDays);

  const [byCategory, risk, levels] = await Promise.all([
    prisma.$queryRaw<{ id: string; name: string; products: number; units: number; cost: number; retail: number }[]>`
      SELECT c.id, c.name, COUNT(DISTINCT p.id)::int AS products, SUM(b.quantity)::int AS units,
        SUM(b.quantity * b.unit_cost)::float8 AS cost, SUM(b.quantity * p.sale_price)::float8 AS retail
      FROM product_batches b
      JOIN products p ON p.id = b.product_id
      JOIN categories c ON c.id = p.category_id
      WHERE b.branch_id = ${branchId}::uuid AND b.status = 'ACTIVE' AND b.quantity > 0 AND b.expires_at >= ${today}::date
        AND p.deleted_at IS NULL
      GROUP BY c.id ORDER BY retail DESC, c.name`,
    prisma.$queryRaw<
      { expired_units: number; expired_cost: number; expired_lots: number; quarantine_units: number; quarantine_cost: number; critical_units: number; critical_cost: number; critical_retail: number; critical_lots: number }[]
    >`
      SELECT
        COALESCE(SUM(b.quantity) FILTER (WHERE b.status = 'ACTIVE' AND b.expires_at < ${today}::date), 0)::int AS expired_units,
        COALESCE(SUM(b.quantity * b.unit_cost) FILTER (WHERE b.status = 'ACTIVE' AND b.expires_at < ${today}::date), 0)::float8 AS expired_cost,
        COUNT(*) FILTER (WHERE b.status = 'ACTIVE' AND b.expires_at < ${today}::date)::int AS expired_lots,
        COALESCE(SUM(b.quantity) FILTER (WHERE b.status = 'QUARANTINE'), 0)::int AS quarantine_units,
        COALESCE(SUM(b.quantity * b.unit_cost) FILTER (WHERE b.status = 'QUARANTINE'), 0)::float8 AS quarantine_cost,
        COALESCE(SUM(b.quantity) FILTER (WHERE b.status = 'ACTIVE' AND b.expires_at >= ${today}::date AND b.expires_at < ${critical}::date), 0)::int AS critical_units,
        COALESCE(SUM(b.quantity * b.unit_cost) FILTER (WHERE b.status = 'ACTIVE' AND b.expires_at >= ${today}::date AND b.expires_at < ${critical}::date), 0)::float8 AS critical_cost,
        COALESCE(SUM(b.quantity * p.sale_price) FILTER (WHERE b.status = 'ACTIVE' AND b.expires_at >= ${today}::date AND b.expires_at < ${critical}::date), 0)::float8 AS critical_retail,
        COUNT(*) FILTER (WHERE b.status = 'ACTIVE' AND b.expires_at >= ${today}::date AND b.expires_at < ${critical}::date)::int AS critical_lots
      FROM product_batches b JOIN products p ON p.id = b.product_id
      WHERE b.branch_id = ${branchId}::uuid AND b.quantity > 0 AND p.deleted_at IS NULL`,
    stockLevels(branchId, today),
  ]);

  const r = risk[0]!;
  const sum = (f: (c: (typeof byCategory)[number]) => number) => byCategory.reduce((acc, c) => acc + f(c), 0);
  return {
    today,
    financial: fin,
    totals: {
      products: sum((c) => c.products),
      units: sum((c) => c.units),
      retailValue: r2(sum((c) => c.retail)),
      ...(fin ? { costValue: r2(sum((c) => c.cost)), potentialProfit: r2(sum((c) => c.retail - c.cost)) } : {}),
      ...levels,
    },
    byCategory: byCategory.map((c) => ({
      categoryId: c.id,
      name: c.name,
      products: c.products,
      units: c.units,
      retailValue: r2(c.retail),
      ...(fin ? { costValue: r2(c.cost) } : {}),
    })),
    risk: {
      criticalDays,
      expiringSoon: { lots: r.critical_lots, units: r.critical_units, retailValue: r2(r.critical_retail), ...(fin ? { costValue: r2(r.critical_cost) } : {}) },
      expired: { lots: r.expired_lots, units: r.expired_units, ...(fin ? { costValue: r2(r.expired_cost) } : {}) },
      quarantine: { units: r.quarantine_units, ...(fin ? { costValue: r2(r.quarantine_cost) } : {}) },
    },
  };
}

/** Productos activos agotados o bajo su mínimo (sólo los que tienen mínimo definido). */
async function stockLevels(branchId: string, today: string) {
  const rows = await prisma.$queryRaw<{ out_of_stock: number; low_stock: number }[]>`
    SELECT
      COUNT(*) FILTER (WHERE i.min_stock > 0 AND a.available = 0)::int AS out_of_stock,
      COUNT(*) FILTER (WHERE i.min_stock > 0 AND a.available > 0 AND a.available <= i.min_stock)::int AS low_stock
    FROM products p
    JOIN inventory i ON i.product_id = p.id AND i.branch_id = ${branchId}::uuid
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(b.quantity), 0) AS available FROM product_batches b
      WHERE b.product_id = p.id AND b.branch_id = ${branchId}::uuid AND b.status = 'ACTIVE' AND b.expires_at >= ${today}::date
    ) a ON true
    WHERE p.deleted_at IS NULL AND p.status = 'ACTIVE'`;
  return { outOfStock: rows[0]?.out_of_stock ?? 0, lowStock: rows[0]?.low_stock ?? 0 };
}

// -----------------------------------------------------------------------------
// Mermas y ajustes
// -----------------------------------------------------------------------------

const LOSS_TYPES = Prisma.sql`('EXPIRED', 'DAMAGED', 'SHRINKAGE', 'ADJUSTMENT_OUT')`;

export async function shrinkageReport(auth: AuthContext, branchId: string, range: RangeDto) {
  const fin = isFinancial(auth);
  const { start, end } = window(range);
  const scope = Prisma.sql`m.branch_id = ${branchId}::uuid AND m.created_at >= ${start} AND m.created_at < ${end}`;

  const [byReason, discarded, top, series] = await Promise.all([
    prisma.$queryRaw<{ type: string; reason: string | null; movements: number; units: number; cost: number }[]>`
      SELECT m.type::text AS type, m.reason::text AS reason, COUNT(*)::int AS movements,
        SUM(ABS(m.quantity_change))::int AS units,
        SUM(ABS(m.quantity_change) * COALESCE(m.unit_cost, b.unit_cost))::float8 AS cost
      FROM inventory_movements m JOIN product_batches b ON b.id = m.batch_id
      WHERE ${scope} AND (m.type IN ${LOSS_TYPES} OR m.type = 'ADJUSTMENT_IN')
      GROUP BY 1, 2`,
    // Producto devuelto por clientes que se desechó (no regresó al inventario)
    prisma.$queryRaw<{ items: number; units: number; cost: number }[]>`
      SELECT COUNT(*)::int AS items, COALESCE(SUM(ri.quantity), 0)::int AS units,
        COALESCE(SUM(ri.quantity * si.unit_cost), 0)::float8 AS cost
      FROM return_items ri
      JOIN returns r ON r.id = ri.return_id
      JOIN sale_items si ON si.id = ri.sale_item_id
      WHERE r.branch_id = ${branchId}::uuid AND ri.disposition = 'DISCARDED'
        AND COALESCE(ri.reviewed_at, r.created_at) >= ${start} AND COALESCE(ri.reviewed_at, r.created_at) < ${end}`,
    prisma.$queryRaw<{ id: string; sku: string; name: string; units: number; cost: number }[]>`
      SELECT p.id, p.sku, p.commercial_name AS name, SUM(ABS(m.quantity_change))::int AS units,
        SUM(ABS(m.quantity_change) * COALESCE(m.unit_cost, b.unit_cost))::float8 AS cost
      FROM inventory_movements m
      JOIN product_batches b ON b.id = m.batch_id
      JOIN products p ON p.id = m.product_id
      WHERE ${scope} AND m.type IN ${LOSS_TYPES}
      GROUP BY p.id
      ORDER BY ${fin ? Prisma.sql`cost` : Prisma.sql`units`} DESC, p.commercial_name
      LIMIT 20`,
    prisma.$queryRaw<{ bucket: string; units: number; cost: number }[]>`
      SELECT ${bucketSql(Prisma.sql`m.created_at`, range.groupBy)} AS bucket,
        SUM(ABS(m.quantity_change))::int AS units,
        SUM(ABS(m.quantity_change) * COALESCE(m.unit_cost, b.unit_cost))::float8 AS cost
      FROM inventory_movements m JOIN product_batches b ON b.id = m.batch_id
      WHERE ${scope} AND m.type IN ${LOSS_TYPES}
      GROUP BY 1`,
  ]);

  const losses = byReason.filter((r) => r.type !== 'ADJUSTMENT_IN');
  const gains = byReason.filter((r) => r.type === 'ADJUSTMENT_IN');
  const d = discarded[0]!;
  const lossUnits = losses.reduce((s, r) => s + r.units, 0) + d.units;
  const lossCost = losses.reduce((s, r) => s + r.cost, 0) + d.cost;
  const gainUnits = gains.reduce((s, r) => s + r.units, 0);
  const gainCost = gains.reduce((s, r) => s + r.cost, 0);
  const seriesBy = byKey(series);
  const money = <T extends object>(value: number, rest: T) => (fin ? { ...rest, cost: r2(value) } : rest);

  return {
    range,
    financial: fin,
    totals: {
      lossUnits,
      gainUnits,
      ...(fin ? { lossCost: r2(lossCost), gainCost: r2(gainCost), netCost: r2(lossCost - gainCost) } : {}),
    },
    // Salidas agrupadas por motivo (el tipo de movimiento cuando no hay motivo)
    losses: [
      ...losses.map((r) => money(r.cost, { type: r.type, reason: r.reason, movements: r.movements, units: r.units })),
      ...(d.items ? [money(d.cost, { type: 'CUSTOMER_RETURN_DISCARDED', reason: null, movements: d.items, units: d.units })] : []),
    ].sort((a, b) => ('cost' in a && 'cost' in b ? (b.cost as number) - (a.cost as number) : b.units - a.units)),
    gains: gains.map((r) => money(r.cost, { type: r.type, reason: r.reason, movements: r.movements, units: r.units })),
    top: top.map((p) => money(p.cost, { productId: p.id, sku: p.sku, name: p.name, units: p.units })),
    series: bucketsInRange(range.from, range.to, range.groupBy).map((period) => {
      const s = seriesBy.get(period);
      return money(num(s?.cost), { period, units: s?.units ?? 0 });
    }),
  };
}

// -----------------------------------------------------------------------------
// Compras (sólo con permiso financiero)
// -----------------------------------------------------------------------------

export async function purchasesReport(auth: AuthContext, branchId: string, range: RangeDto) {
  if (!isFinancial(auth)) throw AppError.forbidden('Necesitas permiso de reportes financieros');
  const today = todayISO();
  const inRange = Prisma.sql`p.branch_id = ${branchId}::uuid AND p.status = 'RECEIVED' AND p.purchase_date >= ${range.from}::date AND p.purchase_date <= ${range.to}::date`;

  const [bySupplier, payables, series] = await Promise.all([
    prisma.$queryRaw<{ id: string; name: string; count: number; subtotal: number; tax: number; total: number; paid: number }[]>`
      SELECT sup.id, sup.trade_name AS name, COUNT(*)::int AS count, SUM(p.subtotal)::float8 AS subtotal,
        SUM(p.tax_total)::float8 AS tax, SUM(p.total)::float8 AS total, SUM(p.amount_paid)::float8 AS paid
      FROM purchases p JOIN suppliers sup ON sup.id = p.supplier_id
      WHERE ${inRange}
      GROUP BY sup.id ORDER BY total DESC, sup.trade_name`,
    // Cuentas por pagar: toda compra recibida con saldo, sin importar el periodo
    prisma.$queryRaw<{ id: string; name: string; count: number; balance: number; overdue: number; next_due: Date | null }[]>`
      SELECT sup.id, sup.trade_name AS name, COUNT(*)::int AS count,
        SUM(p.total - p.amount_paid)::float8 AS balance,
        COALESCE(SUM(p.total - p.amount_paid) FILTER (WHERE p.payment_due_date < ${today}::date), 0)::float8 AS overdue,
        MIN(p.payment_due_date) FILTER (WHERE p.payment_due_date >= ${today}::date) AS next_due
      FROM purchases p JOIN suppliers sup ON sup.id = p.supplier_id
      WHERE p.branch_id = ${branchId}::uuid AND p.status = 'RECEIVED' AND p.payment_status <> 'PAID'
      GROUP BY sup.id ORDER BY balance DESC, sup.trade_name`,
    prisma.$queryRaw<{ bucket: string; count: number; total: number }[]>`
      SELECT to_char(date_trunc(${range.groupBy}::text, p.purchase_date), 'YYYY-MM-DD') AS bucket,
        COUNT(*)::int AS count, SUM(p.total)::float8 AS total
      FROM purchases p
      WHERE ${inRange}
      GROUP BY 1`,
  ]);

  const seriesBy = byKey(series);
  const total = bySupplier.reduce((s, x) => s + x.total, 0);
  return {
    range,
    financial: true,
    totals: {
      count: bySupplier.reduce((s, x) => s + x.count, 0),
      subtotal: r2(bySupplier.reduce((s, x) => s + x.subtotal, 0)),
      tax: r2(bySupplier.reduce((s, x) => s + x.tax, 0)),
      total: r2(total),
      paid: r2(bySupplier.reduce((s, x) => s + x.paid, 0)),
      payable: r2(payables.reduce((s, x) => s + x.balance, 0)),
      overdue: r2(payables.reduce((s, x) => s + x.overdue, 0)),
    },
    bySupplier: bySupplier.map((s) => ({
      supplierId: s.id,
      name: s.name,
      count: s.count,
      subtotal: r2(s.subtotal),
      tax: r2(s.tax),
      total: r2(s.total),
      paid: r2(s.paid),
      share: ratio(s.total, total),
    })),
    payables: payables.map((p) => ({
      supplierId: p.id,
      name: p.name,
      count: p.count,
      balance: r2(p.balance),
      overdue: r2(p.overdue),
      nextDue: p.next_due ? dateOnly(p.next_due) : null,
    })),
    series: bucketsInRange(range.from, range.to, range.groupBy).map((period) => {
      const s = seriesBy.get(period);
      return { period, count: s?.count ?? 0, total: r2(num(s?.total)) };
    }),
  };
}

// -----------------------------------------------------------------------------
// Dashboard: lo que cada quien puede ver de su sucursal, hoy
// -----------------------------------------------------------------------------

export async function dashboard(auth: AuthContext, branchId: string) {
  const today = todayISO();
  const yesterday = shiftDate(today, -1);
  const weekStart = shiftDate(today, -6);
  const fin = isFinancial(auth);
  // Sin permiso de reportes cada quien ve sólo sus ventas (igual que en el historial)
  const salesScope = can(auth, 'sales.view') ? (can(auth, 'reports.view') ? 'branch' : 'own') : null;
  const own = salesScope === 'own' ? auth.userId : undefined;

  const [sales, inventory, expirations, returns, purchases] = await Promise.all([
    salesScope ? dashboardSales(branchId, today, yesterday, weekStart, own, fin && salesScope === 'branch') : null,
    can(auth, 'inventory.view') ? dashboardInventory(branchId, today, fin) : null,
    can(auth, 'expirations.view') ? dashboardExpirations(branchId, today) : null,
    can(auth, 'returns.view')
      ? prisma.returnItem.count({ where: { disposition: 'QUARANTINE', reviewedAt: null, return: { branchId } } }).then((pendingReview) => ({ pendingReview }))
      : null,
    // Los saldos con proveedores sólo para quien los paga (igual que sus alertas)
    can(auth, 'purchases.view') ? dashboardPurchases(branchId, today, can(auth, 'purchases.pay')) : null,
  ]);

  return { today, salesScope, sales, inventory, expirations, returns, purchases };
}

async function dashboardSales(branchId: string, today: string, yesterday: string, weekStart: string, createdById: string | undefined, withProfit: boolean) {
  const start = startOfDay(weekStart);
  const end = endOfDayExclusive(today);
  const [days, refunds, top, recent] = await Promise.all([
    salesBuckets(branchId, start, end, 'day', createdById),
    returnsBuckets(branchId, start, end, 'day', createdById),
    prisma.$queryRaw<{ id: string; name: string; units: number; total: number }[]>`
      SELECT p.id, p.commercial_name AS name, SUM(si.quantity)::int AS units, SUM(si.total)::float8 AS total
      FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
      WHERE s.branch_id = ${branchId}::uuid AND s.status <> 'CANCELLED' AND s.created_at >= ${start} AND s.created_at < ${end}
        ${createdById ? Prisma.sql`AND s.created_by_id = ${createdById}::uuid` : Prisma.empty}
      GROUP BY p.id ORDER BY units DESC, total DESC, p.commercial_name LIMIT 5`,
    prisma.sale.findMany({
      where: { branchId, ...(createdById ? { createdById } : {}) },
      select: { id: true, number: true, createdAt: true, total: true, status: true, createdBy: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
  ]);
  const dayBy = byKey(days);
  const refundBy = byKey(refunds);
  const summary = (date: string) => {
    const d = dayBy.get(date);
    const r = refundBy.get(date);
    const total = num(d?.total);
    return {
      total: r2(total),
      count: d?.count ?? 0,
      units: d?.units ?? 0,
      refunds: r2(num(r?.refunds)),
      averageTicket: d?.count ? r2(total / d.count) : 0,
      ...(withProfit ? { profit: r2(num(d?.subtotal) - num(d?.cost) - (num(r?.subtotal) - num(r?.cost))) } : {}),
    };
  };
  return {
    today: summary(today),
    yesterday: summary(yesterday),
    last7: bucketsInRange(weekStart, today, 'day').map((date) => ({ date, total: r2(num(dayBy.get(date)?.total)), count: dayBy.get(date)?.count ?? 0 })),
    top: top.map((p) => ({ productId: p.id, name: p.name, units: p.units, total: r2(p.total) })),
    recent: recent.map((s) => ({
      id: s.id,
      folio: formatSaleNumber(s.number),
      createdAt: s.createdAt.toISOString(),
      total: Number(s.total),
      status: s.status,
      createdBy: `${s.createdBy.firstName} ${s.createdBy.lastName}`.trim(),
    })),
  };
}

async function dashboardInventory(branchId: string, today: string, fin: boolean) {
  const [levels, value] = await Promise.all([
    stockLevels(branchId, today),
    fin
      ? prisma.$queryRaw<{ cost: number; retail: number }[]>`
          SELECT COALESCE(SUM(b.quantity * b.unit_cost), 0)::float8 AS cost, COALESCE(SUM(b.quantity * p.sale_price), 0)::float8 AS retail
          FROM product_batches b JOIN products p ON p.id = b.product_id
          WHERE b.branch_id = ${branchId}::uuid AND b.status = 'ACTIVE' AND b.quantity > 0 AND b.expires_at >= ${today}::date AND p.deleted_at IS NULL`
      : null,
  ]);
  return { ...levels, ...(value ? { costValue: r2(value[0]!.cost), retailValue: r2(value[0]!.retail) } : {}) };
}

async function dashboardExpirations(branchId: string, today: string) {
  const { criticalDays } = await getSetting('alerts.expiry');
  const critical = shiftDate(today, criticalDays);
  const rows = await prisma.$queryRaw<{ expiring_lots: number; expiring_units: number; expired_lots: number; expired_units: number }[]>`
    SELECT
      COUNT(*) FILTER (WHERE b.status = 'ACTIVE' AND b.expires_at >= ${today}::date AND b.expires_at < ${critical}::date)::int AS expiring_lots,
      COALESCE(SUM(b.quantity) FILTER (WHERE b.status = 'ACTIVE' AND b.expires_at >= ${today}::date AND b.expires_at < ${critical}::date), 0)::int AS expiring_units,
      COUNT(*) FILTER (WHERE b.expires_at < ${today}::date)::int AS expired_lots,
      COALESCE(SUM(b.quantity) FILTER (WHERE b.expires_at < ${today}::date), 0)::int AS expired_units
    FROM product_batches b JOIN products p ON p.id = b.product_id
    WHERE b.branch_id = ${branchId}::uuid AND b.quantity > 0 AND b.status IN ('ACTIVE', 'QUARANTINE') AND p.deleted_at IS NULL`;
  const r = rows[0]!;
  return { criticalDays, expiringLots: r.expiring_lots, expiringUnits: r.expiring_units, expiredLots: r.expired_lots, expiredUnits: r.expired_units };
}

async function dashboardPurchases(branchId: string, today: string, payables: boolean) {
  const soon = shiftDate(today, 7);
  const rows = await prisma.$queryRaw<{ overdue_count: number; overdue_amount: number; due_count: number; due_amount: number; pending_orders: number }[]>`
    SELECT
      COUNT(*) FILTER (WHERE p.status = 'RECEIVED' AND p.payment_status <> 'PAID' AND p.payment_due_date < ${today}::date)::int AS overdue_count,
      COALESCE(SUM(p.total - p.amount_paid) FILTER (WHERE p.status = 'RECEIVED' AND p.payment_status <> 'PAID' AND p.payment_due_date < ${today}::date), 0)::float8 AS overdue_amount,
      COUNT(*) FILTER (WHERE p.status = 'RECEIVED' AND p.payment_status <> 'PAID' AND p.payment_due_date >= ${today}::date AND p.payment_due_date <= ${soon}::date)::int AS due_count,
      COALESCE(SUM(p.total - p.amount_paid) FILTER (WHERE p.status = 'RECEIVED' AND p.payment_status <> 'PAID' AND p.payment_due_date >= ${today}::date AND p.payment_due_date <= ${soon}::date), 0)::float8 AS due_amount,
      COUNT(*) FILTER (WHERE p.status IN ('DRAFT', 'ORDERED'))::int AS pending_orders
    FROM purchases p
    WHERE p.branch_id = ${branchId}::uuid`;
  const r = rows[0]!;
  return {
    pendingOrders: r.pending_orders,
    ...(payables
      ? { overdue: { count: r.overdue_count, amount: r2(r.overdue_amount) }, dueSoon: { count: r.due_count, amount: r2(r.due_amount) } }
      : {}),
  };
}
