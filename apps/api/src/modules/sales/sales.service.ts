import {
  cashChange,
  formatPrescriptionNumber,
  formatReturnNumber,
  formatSaleNumber,
  hasPermission,
  PAYMENT_METHOD_LABELS,
  saleLineAmounts,
  saleTotals,
} from '@farmacia/shared';
import { Prisma } from '../../generated/prisma/client';
import { dateOnly, endOfDayExclusive, startOfDay, todayISO } from '../../lib/dates';
import { prisma, type DbClient, type TxClient } from '../../lib/prisma';
import { AppError } from '../../shared/errors';
import { paginated, toSkipTake } from '../../shared/pagination';
import type { AuthContext, ClientInfo } from '../../shared/request-context';
import { recordAudit } from '../audit/audit.service';
import { allocateFefo, applyMovement } from '../inventory/inventory.core';
import { canSeeCosts } from '../products/products.service';
import { createPrescriptionInTx } from '../patients/prescriptions.service';
import { getSetting } from '../settings/settings.service';
import type { CreateSaleDto, ListSalesDto } from './sales.schemas';

/**
 * Ventas de mostrador.
 * - Precios, IVA y totales los calcula el servidor desde el catálogo.
 * - Cada partida se surte con FEFO (lote que caduca primero) y cada lote usado genera su
 *   movimiento SALE; todo en una sola transacción con los lotes bloqueados.
 * - Un reintento con el mismo `clientRequestId` devuelve la venta ya registrada (no cobra dos veces).
 * - Cancelar regresa las unidades a los mismos lotes de los que salieron.
 */

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const userName = { select: { id: true, firstName: true, lastName: true } } as const;
const fullName = (u: { id: string; firstName: string; lastName: string } | null) =>
  u ? { id: u.id, fullName: `${u.firstName} ${u.lastName}`.trim() } : null;

export const saleInclude = {
  items: {
    include: {
      product: { select: { id: true, sku: true, barcode: true, commercialName: true, concentration: true, presentation: true, requiresPrescription: true, isControlled: true } },
      batches: { include: { batch: { select: { id: true, lotNumber: true, expiresAt: true } } } },
    },
    orderBy: { position: 'asc' },
  },
  payments: { orderBy: { createdAt: 'asc' } },
  returns: {
    include: {
      user: userName,
      items: { include: { batch: { select: { lotNumber: true } } } },
    },
    orderBy: { createdAt: 'asc' },
  },
  createdBy: userName,
  cancelledBy: userName,
  branch: { select: { id: true, name: true, address: true, phone: true } },
  patient: { select: { id: true, firstName: true, lastName: true } },
  prescription: { select: { id: true, number: true, doctorName: true } },
} satisfies Prisma.SaleInclude;

type SaleRow = Prisma.SaleGetPayload<{ include: typeof saleInclude }>;

async function ticketHeader() {
  const [profile, fiscal] = await Promise.all([getSetting('pharmacy.profile'), getSetting('pharmacy.fiscal')]);
  return { name: profile.name, address: profile.address ?? null, phone: profile.phone ?? null, rfc: fiscal.rfc ?? null, legalName: fiscal.legalName ?? null };
}

