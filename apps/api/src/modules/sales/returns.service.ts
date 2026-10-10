import { formatReturnNumber, formatSaleNumber, hasPermission, RETURN_DISPOSITION_LABELS } from '@farmacia/shared';
import type { Prisma } from '../../generated/prisma/client';
import { dateOnly, todayISO } from '../../lib/dates';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../shared/errors';
import { paginated, toSkipTake } from '../../shared/pagination';
import type { AuthContext, ClientInfo } from '../../shared/request-context';
import { recordAudit } from '../audit/audit.service';
import { applyMovement } from '../inventory/inventory.core';
import type { CreateReturnDto, ListReturnsDto } from './sales.schemas';
import { getSale, lockSale } from './sales.service';

/**
 * Devoluciones de clientes.
 * - Por omisión el producto devuelto queda EN REVISIÓN (cuarentena): no vuelve a venderse
 *   hasta que alguien con permiso de inventario lo revisa y decide regresarlo o desecharlo.
 * - Regresar directo al inventario sólo lo puede hacer quien ajusta inventario, y nunca
 *   a un lote caducado.
 * - El reembolso es proporcional a lo que se cobró por la partida (incluye su descuento).
 */

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export async function createReturn(auth: AuthContext, branchId: string, saleId: string, dto: CreateReturnDto, client: ClientInfo) {
  const canRestock = hasPermission(auth.roleCode, auth.permissions, 'inventory.adjust');
  if (dto.items.some((i) => i.disposition === 'RESTOCKED') && !canRestock) {
    throw AppError.forbidden('Sólo quien ajusta inventario puede regresar producto directo a la venta; envíalo a revisión.');
  }
  const today = todayISO();

  await prisma.$transaction(async (tx) => {
    const sale = await lockSale(tx, branchId, saleId);
    if (sale.status === 'CANCELLED') throw AppError.businessRule('La venta está cancelada; no admite devoluciones.');
    if (sale.status === 'RETURNED') throw AppError.businessRule('Todo lo de esta venta ya se devolvió.');

    // Lo ya devuelto por partida y lote (para repartir la devolución entre los lotes vendidos)
    const previous = await tx.returnItem.findMany({
      where: { return: { saleId } },
      select: { saleItemId: true, batchId: true, quantity: true, refundAmount: true },
    });

    const created = await tx.return.create({
      data: { saleId, branchId, userId: auth.userId, reason: dto.reason, refundMethod: dto.refundMethod, notes: dto.notes, refundTotal: 0 },
    });
    const folio = formatReturnNumber(created.number);

    let refundTotal = 0;
    for (const [index, req] of dto.items.entries()) {
      const item = sale.items.find((i) => i.id === req.saleItemId);
      const fail = (err: AppError, field = 'quantity'): never => {
        throw new AppError(err.status, err.code, err.message, [{ path: `items.${index}.${field}`, message: err.message }]);
      };
      if (!item) {
        throw AppError.badRequest('La partida no pertenece a esta venta', [{ path: `items.${index}.saleItemId`, message: 'Partida inválida' }]);
      }
      const pending = item.quantity - item.returnedQty;
      if (req.quantity > pending) {
        fail(AppError.businessRule(`${item.product.commercialName}: sólo quedan ${pending} unidad(es) por devolver`));
      }

      // Reembolso proporcional; la última devolución ajusta los centavos al total de la partida
      const itemTotal = Number(item.total);
      const refundedBefore = previous.filter((p) => p.saleItemId === item.id).reduce((s, p) => s + Number(p.refundAmount), 0);
      const isLast = req.quantity === pending;
      const refund = isLast ? r2(itemTotal - refundedBefore) : r2((itemTotal / item.quantity) * req.quantity);

      // Se devuelve primero lo del último lote usado
      let remaining = req.quantity;
      let refundLeft = refund;
      const batches = [...item.batches].reverse();
      for (const [bIndex, b] of batches.entries()) {
        if (remaining === 0) break;
        const returnedFromBatch = previous.filter((p) => p.saleItemId === item.id && p.batchId === b.batchId).reduce((s, p) => s + p.quantity, 0);
        const take = Math.min(b.quantity - returnedFromBatch, remaining);
        if (take <= 0) continue;
        remaining -= take;
        const amount = remaining === 0 || bIndex === batches.length - 1 ? r2(refundLeft) : r2((refund / req.quantity) * take);
        refundLeft = r2(refundLeft - amount);

        if (req.disposition === 'RESTOCKED') {
          if (dateOnly(b.batch.expiresAt) < today) {
            fail(AppError.businessRule(`El lote ${b.batch.lotNumber} está caducado; envíalo a revisión o deséchalo.`), 'disposition');
          }
          await applyMovement(tx, {
            branchId,
            batchId: b.batchId,
            type: 'CUSTOMER_RETURN',
            change: take,
            userId: auth.userId,
            notes: `Devolución ${folio} de la venta ${formatSaleNumber(sale.number)}: ${dto.reason}`,
            referenceType: 'RETURN',
            referenceId: created.id,
          });
        }
        await tx.returnItem.create({
          data: {
            returnId: created.id,
            saleItemId: item.id,
            batchId: b.batchId,
            quantity: take,
            refundAmount: amount,
            disposition: req.disposition,
            ...(req.disposition === 'RESTOCKED' ? { reviewedAt: new Date(), reviewedById: auth.userId, reviewNotes: 'Regresado al inventario al recibir la devolución' } : {}),
          },
        });
      }
      await tx.saleItem.update({ where: { id: item.id }, data: { returnedQty: { increment: req.quantity } } });
      refundTotal += refund;
    }

    refundTotal = r2(refundTotal);
    await tx.return.update({ where: { id: created.id }, data: { refundTotal } });
    const after = await tx.saleItem.findMany({ where: { saleId }, select: { quantity: true, returnedQty: true } });
    const allReturned = after.every((i) => i.returnedQty >= i.quantity);
    await tx.sale.update({ where: { id: saleId }, data: { status: allReturned ? 'RETURNED' : 'PARTIALLY_RETURNED' } });
    await recordAudit(
      {
        action: 'RETURN_CREATE',
        userId: auth.userId,
        branchId,
        entityType: 'return',
        entityId: created.id,
        metadata: {
          folio,
          sale: formatSaleNumber(sale.number),
          reason: dto.reason,
          refundTotal,
          items: dto.items.map((i) => ({
            product: sale.items.find((s) => s.id === i.saleItemId)?.product.commercialName,
            quantity: i.quantity,
            disposition: RETURN_DISPOSITION_LABELS[i.disposition],
          })),
        },
        client,
      },
      tx,
    );
  });
  return getSale(auth, branchId, saleId);
}

