import type { Prisma, Supplier } from '../../generated/prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../shared/errors';
import { paginated, toSkipTake } from '../../shared/pagination';
import type { AuthContext, ClientInfo } from '../../shared/request-context';
import { recordAudit } from '../audit/audit.service';
import type { ListSuppliersDto, SupplierDto } from './suppliers.schemas';

/**
 * Proveedores. No se eliminan: se desactivan (sus compras e historial se conservan)
 * y un proveedor inactivo no admite compras nuevas.
 */

export interface SupplierStats {
  purchaseCount: number;
  totalPurchased: number;
  /** Saldo pendiente de pago de compras recibidas */
  balanceDue: number;
  lastPurchaseDate: string | null;
}

const EMPTY_STATS: SupplierStats = { purchaseCount: 0, totalPurchased: 0, balanceDue: 0, lastPurchaseDate: null };

function toDto(s: Supplier, stats: SupplierStats = EMPTY_STATS) {
  return {
    id: s.id,
    tradeName: s.tradeName,
    legalName: s.legalName,
    rfc: s.rfc,
    phone: s.phone,
    email: s.email,
    address: s.address,
    contactName: s.contactName,
    paymentTerms: s.paymentTerms,
    creditDays: s.creditDays,
    isActive: s.isActive,
    notes: s.notes,
    stats,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}
export type SupplierResponse = ReturnType<typeof toDto>;

/** Totales de compras por proveedor en la sucursal (las canceladas no cuentan). */
async function loadStats(supplierIds: string[], branchId: string): Promise<Map<string, SupplierStats>> {
  if (supplierIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<
    { supplier_id: string; purchases: number; total: Prisma.Decimal; balance: Prisma.Decimal; last_date: Date | null }[]
  >`
    SELECT supplier_id,
           COUNT(*)::int AS purchases,
           COALESCE(SUM(total), 0) AS total,
           COALESCE(SUM(total - amount_paid) FILTER (WHERE status = 'RECEIVED'), 0) AS balance,
           MAX(purchase_date) AS last_date
    FROM purchases
    WHERE branch_id = ${branchId}::uuid
      AND status <> 'CANCELLED'
      AND supplier_id = ANY(${supplierIds}::uuid[])
    GROUP BY supplier_id`;
  return new Map(
    rows.map((r) => [
      r.supplier_id,
      {
        purchaseCount: r.purchases,
        totalPurchased: Number(r.total),
        balanceDue: Math.max(0, Number(r.balance)),
        lastPurchaseDate: r.last_date ? r.last_date.toISOString().slice(0, 10) : null,
      },
    ]),
  );
}

export async function listSuppliers(branchId: string, query: ListSuppliersDto) {
  const where: Prisma.SupplierWhereInput = {
    deletedAt: null,
    ...(query.status === 'all' ? {} : { isActive: query.status === 'active' }),
    ...(query.q
      ? {
          OR: [
            { tradeName: { contains: query.q, mode: 'insensitive' } },
            { legalName: { contains: query.q, mode: 'insensitive' } },
            { rfc: { contains: query.q, mode: 'insensitive' } },
            { contactName: { contains: query.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.supplier.findMany({ where, orderBy: { tradeName: 'asc' }, ...toSkipTake(query) }),
    prisma.supplier.count({ where }),
  ]);
  const stats = await loadStats(rows.map((r) => r.id), branchId);
  return paginated(
    rows.map((r) => toDto(r, stats.get(r.id))),
    total,
    query,
  );
}

/** Lista corta para selectores (sólo activos). */
export async function supplierOptions() {
  const rows = await prisma.supplier.findMany({
    where: { deletedAt: null, isActive: true },
    orderBy: { tradeName: 'asc' },
    select: { id: true, tradeName: true, creditDays: true },
  });
  return rows;
}

async function findOrThrow(id: string): Promise<Supplier> {
  const s = await prisma.supplier.findFirst({ where: { id, deletedAt: null } });
  if (!s) throw AppError.notFound('El proveedor no existe');
  return s;
}

export async function getSupplier(branchId: string, id: string) {
  const s = await findOrThrow(id);
  const stats = await loadStats([id], branchId);
  return toDto(s, stats.get(id));
}

async function assertUnique(dto: Partial<SupplierDto>, exceptId?: string) {
  const not = exceptId ? { id: { not: exceptId } } : {};
  if (dto.tradeName) {
    const byName = await prisma.supplier.findFirst({
      where: { tradeName: { equals: dto.tradeName, mode: 'insensitive' }, deletedAt: null, ...not },
    });
    if (byName) throw AppError.conflict('Ya existe un proveedor con ese nombre', [{ path: 'tradeName', message: 'Nombre en uso' }]);
  }
  if (dto.rfc) {
    const byRfc = await prisma.supplier.findFirst({ where: { rfc: dto.rfc, ...not } });
    if (byRfc) {
      throw AppError.conflict(`El RFC ya está registrado para ${byRfc.tradeName}`, [{ path: 'rfc', message: 'RFC en uso' }]);
    }
  }
}

export async function createSupplier(actor: AuthContext, dto: SupplierDto, client: ClientInfo) {
  await assertUnique(dto);
  const saved = await prisma.$transaction(async (tx) => {
    const s = await tx.supplier.create({ data: dto });
    await recordAudit(
      { action: 'SUPPLIER_CREATE', userId: actor.userId, entityType: 'supplier', entityId: s.id, metadata: { tradeName: s.tradeName, rfc: s.rfc }, client },
      tx,
    );
    return s;
  });
  return toDto(saved);
}

export async function updateSupplier(actor: AuthContext, branchId: string, id: string, dto: Partial<SupplierDto>, client: ClientInfo) {
  const current = await findOrThrow(id);
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [field, value] of Object.entries(dto) as [keyof SupplierDto, unknown][]) {
    if (value !== undefined && value !== current[field]) changes[field] = { from: current[field] ?? null, to: value };
  }
  if (Object.keys(changes).length === 0) return getSupplier(branchId, id);
  await assertUnique(
    { tradeName: changes.tradeName ? dto.tradeName : undefined, rfc: changes.rfc ? dto.rfc : undefined },
    id,
  );
  await prisma.$transaction(async (tx) => {
    await tx.supplier.update({ where: { id }, data: dto });
    await recordAudit(
      { action: 'SUPPLIER_UPDATE', userId: actor.userId, entityType: 'supplier', entityId: id, metadata: changes as Prisma.InputJsonValue, client },
      tx,
    );
  });
  return getSupplier(branchId, id);
}

export async function setSupplierActive(actor: AuthContext, branchId: string, id: string, isActive: boolean, client: ClientInfo) {
  const current = await findOrThrow(id);
  if (current.isActive !== isActive) {
    await prisma.$transaction(async (tx) => {
      await tx.supplier.update({ where: { id }, data: { isActive } });
      await recordAudit(
        {
          action: isActive ? 'SUPPLIER_ACTIVATE' : 'SUPPLIER_DEACTIVATE',
          userId: actor.userId,
          entityType: 'supplier',
          entityId: id,
          metadata: { tradeName: current.tradeName },
          client,
        },
        tx,
      );
    });
  }
  return getSupplier(branchId, id);
}