function toDto(s: SaleRow, opts: { costs: boolean; patients?: boolean; header?: Awaited<ReturnType<typeof ticketHeader>> }) {
  const costTotal = Number(s.costTotal);
  const refunded = r2(s.returns.reduce((sum, r) => sum + Number(r.refundTotal), 0));
  return {
    id: s.id,
    number: s.number,
    folio: formatSaleNumber(s.number),
    status: s.status,
    branch: s.branch,
    subtotal: Number(s.subtotal),
    discountTotal: Number(s.discountTotal),
    taxTotal: Number(s.taxTotal),
    total: Number(s.total),
    refunded,
    ...(opts.costs ? { costTotal, profit: r2(Number(s.subtotal) - costTotal) } : {}),
    prescriptionChecked: s.prescriptionChecked,
    // Datos del paciente sólo para quien puede ver pacientes
    patient: s.patient && opts.patients ? { id: s.patient.id, fullName: `${s.patient.firstName} ${s.patient.lastName}`.trim() } : null,
    hasPatient: s.patient !== null,
    prescription: s.prescription && opts.patients ? { id: s.prescription.id, folio: formatPrescriptionNumber(s.prescription.number), doctorName: s.prescription.doctorName } : null,
    notes: s.notes,
    items: s.items.map((i) => ({
      id: i.id,
      product: i.product,
      quantity: i.quantity,
      returnedQty: i.returnedQty,
      unitPrice: Number(i.unitPrice),
      discount: Number(i.discount),
      taxRate: Number(i.taxRate),
      taxAmount: Number(i.taxAmount),
      subtotal: Number(i.subtotal),
      total: Number(i.total),
      ...(opts.costs ? { unitCost: Number(i.unitCost) } : {}),
      batches: i.batches.map((b) => ({ batchId: b.batchId, lotNumber: b.batch.lotNumber, expiresAt: dateOnly(b.batch.expiresAt), quantity: b.quantity })),
    })),
    payments: s.payments.map((p) => ({
      id: p.id,
      method: p.method,
      amount: Number(p.amount),
      received: p.received === null ? null : Number(p.received),
      change: p.change === null ? null : Number(p.change),
      reference: p.reference,
    })),
    returns: s.returns.map((r) => ({
      id: r.id,
      folio: formatReturnNumber(r.number),
      reason: r.reason,
      refundTotal: Number(r.refundTotal),
      refundMethod: r.refundMethod,
      createdAt: r.createdAt.toISOString(),
      user: fullName(r.user)!,
      items: r.items.map((ri) => ({ saleItemId: ri.saleItemId, lotNumber: ri.batch.lotNumber, quantity: ri.quantity, disposition: ri.disposition, refundAmount: Number(ri.refundAmount) })),
    })),
    createdBy: fullName(s.createdBy)!,
    cancelledBy: fullName(s.cancelledBy),
    cancelledAt: s.cancelledAt?.toISOString() ?? null,
    cancelReason: s.cancelReason,
    createdAt: s.createdAt.toISOString(),
    ...(opts.header ? { header: opts.header } : {}),
  };
}
export type SaleResponse = ReturnType<typeof toDto>;

async function findSale(db: DbClient, branchId: string, id: string): Promise<SaleRow> {
  const sale = await db.sale.findFirst({ where: { id, branchId }, include: saleInclude });
  if (!sale) throw AppError.notFound('La venta no existe');
  return sale;
}

export async function getSale(auth: AuthContext, branchId: string, id: string) {
  const [sale, header] = await Promise.all([findSale(prisma, branchId, id), ticketHeader()]);
  return toDto(sale, { costs: canSeeCosts(auth), patients: hasPermission(auth.roleCode, auth.permissions, 'patients.view'), header });
}