// -----------------------------------------------------------------------------
// Revisión del producto devuelto
// -----------------------------------------------------------------------------

export async function reviewReturnItem(
  auth: AuthContext,
  branchId: string,
  returnId: string,
  itemId: string,
  decision: 'RESTOCK' | 'DISCARD',
  notes: string | null,
  client: ClientInfo,
) {
  await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT ri.id FROM return_items ri JOIN returns r ON r.id = ri.return_id
      WHERE ri.id = ${itemId}::uuid AND ri.return_id = ${returnId}::uuid AND r.branch_id = ${branchId}::uuid
      FOR UPDATE OF ri`;
    if (locked.length === 0) throw AppError.notFound('El producto devuelto no existe');
    const item = await tx.returnItem.findUniqueOrThrow({
      where: { id: itemId },
      include: { batch: true, return: { select: { number: true } }, saleItem: { select: { product: { select: { commercialName: true } } } } },
    });
    if (item.disposition !== 'QUARANTINE' || item.reviewedAt) throw AppError.businessRule('Este producto ya fue revisado.');

    if (decision === 'RESTOCK') {
      if (dateOnly(item.batch.expiresAt) < todayISO()) {
        throw AppError.businessRule(`El lote ${item.batch.lotNumber} está caducado; sólo se puede desechar.`);
      }
      await applyMovement(tx, {
        branchId,
        batchId: item.batchId,
        type: 'CUSTOMER_RETURN',
        change: item.quantity,
        userId: auth.userId,
        notes: `Devolución ${formatReturnNumber(item.return.number)} revisada: regresa al inventario${notes ? ` (${notes})` : ''}`,
        referenceType: 'RETURN',
        referenceId: returnId,
      });
    }
    await tx.returnItem.update({
      where: { id: itemId },
      data: { disposition: decision === 'RESTOCK' ? 'RESTOCKED' : 'DISCARDED', reviewedAt: new Date(), reviewedById: auth.userId, reviewNotes: notes },
    });
    await recordAudit(
      {
        action: 'RETURN_REVIEW',
        userId: auth.userId,
        branchId,
        entityType: 'return',
        entityId: returnId,
        metadata: {
          folio: formatReturnNumber(item.return.number),
          product: item.saleItem.product.commercialName,
          lotNumber: item.batch.lotNumber,
          quantity: item.quantity,
          decision: decision === 'RESTOCK' ? 'Regresa al inventario' : 'Desechado',
          notes,
        },
        client,
      },
      tx,
    );
  });
}

// -----------------------------------------------------------------------------
// Consulta
// -----------------------------------------------------------------------------

export async function listReturns(branchId: string, query: ListReturnsDto) {
  const folio = query.q?.match(/^(?:[dv]-?)?0*(\d{1,9})$/i);
  const where: Prisma.ReturnWhereInput = {
    branchId,
    ...(query.pending ? { items: { some: { disposition: 'QUARANTINE', reviewedAt: null } } } : {}),
    ...(folio ? { OR: [{ number: Number(folio[1]) }, { sale: { number: Number(folio[1]) } }] } : query.q ? { reason: { contains: query.q, mode: 'insensitive' } } : {}),
  };
  const [rows, total, pendingItems] = await Promise.all([
    prisma.return.findMany({
      where,
      include: {
        sale: { select: { id: true, number: true } },
        user: { select: { id: true, firstName: true, lastName: true } },
        items: {
          include: {
            batch: { select: { lotNumber: true, expiresAt: true } },
            saleItem: { select: { product: { select: { id: true, commercialName: true, concentration: true } } } },
            reviewedBy: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      ...toSkipTake(query),
    }),
    prisma.return.count({ where }),
    prisma.returnItem.aggregate({ where: { disposition: 'QUARANTINE', reviewedAt: null, return: { branchId } }, _sum: { quantity: true }, _count: { _all: true } }),
  ]);
  const today = todayISO();
  return {
    ...paginated(
      rows.map((r) => ({
        id: r.id,
        folio: formatReturnNumber(r.number),
        sale: { id: r.sale.id, folio: formatSaleNumber(r.sale.number) },
        reason: r.reason,
        refundTotal: Number(r.refundTotal),
        refundMethod: r.refundMethod,
        notes: r.notes,
        createdAt: r.createdAt.toISOString(),
        user: { id: r.user.id, fullName: `${r.user.firstName} ${r.user.lastName}`.trim() },
        items: r.items.map((i) => ({
          id: i.id,
          product: i.saleItem.product,
          lotNumber: i.batch.lotNumber,
          expiresAt: dateOnly(i.batch.expiresAt),
          expired: dateOnly(i.batch.expiresAt) < today,
          quantity: i.quantity,
          refundAmount: Number(i.refundAmount),
          disposition: i.disposition,
          pendingReview: i.disposition === 'QUARANTINE' && !i.reviewedAt,
          reviewedAt: i.reviewedAt?.toISOString() ?? null,
          reviewedBy: i.reviewedBy ? `${i.reviewedBy.firstName} ${i.reviewedBy.lastName}`.trim() : null,
          reviewNotes: i.reviewNotes,
        })),
      })),
      total,
      query,
    ),
    summary: { pendingItems: pendingItems._count._all, pendingUnits: pendingItems._sum.quantity ?? 0 },
  };
}
