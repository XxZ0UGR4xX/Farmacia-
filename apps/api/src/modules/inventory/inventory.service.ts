import {
  ADJUSTMENT_REASON_LABELS,
  adjustmentMovementType,
  classifyExpiry,
  daysBetween,
  MOVEMENT_TYPE_LABELS,
  normalizeSearch,
  PRESENTATION_LABELS,
  type ExpiryStatus,
  type Presentation,
} from '@farmacia/shared';
import { Prisma } from '../../generated/prisma/client';
import { dateOnly, endOfDayExclusive, parseDateOnly, startOfDay, todayISO } from '../../lib/dates';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../shared/errors';
import { paginated, toSkipTake, type Paginated } from '../../shared/pagination';
import type { AuthContext, ClientInfo } from '../../shared/request-context';
import { recordAudit } from '../audit/audit.service';
import { canSeeCosts } from '../products/products.service';
import { getSetting } from '../settings/settings.service';
import { applyMovement, receiveStock } from './inventory.core';
import type { AdjustmentDto, BatchesQueryDto, EntryDto, MovementsQueryDto, StockQueryDto } from './inventory.schemas';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Escapa comodines de LIKE en texto del usuario. */
const likeTerm = (t: string) => `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

// -----------------------------------------------------------------------------
// Existencias por producto (calculadas desde los lotes)
// -----------------------------------------------------------------------------

export type StockStatus = 'OUT' | 'LOW' | 'OK' | 'OVER';

export interface StockRowDto {
  productId: string;
  sku: string;
  barcode: string | null;
  commercialName: string;
  concentration: string | null;
  pharmaceuticalForm: string | null;
  presentation: Presentation;
  contentQuantity: string | null;
  category: string;
  productStatus: string;
  imageUrl: string | null;
  /** Vendible: lotes activos sin caducar */
  available: number;
  expired: number;
  quarantine: number;
  batches: number;
  nextExpiry: string | null;
  daysToExpiry: number | null;
  expiryStatus: ExpiryStatus | null;
  minStock: number;
  maxStock: number | null;
  location: string | null;
  stockStatus: StockStatus;
  /** Valor al costo (sólo para quien puede ver costos) */
  value?: number;
}

interface StockRaw {
  id: string;
  sku: string;
  barcode: string | null;
  commercial_name: string;
  concentration: string | null;
  pharmaceutical_form: string | null;
  presentation: Presentation;
  content_quantity: string | null;
  category_name: string;
  status: string;
  image_url: string | null;
  available: number;
  expired: number;
  quarantine: number;
  batches: number;
  value: Prisma.Decimal;
  next_expiry: Date | null;
  min_stock: number;
  max_stock: number | null;
  location: string | null;
  stock_status: StockStatus;
  total: bigint;
}

/** CTE con las existencias por producto de una sucursal. "today" define qué está caducado. */
function stockRowsSql(branchId: string, today: string, conditions: Prisma.Sql[]) {
  return Prisma.sql`
    WITH stock AS (
      SELECT b.product_id,
        COALESCE(SUM(b.quantity) FILTER (WHERE b.status = 'ACTIVE' AND b.expires_at >= ${today}::date), 0)::int AS available,
        COALESCE(SUM(b.quantity) FILTER (WHERE b.status = 'ACTIVE' AND b.expires_at < ${today}::date), 0)::int AS expired,
        COALESCE(SUM(b.quantity) FILTER (WHERE b.status = 'QUARANTINE'), 0)::int AS quarantine,
        COALESCE(SUM(b.quantity * b.unit_cost) FILTER (WHERE b.status IN ('ACTIVE', 'QUARANTINE')), 0) AS value,
        MIN(b.expires_at) FILTER (WHERE b.status = 'ACTIVE' AND b.quantity > 0 AND b.expires_at >= ${today}::date) AS next_expiry,
        COUNT(*) FILTER (WHERE b.quantity > 0)::int AS batches
      FROM product_batches b
      WHERE b.branch_id = ${branchId}::uuid
      GROUP BY b.product_id
    ),
    rows AS (
      SELECT p.id, p.sku, p.barcode, p.commercial_name, p.concentration, p.pharmaceutical_form,
        p.presentation, p.content_quantity, p.status, p.image_url, c.name AS category_name,
        COALESCE(s.available, 0) AS available, COALESCE(s.expired, 0) AS expired,
        COALESCE(s.quarantine, 0) AS quarantine, COALESCE(s.batches, 0) AS batches,
        COALESCE(s.value, 0) AS value, s.next_expiry,
        COALESCE(i.min_stock, 0) AS min_stock, i.max_stock, i.location,
        CASE
          WHEN COALESCE(s.available, 0) = 0 THEN 'OUT'
          WHEN COALESCE(s.available, 0) <= COALESCE(i.min_stock, 0) THEN 'LOW'
          WHEN i.max_stock IS NOT NULL AND s.available > i.max_stock THEN 'OVER'
          ELSE 'OK'
        END AS stock_status
      FROM products p
      JOIN categories c ON c.id = p.category_id
      LEFT JOIN stock s ON s.product_id = p.id
      LEFT JOIN inventory i ON i.product_id = p.id AND i.branch_id = ${branchId}::uuid
      WHERE ${Prisma.join(conditions, ' AND ')}
    )`;
}

function stockConditions(query: Pick<StockQueryDto, 'q' | 'categoryId'>): Prisma.Sql[] {
  const conditions = [Prisma.sql`p.deleted_at IS NULL`];
  const terms = query.q ? normalizeSearch(query.q).split(' ').filter(Boolean).slice(0, 8) : [];
  for (const t of terms) conditions.push(Prisma.sql`p.search_text LIKE ${likeTerm(t)}`);
  if (query.categoryId) conditions.push(Prisma.sql`p.category_id = ${query.categoryId}::uuid`);
  return conditions;
}

const STOCK_ORDER: Record<StockQueryDto['sort'], Prisma.Sql> = {
  name: Prisma.sql`commercial_name ASC, concentration ASC NULLS FIRST`,
  stock: Prisma.sql`available ASC, commercial_name ASC`,
  expiry: Prisma.sql`next_expiry ASC NULLS LAST, commercial_name ASC`,
};

function toStockDto(r: StockRaw, today: string, thresholds: { criticalDays: number; warningDays: number }, costs: boolean): StockRowDto {
  const nextExpiry = r.next_expiry ? dateOnly(r.next_expiry) : null;
  const daysToExpiry = nextExpiry ? daysBetween(today, nextExpiry) : null;
  return {
    productId: r.id,
    sku: r.sku,
    barcode: r.barcode,
    commercialName: r.commercial_name,
    concentration: r.concentration,
    pharmaceuticalForm: r.pharmaceutical_form,
    presentation: r.presentation,
    contentQuantity: r.content_quantity,
    category: r.category_name,
    productStatus: r.status,
    imageUrl: r.image_url,
    available: r.available,
    expired: r.expired,
    quarantine: r.quarantine,
    batches: r.batches,
    nextExpiry,
    daysToExpiry,
    expiryStatus: daysToExpiry === null ? null : classifyExpiry(daysToExpiry, thresholds.criticalDays, thresholds.warningDays),
    minStock: r.min_stock,
    maxStock: r.max_stock,
    location: r.location,
    stockStatus: r.stock_status,
    ...(costs ? { value: round2(Number(r.value)) } : {}),
  };
}

export interface StockSummary {
  activeProducts: number;
  withStock: number;
  outOfStock: number;
  lowStock: number;
  expiredUnits: number;
  /** Sólo para quien puede ver costos */
  inventoryValue?: number;
}

export async function getStock(
  auth: AuthContext,
  branchId: string,
  query: StockQueryDto,
): Promise<Paginated<StockRowDto> & { summary: StockSummary }> {
  const today = todayISO();
  const [thresholds, costs] = [await getSetting('alerts.expiry'), canSeeCosts(auth)];
  const { skip, take } = toSkipTake(query);
  const statusFilter = query.stockStatus ? Prisma.sql`stock_status = ${query.stockStatus}` : Prisma.sql`TRUE`;

  const rows = await prisma.$queryRaw<StockRaw[]>`
    ${stockRowsSql(branchId, today, stockConditions(query))}
    SELECT *, COUNT(*) OVER() AS total FROM rows
    WHERE ${statusFilter}
    ORDER BY ${STOCK_ORDER[query.sort]}
    LIMIT ${take} OFFSET ${skip}`;

  // Resumen de la sucursal (productos activos, sin filtros de búsqueda)
  const [summary] = await prisma.$queryRaw<
    { active: bigint; with_stock: bigint; out: bigint; low: bigint; expired_units: bigint; value: Prisma.Decimal }[]
  >`
    ${stockRowsSql(branchId, today, [Prisma.sql`p.deleted_at IS NULL`, Prisma.sql`p.status = 'ACTIVE'`])}
    SELECT COUNT(*) AS active,
      COUNT(*) FILTER (WHERE available > 0) AS with_stock,
      COUNT(*) FILTER (WHERE stock_status = 'OUT') AS out,
      COUNT(*) FILTER (WHERE stock_status = 'LOW') AS low,
      COALESCE(SUM(expired), 0) AS expired_units,
      COALESCE(SUM(value), 0) AS value
    FROM rows`;

  const total = rows[0] ? Number(rows[0].total) : 0;
  return {
    ...paginated(
      rows.map((r) => toStockDto(r, today, thresholds, costs)),
      total,
      query,
    ),
    summary: {
      activeProducts: Number(summary?.active ?? 0),
      withStock: Number(summary?.with_stock ?? 0),
      outOfStock: Number(summary?.out ?? 0),
      lowStock: Number(summary?.low ?? 0),
      expiredUnits: Number(summary?.expired_units ?? 0),
      ...(costs ? { inventoryValue: round2(Number(summary?.value ?? 0)) } : {}),
    },
  };
}

/** Todas las filas (sin paginar) para exportar. */
export async function getStockForExport(auth: AuthContext, branchId: string, query: StockQueryDto): Promise<StockRowDto[]> {
  const today = todayISO();
  const thresholds = await getSetting('alerts.expiry');
  const statusFilter = query.stockStatus ? Prisma.sql`stock_status = ${query.stockStatus}` : Prisma.sql`TRUE`;
  const rows = await prisma.$queryRaw<StockRaw[]>`
    ${stockRowsSql(branchId, today, stockConditions(query))}
    SELECT *, 0::bigint AS total FROM rows WHERE ${statusFilter} ORDER BY ${STOCK_ORDER[query.sort]}`;
  return rows.map((r) => toStockDto(r, today, thresholds, canSeeCosts(auth)));
}

// -----------------------------------------------------------------------------
// Lotes
// -----------------------------------------------------------------------------

const batchInclude = {
  product: { select: { id: true, sku: true, commercialName: true, concentration: true, presentation: true, contentQuantity: true } },
  supplier: { select: { id: true, tradeName: true } },
} satisfies Prisma.ProductBatchInclude;

type BatchRow = Prisma.ProductBatchGetPayload<{ include: typeof batchInclude }>;

export interface BatchDto {
  id: string;
  product: { id: string; sku: string; commercialName: string; concentration: string | null; presentation: string; contentQuantity: string | null };
  lotNumber: string;
  quantity: number;
  initialQuantity: number;
  expiresAt: string;
  manufacturedAt: string | null;
  daysLeft: number;
  expiryStatus: ExpiryStatus;
  status: string;
  /** Se puede vender: activo, sin caducar y con unidades */
  sellable: boolean;
  supplier: { id: string; name: string } | null;
  receivedAt: string;
  unitCost?: number;
  value?: number;
}

function toBatchDto(b: BatchRow, today: string, thresholds: { criticalDays: number; warningDays: number }, costs: boolean): BatchDto {
  const expiresAt = dateOnly(b.expiresAt);
  const daysLeft = daysBetween(today, expiresAt);
  const unitCost = Number(b.unitCost);
  return {
    id: b.id,
    product: { ...b.product, presentation: b.product.presentation },
    lotNumber: b.lotNumber,
    quantity: b.quantity,
    initialQuantity: b.initialQuantity,
    expiresAt,
    manufacturedAt: b.manufacturedAt ? dateOnly(b.manufacturedAt) : null,
    daysLeft,
    expiryStatus: classifyExpiry(daysLeft, thresholds.criticalDays, thresholds.warningDays),
    status: b.status,
    sellable: b.status === 'ACTIVE' && daysLeft >= 0 && b.quantity > 0,
    supplier: b.supplier ? { id: b.supplier.id, name: b.supplier.tradeName } : null,
    receivedAt: b.receivedAt.toISOString(),
    ...(costs ? { unitCost: round2(unitCost), value: round2(unitCost * b.quantity) } : {}),
  };
}

function addDays(date: string, days: number): Date {
  const d = parseDateOnly(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export async function listBatches(auth: AuthContext, branchId: string, query: BatchesQueryDto): Promise<Paginated<BatchDto>> {
  const today = todayISO();
  const thresholds = await getSetting('alerts.expiry');
  const terms = query.q ? normalizeSearch(query.q).split(' ').filter(Boolean).slice(0, 8) : [];

  const expiryWhere: Record<NonNullable<BatchesQueryDto['expiry']>, Prisma.ProductBatchWhereInput> = {
    EXPIRED: { expiresAt: { lt: parseDateOnly(today) } },
    CRITICAL: { expiresAt: { gte: parseDateOnly(today), lt: addDays(today, thresholds.criticalDays) } },
    WARNING: { expiresAt: { gte: addDays(today, thresholds.criticalDays), lte: addDays(today, thresholds.warningDays) } },
    OK: { expiresAt: { gt: addDays(today, thresholds.warningDays) } },
  };
  const statusWhere: Record<BatchesQueryDto['status'], Prisma.ProductBatchWhereInput> = {
    AVAILABLE: { status: 'ACTIVE', quantity: { gt: 0 } },
    DEPLETED: { status: 'DEPLETED' },
    QUARANTINE: { status: 'QUARANTINE' },
    ALL: {},
  };

  // Búsqueda por producto (todas las palabras) o por número de lote
  const searchWhere: Prisma.ProductBatchWhereInput = terms.length
    ? {
        OR: [
          { product: { AND: terms.map((t) => ({ searchText: { contains: t } })) } },
          { lotNumber: { contains: query.q!.trim().toUpperCase() } },
        ],
      }
    : {};
  const finalWhere: Prisma.ProductBatchWhereInput = {
    branchId,
    ...statusWhere[query.status],
    ...(query.expiry ? expiryWhere[query.expiry] : {}),
    ...(query.productId ? { productId: query.productId } : {}),
    product: { deletedAt: null },
    ...searchWhere,
  };

  const [rows, total] = await prisma.$transaction([
    prisma.productBatch.findMany({
      where: finalWhere,
      include: batchInclude,
      orderBy: [{ expiresAt: 'asc' }, { receivedAt: 'asc' }],
      ...toSkipTake(query),
    }),
    prisma.productBatch.count({ where: finalWhere }),
  ]);
  const costs = canSeeCosts(auth);
  return paginated(
    rows.map((b) => toBatchDto(b, today, thresholds, costs)),
    total,
    query,
  );
}

// -----------------------------------------------------------------------------
// Movimientos
// -----------------------------------------------------------------------------

const movementInclude = {
  product: { select: { id: true, sku: true, commercialName: true, concentration: true } },
  batch: { select: { id: true, lotNumber: true, expiresAt: true } },
  user: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.InventoryMovementInclude;

type MovementRow = Prisma.InventoryMovementGetPayload<{ include: typeof movementInclude }>;

export interface MovementDto {
  id: string;
  createdAt: string;
  type: string;
  reason: string | null;
  quantityBefore: number;
  quantityChange: number;
  quantityAfter: number;
  notes: string | null;
  referenceType: string | null;
  referenceId: string | null;
  product: { id: string; sku: string; commercialName: string; concentration: string | null };
  batch: { id: string; lotNumber: string; expiresAt: string };
  user: { id: string; fullName: string };
  unitCost?: number | null;
}

function toMovementDto(m: MovementRow, costs: boolean): MovementDto {
  return {
    id: m.id,
    createdAt: m.createdAt.toISOString(),
    type: m.type,
    reason: m.reason,
    quantityBefore: m.quantityBefore,
    quantityChange: m.quantityChange,
    quantityAfter: m.quantityAfter,
    notes: m.notes,
    referenceType: m.referenceType,
    referenceId: m.referenceId,
    product: m.product,
    batch: { id: m.batch.id, lotNumber: m.batch.lotNumber, expiresAt: dateOnly(m.batch.expiresAt) },
    user: { id: m.user.id, fullName: `${m.user.firstName} ${m.user.lastName}`.trim() },
    ...(costs ? { unitCost: m.unitCost === null ? null : round2(Number(m.unitCost)) } : {}),
  };
}

function movementsWhere(branchId: string, query: MovementsQueryDto): Prisma.InventoryMovementWhereInput {
  const terms = query.q ? normalizeSearch(query.q).split(' ').filter(Boolean).slice(0, 8) : [];
  return {
    branchId,
    ...(query.type?.length ? { type: { in: query.type } } : {}),
    ...(query.productId ? { productId: query.productId } : {}),
    ...(query.batchId ? { batchId: query.batchId } : {}),
    ...(query.userId ? { userId: query.userId } : {}),
    ...(query.from || query.to
      ? {
          createdAt: {
            ...(query.from ? { gte: startOfDay(query.from) } : {}),
            ...(query.to ? { lt: endOfDayExclusive(query.to) } : {}),
          },
        }
      : {}),
    ...(terms.length ? { product: { AND: terms.map((t) => ({ searchText: { contains: t } })) } } : {}),
  };
}

export async function listMovements(auth: AuthContext, branchId: string, query: MovementsQueryDto): Promise<Paginated<MovementDto>> {
  const where = movementsWhere(branchId, query);
  const [rows, total] = await prisma.$transaction([
    prisma.inventoryMovement.findMany({ where, include: movementInclude, orderBy: { createdAt: 'desc' }, ...toSkipTake(query) }),
    prisma.inventoryMovement.count({ where }),
  ]);
  const costs = canSeeCosts(auth);
  return paginated(
    rows.map((m) => toMovementDto(m, costs)),
    total,
    query,
  );
}

const EXPORT_LIMIT = 50_000;

export async function getMovementsForExport(auth: AuthContext, branchId: string, query: MovementsQueryDto): Promise<MovementDto[]> {
  const rows = await prisma.inventoryMovement.findMany({
    where: movementsWhere(branchId, query),
    include: movementInclude,
    orderBy: { createdAt: 'desc' },
    take: EXPORT_LIMIT,
  });
  return rows.map((m) => toMovementDto(m, canSeeCosts(auth)));
}

// -----------------------------------------------------------------------------
// Detalle de inventario de un producto
// -----------------------------------------------------------------------------

export async function getProductInventory(auth: AuthContext, branchId: string, productId: string) {
  const product = await prisma.product.findFirst({ where: { id: productId, deletedAt: null }, select: { id: true } });
  if (!product) throw AppError.notFound('Producto no encontrado');

  const today = todayISO();
  const thresholds = await getSetting('alerts.expiry');
  const costs = canSeeCosts(auth);
  const [batches, movements] = await Promise.all([
    prisma.productBatch.findMany({
      where: { branchId, productId },
      include: batchInclude,
      orderBy: [{ expiresAt: 'asc' }, { receivedAt: 'asc' }],
    }),
    prisma.inventoryMovement.findMany({
      where: { branchId, productId },
      include: movementInclude,
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ]);
  return {
    batches: batches.map((b) => toBatchDto(b, today, thresholds, costs)),
    movements: movements.map((m) => toMovementDto(m, costs)),
  };
}

// -----------------------------------------------------------------------------
// Comandos: entradas y ajustes
// -----------------------------------------------------------------------------

export async function registerEntry(auth: AuthContext, branchId: string, dto: EntryDto, client: ClientInfo) {
  const product = await prisma.product.findFirst({ where: { id: dto.productId, deletedAt: null } });
  if (!product) throw AppError.badRequest('El producto no existe', [{ path: 'productId', message: 'Producto inválido' }]);

  const today = todayISO();
  if (dto.expiresAt < today) {
    throw AppError.businessRule('No se puede registrar un lote ya caducado.');
  }
  // Sin permiso para ver costos, se usa el último costo del producto
  const unitCost = canSeeCosts(auth) && dto.unitCost !== undefined ? dto.unitCost : Number(product.purchasePrice);

  const result = await prisma.$transaction(async (tx) => {
    const received = await receiveStock(tx, {
      branchId,
      productId: product.id,
      lotNumber: dto.lotNumber,
      expiresAt: parseDateOnly(dto.expiresAt),
      manufacturedAt: dto.manufacturedAt ? parseDateOnly(dto.manufacturedAt) : null,
      quantity: dto.quantity,
      unitCost,
      type: dto.type,
      reason: dto.type === 'ADJUSTMENT_IN' ? dto.reason : null,
      notes: dto.notes,
      userId: auth.userId,
      referenceType: 'MANUAL_ENTRY',
    });
    await recordAudit(
      {
        action: 'INVENTORY_ENTRY',
        userId: auth.userId,
        branchId,
        entityType: 'batch',
        entityId: received.batchId,
        metadata: {
          product: product.commercialName,
          lotNumber: dto.lotNumber,
          expiresAt: dto.expiresAt,
          quantity: dto.quantity,
          type: dto.type,
          before: received.movement.quantityBefore,
          after: received.movement.quantityAfter,
          newBatch: received.createdBatch,
        },
        client,
      },
      tx,
    );
    return received;
  });

  const batch = await prisma.productBatch.findUniqueOrThrow({ where: { id: result.batchId }, include: batchInclude });
  const thresholds = await getSetting('alerts.expiry');
  return { batch: toBatchDto(batch, today, thresholds, canSeeCosts(auth)), createdBatch: result.createdBatch };
}

export async function adjustBatch(auth: AuthContext, branchId: string, dto: AdjustmentDto, client: ClientInfo) {
  const change = dto.direction === 'IN' ? dto.quantity : -dto.quantity;
  const type = adjustmentMovementType(dto.direction, dto.reason);

  const movement = await prisma.$transaction(async (tx) => {
    const created = await applyMovement(tx, {
      branchId,
      batchId: dto.batchId,
      type,
      change,
      reason: dto.reason,
      notes: dto.notes,
      userId: auth.userId,
      referenceType: 'MANUAL_ADJUSTMENT',
    });
    await recordAudit(
      {
        action: 'INVENTORY_ADJUST',
        userId: auth.userId,
        branchId,
        entityType: 'batch',
        entityId: dto.batchId,
        metadata: {
          movementId: created.id,
          type: MOVEMENT_TYPE_LABELS[type],
          reason: ADJUSTMENT_REASON_LABELS[dto.reason],
          before: created.quantityBefore,
          change: created.quantityChange,
          after: created.quantityAfter,
          notes: dto.notes,
        },
        client,
      },
      tx,
    );
    return tx.inventoryMovement.findUniqueOrThrow({ where: { id: created.id }, include: movementInclude });
  });
  return toMovementDto(movement, canSeeCosts(auth));
}

/** Etiquetas para exportaciones. */
export const exportLabels = { MOVEMENT_TYPE_LABELS, ADJUSTMENT_REASON_LABELS, PRESENTATION_LABELS };

// -----------------------------------------------------------------------------
// Caducidades
// -----------------------------------------------------------------------------

export type ExpiryClass = 'EXPIRED' | 'CRITICAL' | 'WARNING';

/**
 * Lotes con existencia que ya caducaron o caducan dentro de la ventana de aviso
 * (configuración `alerts.expiry`). Incluye los que están en cuarentena.
 */
export async function getExpirations(auth: AuthContext, branchId: string, cls?: ExpiryClass) {
  const today = todayISO();
  const thresholds = await getSetting('alerts.expiry');
  const costs = canSeeCosts(auth);
  const ranges: Record<ExpiryClass, Prisma.ProductBatchWhereInput> = {
    EXPIRED: { expiresAt: { lt: parseDateOnly(today) } },
    CRITICAL: { expiresAt: { gte: parseDateOnly(today), lt: addDays(today, thresholds.criticalDays) } },
    WARNING: { expiresAt: { gte: addDays(today, thresholds.criticalDays), lte: addDays(today, thresholds.warningDays) } },
  };
  const base: Prisma.ProductBatchWhereInput = { branchId, quantity: { gt: 0 }, status: { in: ['ACTIVE', 'QUARANTINE'] }, product: { deletedAt: null } };

  const [rows, ...groups] = await Promise.all([
    prisma.productBatch.findMany({
      where: { ...base, ...(cls ? ranges[cls] : { expiresAt: { lte: addDays(today, thresholds.warningDays) } }) },
      include: batchInclude,
      orderBy: [{ expiresAt: 'asc' }, { receivedAt: 'asc' }],
      take: 500,
    }),
    ...(['EXPIRED', 'CRITICAL', 'WARNING'] as const).map((c) =>
      prisma.productBatch.findMany({ where: { ...base, ...ranges[c] }, select: { productId: true, quantity: true, unitCost: true } }),
    ),
  ]);
  const summary = Object.fromEntries(
    (['EXPIRED', 'CRITICAL', 'WARNING'] as const).map((c, i) => {
      const list = groups[i]!;
      return [
        c,
        {
          batches: list.length,
          products: new Set(list.map((b) => b.productId)).size,
          units: list.reduce((s, b) => s + b.quantity, 0),
          ...(costs ? { value: Math.round(list.reduce((s, b) => s + b.quantity * Number(b.unitCost), 0) * 100) / 100 } : {}),
        },
      ];
    }),
  ) as Record<ExpiryClass, { batches: number; products: number; units: number; value?: number }>;
  return { summary, thresholds, data: rows.map((b) => toBatchDto(b, today, thresholds, costs)) };
}