/** Bloquea la venta hasta el fin de la transacción (cancelación y devoluciones no se cruzan). */
export async function lockSale(tx: TxClient, branchId: string, id: string): Promise<SaleRow> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM sales WHERE id = ${id}::uuid AND branch_id = ${branchId}::uuid FOR UPDATE`;
  if (rows.length === 0) throw AppError.notFound('La venta no existe');
  return findSale(tx, branchId, id);
}

// -----------------------------------------------------------------------------
// Cobro
// -----------------------------------------------------------------------------

function itemError(index: number, field: string, err: AppError): never {
  throw new AppError(err.status, err.code, err.message, [{ path: `items.${index}.${field}`, message: err.message }]);
}

export async function createSale(auth: AuthContext, branchId: string, dto: CreateSaleDto, client: ClientInfo) {
  if (dto.clientRequestId) {
    const existing = await prisma.sale.findUnique({ where: { clientRequestId: dto.clientRequestId }, select: { id: true, branchId: true } });
    if (existing) {
      if (existing.branchId !== branchId) throw AppError.conflict('Identificador de cobro ya utilizado');
      return getSale(auth, branchId, existing.id);
    }
  }
  if (dto.items.some((i) => i.discount > 0) && !hasPermission(auth.roleCode, auth.permissions, 'sales.discount')) {
    throw AppError.forbidden('No tienes permiso para aplicar descuentos');
  }

  const products = await prisma.product.findMany({
    where: { id: { in: dto.items.map((i) => i.productId) }, deletedAt: null },
    select: { id: true, commercialName: true, concentration: true, salePrice: true, taxRate: true, status: true, requiresPrescription: true, isControlled: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  const { pricesIncludeTax } = await getSetting('pharmacy.taxes');

  const lines = dto.items.map((item, index) => {
    const product = byId.get(item.productId);
    if (!product) itemError(index, 'productId', AppError.badRequest('El producto no existe'));
    if (product.status !== 'ACTIVE') itemError(index, 'productId', AppError.businessRule(`${product.commercialName} no está activo para venta`));
    const unitPrice = Number(product.salePrice);
    const taxRate = Number(product.taxRate);
    const amounts = saleLineAmounts({ quantity: item.quantity, unitPrice, discount: item.discount, taxRate }, pricesIncludeTax);
    if (item.discount > amounts.gross + 0.005) {
      itemError(index, 'discount', AppError.badRequest('El descuento no puede ser mayor que el importe'));
    }
    return { index, item, product, unitPrice, taxRate, amounts };
  });

  // Receta: los productos que la retienen (antibióticos, controlados) exigen ligarla o registrarla;
  // los que sólo la requieren, confirmar que se revisó
  if (dto.prescription && !hasPermission(auth.roleCode, auth.permissions, 'prescriptions.manage')) {
    throw AppError.forbidden('No tienes permiso para registrar recetas; pide apoyo a quien pueda hacerlo.');
  }
  if (dto.patientId && !(await prisma.patient.findFirst({ where: { id: dto.patientId, deletedAt: null }, select: { id: true } }))) {
    throw AppError.badRequest('El paciente no existe', [{ path: 'patientId', message: 'Paciente inválido' }]);
  }
  let linked: { id: string; patientId: string } | null = null;
  if (dto.prescriptionId) {
    linked = await prisma.prescription.findFirst({ where: { id: dto.prescriptionId, deletedAt: null }, select: { id: true, patientId: true } });
    if (!linked) throw AppError.businessRule('La receta no existe o está anulada', [{ path: 'prescriptionId', message: 'Receta inválida' }]);
    if (dto.patientId && linked.patientId !== dto.patientId) {
      throw AppError.badRequest('La receta es de otro paciente', [{ path: 'prescriptionId', message: 'No corresponde al paciente' }]);
    }
    // Una receta que se retiene (antibióticos, controlados) se surte una sola vez
    if (lines.some((l) => l.product.isControlled)) {
      const used = await prisma.sale.findFirst({ where: { prescriptionId: linked.id, status: { not: 'CANCELLED' } }, select: { number: true } });
      if (used) {
        throw AppError.businessRule(`La receta ya se surtió en la venta ${formatSaleNumber(used.number)}; registra la receta nueva.`, [
          { path: 'prescriptionId', message: 'Receta ya surtida' },
        ]);
      }
    }
  }
  if (dto.prescription && !lines.some((l) => l.product.requiresPrescription || l.product.isControlled)) {
    throw AppError.badRequest('Ningún producto de la venta requiere receta', [{ path: 'prescription', message: 'No hace falta registrar receta' }]);
  }
  const hasPrescription = Boolean(linked || dto.prescription);
  for (const l of lines) {
    if (l.product.isControlled && !hasPrescription) {
      itemError(l.index, 'productId', AppError.businessRule(`${l.product.commercialName} retiene receta: liga o registra la receta del paciente`));
    }
    if (l.product.requiresPrescription && !hasPrescription && !dto.prescriptionChecked) {
      itemError(l.index, 'productId', AppError.businessRule(`${l.product.commercialName} requiere receta médica: confirma que la revisaste`));
    }
  }
  const prescriptionChecked = dto.prescriptionChecked || hasPrescription;

  const totals = saleTotals(
    lines.map((l) => ({ quantity: l.item.quantity, unitPrice: l.unitPrice, discount: l.item.discount, taxRate: l.taxRate })),
    pricesIncludeTax,
  );
  if (dto.expectedTotal !== undefined && Math.abs(dto.expectedTotal - totals.total) > 0.005) {
    throw AppError.conflict('Los precios cambiaron mientras se capturaba la venta. Revisa el total antes de cobrar.', {
      expectedTotal: dto.expectedTotal,
      total: totals.total,
    });
  }

  const paid = r2(dto.payments.reduce((sum, p) => sum + p.amount, 0));
  if (Math.abs(paid - totals.total) > 0.005) {
    throw AppError.badRequest(
      paid < totals.total ? `Faltan ${(totals.total - paid).toFixed(2)} por cobrar` : `Los pagos exceden el total por ${(paid - totals.total).toFixed(2)}`,
      [{ path: 'payments', message: `El total es ${totals.total.toFixed(2)}` }],
    );
  }

  const today = todayISO();
  let saleId: string;
  try {
    saleId = await prisma.$transaction(async (tx) => {
      // Receta registrada al surtir: lleva los medicamentos con receta de esta venta
      const rxId =
        linked?.id ??
        (dto.prescription
          ? (
              await createPrescriptionInTx(
                tx,
                auth,
                branchId,
                {
                  patientId: dto.patientId!,
                  doctorName: dto.prescription.doctorName,
                  doctorLicense: dto.prescription.doctorLicense ?? null,
                  issuedAt: dto.prescription.issuedAt,
                  notes: dto.prescription.notes ?? null,
                  items: lines
                    .filter((l) => l.product.requiresPrescription || l.product.isControlled)
                    .map((l) => ({ productId: l.product.id, medicationName: l.product.commercialName, dose: null, frequency: null, duration: null, instructions: null })),
                },
                client,
                'sale',
              )
            ).id
          : null);
      const sale = await tx.sale.create({
        data: {
          branchId,
          subtotal: totals.subtotal,
          discountTotal: totals.discountTotal,
          taxTotal: totals.taxTotal,
          total: totals.total,
          costTotal: 0,
          notes: dto.notes,
          prescriptionChecked,
          patientId: dto.patientId ?? linked?.patientId ?? null,
          prescriptionId: rxId,
          clientRequestId: dto.clientRequestId ?? null,
          createdById: auth.userId,
        },
      });
      const folio = formatSaleNumber(sale.number);

      // Orden fijo de bloqueo (por producto) para que dos ventas no se esperen mutuamente
      let costTotal = 0;
      for (const line of [...lines].sort((a, b) => a.product.id.localeCompare(b.product.id))) {
        const allocations = await allocateFefo(tx, { branchId, productId: line.product.id, quantity: line.item.quantity, today }).catch(
          (err: unknown) => {
            if (err instanceof AppError && err.status === 422) {
              const available = (err.details as { available?: number } | undefined)?.available ?? 0;
              itemError(
                line.index,
                'quantity',
                AppError.businessRule(`${line.product.commercialName}: sólo hay ${available} unidad(es) disponibles`, { available }),
              );
            }
            throw err;
          },
        );
        let lineCost = 0;
        for (const a of allocations) {
          await applyMovement(tx, {
            branchId,
            batchId: a.batchId,
            type: 'SALE',
            change: -a.quantity,
            userId: auth.userId,
            notes: `Venta ${folio}`,
            referenceType: 'SALE',
            referenceId: sale.id,
          });
          lineCost += a.quantity * Number(a.unitCost);
        }
        costTotal += lineCost;
        await tx.saleItem.create({
          data: {
            saleId: sale.id,
            position: line.index,
            productId: line.product.id,
            quantity: line.item.quantity,
            unitPrice: line.unitPrice,
            discount: line.item.discount,
            taxRate: line.taxRate,
            taxAmount: line.amounts.taxAmount,
            subtotal: line.amounts.subtotal,
            total: line.amounts.total,
            unitCost: Math.round((lineCost / line.item.quantity) * 10_000) / 10_000,
            batches: { create: allocations.map((a) => ({ batchId: a.batchId, quantity: a.quantity, unitCost: a.unitCost })) },
          },
        });
      }

      await tx.sale.update({ where: { id: sale.id }, data: { costTotal: r2(costTotal) } });
      await tx.salePayment.createMany({
        data: dto.payments.map((p) => ({
          saleId: sale.id,
          method: p.method,
          amount: p.amount,
          received: p.method === 'CASH' ? (p.received ?? p.amount) : null,
          change: p.method === 'CASH' ? cashChange(p.received ?? p.amount, p.amount) : null,
          reference: p.reference,
        })),
      });
      await recordAudit(
        {
          action: 'SALE_CREATE',
          userId: auth.userId,
          branchId,
          entityType: 'sale',
          entityId: sale.id,
          metadata: {
            folio,
            items: lines.length,
            units: lines.reduce((s, l) => s + l.item.quantity, 0),
            total: totals.total,
            discountTotal: totals.discountTotal,
            payments: dto.payments.map((p) => `${PAYMENT_METHOD_LABELS[p.method]} ${p.amount.toFixed(2)}`),
            prescriptionChecked,
            prescriptionId: rxId,
            prescriptionProducts: lines.filter((l) => l.product.requiresPrescription || l.product.isControlled).map((l) => l.product.commercialName),
          },
          client,
        },
        tx,
      );
      return sale.id;
    });
  } catch (err) {
    // Dos envíos simultáneos del mismo cobro: el segundo devuelve la venta del primero
    if (dto.clientRequestId && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existing = await prisma.sale.findUnique({ where: { clientRequestId: dto.clientRequestId }, select: { id: true } });
      if (existing) return getSale(auth, branchId, existing.id);
    }
    throw err;
  }
  return getSale(auth, branchId, saleId);
}

// -----------------------------------------------------------------------------
// Consulta
// -----------------------------------------------------------------------------

/** Sin reportes, cada quien ve sus propias ventas (su corte); un folio exacto se busca en toda la sucursal. */
function canSeeAllSales(auth: AuthContext) {
  return hasPermission(auth.roleCode, auth.permissions, 'reports.view');
}

export async function listSales(auth: AuthContext, branchId: string, query: ListSalesDto) {
  const folio = query.q?.match(/^(?:v-?)?0*(\d{1,9})$/i);
  const all = canSeeAllSales(auth);
  const createdAt =
    query.from || query.to
      ? { ...(query.from ? { gte: startOfDay(query.from) } : {}), ...(query.to ? { lt: endOfDayExclusive(query.to) } : {}) }
      : undefined;
  const scope: Prisma.SaleWhereInput = {
    branchId,
    ...(all ? (query.userId ? { createdById: query.userId } : {}) : { createdById: auth.userId }),
  };
  const where: Prisma.SaleWhereInput = folio
    ? { branchId, number: Number(folio[1]) }
    : {
        ...scope,
        ...(createdAt ? { createdAt } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.paymentMethod ? { payments: { some: { method: query.paymentMethod } } } : {}),
        ...(query.q ? { items: { some: { product: { commercialName: { contains: query.q, mode: 'insensitive' } } } } } : {}),
      };

  const [rows, total, summary] = await Promise.all([
    prisma.sale.findMany({
      where,
      include: {
        createdBy: userName,
        payments: { select: { method: true, amount: true } },
        items: { select: { quantity: true } },
      },
      orderBy: { createdAt: 'desc' },
      ...toSkipTake(query),
    }),
    prisma.sale.count({ where }),
    salesSummary({ ...scope, ...(createdAt ? { createdAt } : {}) }, branchId, all ? query.userId : auth.userId, createdAt),
  ]);

  return {
    ...paginated(
      rows.map((s) => ({
        id: s.id,
        folio: formatSaleNumber(s.number),
        status: s.status,
        createdAt: s.createdAt.toISOString(),
        total: Number(s.total),
        units: s.items.reduce((sum, i) => sum + i.quantity, 0),
        paymentMethods: [...new Set(s.payments.map((p) => p.method))],
        createdBy: fullName(s.createdBy)!,
      })),
      total,
      query,
    ),
    summary,
    scope: all ? 'branch' : 'own',
  };
}

/** Corte: ventas vigentes del periodo por forma de pago y reembolsos del mismo periodo. */
async function salesSummary(
  where: Prisma.SaleWhereInput,
  branchId: string,
  userId: string | undefined,
  createdAt: { gte?: Date; lt?: Date } | undefined,
) {
  const active = { ...where, status: { not: 'CANCELLED' as const } };
  const [agg, byMethod, cancelled, refunds] = await Promise.all([
    prisma.sale.aggregate({ where: active, _sum: { total: true }, _count: { _all: true } }),
    prisma.salePayment.groupBy({ by: ['method'], where: { sale: active }, _sum: { amount: true } }),
    prisma.sale.count({ where: { ...where, status: 'CANCELLED' } }),
    prisma.return.groupBy({
      by: ['refundMethod'],
      where: { branchId, ...(userId ? { userId } : {}), ...(createdAt ? { createdAt } : {}) },
      _sum: { refundTotal: true },
    }),
  ]);
  const count = agg._count._all;
  const total = Number(agg._sum.total ?? 0);
  return {
    count,
    total,
    averageTicket: count ? r2(total / count) : 0,
    cancelled,
    byMethod: Object.fromEntries(byMethod.map((m) => [m.method, Number(m._sum.amount ?? 0)])),
    refunds: Object.fromEntries(refunds.map((r) => [r.refundMethod, Number(r._sum.refundTotal ?? 0)])),
  };
}

// -----------------------------------------------------------------------------
// Cancelación
// -----------------------------------------------------------------------------

export async function cancelSale(auth: AuthContext, branchId: string, id: string, reason: string, client: ClientInfo) {
  await prisma.$transaction(async (tx) => {
    const sale = await lockSale(tx, branchId, id);
    if (sale.status === 'CANCELLED') throw AppError.businessRule('La venta ya estaba cancelada.');
    if (sale.status !== 'COMPLETED') throw AppError.businessRule('La venta tiene devoluciones; ya no se puede cancelar completa.');
    const folio = formatSaleNumber(sale.number);
    for (const item of sale.items) {
      for (const b of item.batches) {
        await applyMovement(tx, {
          branchId,
          batchId: b.batchId,
          type: 'SALE_CANCELLATION',
          change: b.quantity,
          userId: auth.userId,
          notes: `Cancelación de la venta ${folio}: ${reason}`,
          referenceType: 'SALE_CANCEL',
          referenceId: sale.id,
        });
      }
    }
    await tx.sale.update({ where: { id }, data: { status: 'CANCELLED', cancelledById: auth.userId, cancelledAt: new Date(), cancelReason: reason } });
    await recordAudit(
      {
        action: 'SALE_CANCEL',
        userId: auth.userId,
        branchId,
        entityType: 'sale',
        entityId: id,
        metadata: { folio, reason, total: Number(sale.total), soldBy: fullName(sale.createdBy)?.fullName },
        client,
      },
      tx,
    );
  });
  return getSale(auth, branchId, id);
}
