import {
  formatPurchaseNumber,
  hasPermission,
  PAYMENT_METHOD_LABELS,
  paymentStatusFor,
  purchaseLineAmounts,
  purchaseTotals,
} from '@farmacia/shared';
import type { Prisma } from '../../generated/prisma/client';
import { dateOnly, parseDateOnly, todayISO } from '../../lib/dates';
import { prisma, type TxClient } from '../../lib/prisma';
import { AppError } from '../../shared/errors';
import { paginated, toSkipTake } from '../../shared/pagination';
import type { AuthContext, ClientInfo } from '../../shared/request-context';
import { recordAudit } from '../audit/audit.service';
import { applyMovement, receiveStock } from '../inventory/inventory.core';
import type { ListPurchasesDto, PaymentDto, PurchaseDto, PurchaseItemDto } from './purchases.schemas';

/**
 * Compras a proveedor.
 *
 * Ciclo de vida:
 *   ORDERED (pedido, editable)  ──recibir──▶ RECEIVED (inventario ingresado)
 *        └──────cancelar──────▶ CANCELLED ◀──cancelar (revierte el inventario)──┘
 *
 * - Recibir crea o suma los lotes con el núcleo de inventario (movimiento PURCHASE_ENTRY,
 *   mismo bloqueo por lote que el resto del sistema) y actualiza el último costo del producto.
 * - Una compra de contado queda pagada al recibirse; a crédito vence según los días del proveedor.
 * - Los importes los calcula el servidor; los que envía el cliente se ignoran.
 */

const purchaseInclude = {
  supplier: { select: { id: true, tradeName: true, rfc: true, creditDays: true } },
  items: {
    include: { product: { select: { id: true, sku: true, commercialName: true, concentration: true, presentation: true } } },
    orderBy: { position: 'asc' },
  },
  payments: { include: { user: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { paidAt: 'asc' } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  receivedBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.PurchaseInclude;

type PurchaseRow = Prisma.PurchaseGetPayload<{ include: typeof purchaseInclude }>;

const fullName = (u: { id: string; firstName: string; lastName: string } | null) =>
  u ? { id: u.id, fullName: `${u.firstName} ${u.lastName}`.trim() } : null;

function isOverdue(p: { status: string; paymentStatus: string; paymentDueDate: Date | null }, today: string): boolean {
  return p.status === 'RECEIVED' && p.paymentStatus !== 'PAID' && p.paymentDueDate !== null && dateOnly(p.paymentDueDate) < today;
}

function toDto(p: PurchaseRow, today = todayISO()) {
  const total = Number(p.total);
  const amountPaid = Number(p.amountPaid);
  return {
    id: p.id,
    number: p.number,
    folio: formatPurchaseNumber(p.number),
    status: p.status,
    supplier: p.supplier,
    invoiceNumber: p.invoiceNumber,
    purchaseDate: dateOnly(p.purchaseDate),
    paymentMethod: p.paymentMethod,
    paymentStatus: p.paymentStatus,
    paymentDueDate: p.paymentDueDate ? dateOnly(p.paymentDueDate) : null,
    overdue: isOverdue(p, today),
    subtotal: Number(p.subtotal),
    discountTotal: Number(p.discountTotal),
    taxTotal: Number(p.taxTotal),
    total,
    amountPaid,
    balance: Math.round((total - amountPaid) * 100) / 100,
    notes: p.notes,
    items: p.items.map((i) => ({
      id: i.id,
      product: i.product,
      batchId: i.batchId,
      lotNumber: i.lotNumber,
      expiresAt: i.expiresAt ? dateOnly(i.expiresAt) : null,
      manufacturedAt: i.manufacturedAt ? dateOnly(i.manufacturedAt) : null,
      quantity: i.quantity,
      unitCost: Number(i.unitCost),
      discount: Number(i.discount),
      taxRate: Number(i.taxRate),
      taxAmount: Number(i.taxAmount),
      subtotal: Number(i.subtotal),
      total: Number(i.total),
    })),
    payments: p.payments.map((pay) => ({
      id: pay.id,
      amount: Number(pay.amount),
      method: pay.method,
      reference: pay.reference,
      paidAt: pay.paidAt.toISOString(),
      user: fullName(pay.user)!,
    })),
    createdBy: fullName(p.createdBy)!,
    receivedBy: fullName(p.receivedBy),
    receivedAt: p.receivedAt?.toISOString() ?? null,
    cancelledAt: p.cancelledAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}
export type PurchaseResponse = ReturnType<typeof toDto>;

async function findPurchase(db: typeof prisma | TxClient, branchId: string, id: string): Promise<PurchaseRow> {
  const p = await db.purchase.findFirst({ where: { id, branchId }, include: purchaseInclude });
  if (!p) throw AppError.notFound('La compra no existe');
  return p;
}

export async function getPurchase(branchId: string, id: string) {
  return toDto(await findPurchase(prisma, branchId, id));
}

/** Bloquea la compra hasta el fin de la transacción (evita recibir o pagar dos veces a la vez). */
async function lockPurchase(tx: TxClient, branchId: string, id: string): Promise<PurchaseRow> {
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM purchases WHERE id = ${id}::uuid AND branch_id = ${branchId}::uuid FOR UPDATE`;
  if (locked.length === 0) throw AppError.notFound('La compra no existe');
  return findPurchase(tx, branchId, id);
}

// -----------------------------------------------------------------------------
// Listado
// -----------------------------------------------------------------------------

export async function listPurchases(branchId: string, query: ListPurchasesDto) {
  const today = todayISO();
  const folio = query.q?.match(/^(?:c-?)?0*(\d{1,9})$/i);
  const where: Prisma.PurchaseWhereInput = {
    branchId,
    ...(query.supplierId ? { supplierId: query.supplierId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.paymentStatus ? { paymentStatus: query.paymentStatus } : {}),
    ...(query.overdue
      ? { status: 'RECEIVED', paymentStatus: { not: 'PAID' }, paymentDueDate: { lt: parseDateOnly(today) } }
      : {}),
    ...(query.from || query.to
      ? {
          purchaseDate: {
            ...(query.from ? { gte: parseDateOnly(query.from) } : {}),
            ...(query.to ? { lte: parseDateOnly(query.to) } : {}),
          },
        }
      : {}),
    ...(query.q
      ? {
          OR: [
            ...(folio ? [{ number: Number(folio[1]) }] : []),
            { invoiceNumber: { contains: query.q, mode: 'insensitive' as const } },
            { supplier: { tradeName: { contains: query.q, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  };

  const [rows, total, summary] = await Promise.all([
    prisma.purchase.findMany({
      where,
      include: { ...purchaseInclude, items: { select: { id: true } }, payments: false },
      orderBy: [{ purchaseDate: 'desc' }, { number: 'desc' }],
      ...toSkipTake(query),
    }),
    prisma.purchase.count({ where }),
    purchasesSummary(branchId, today),
  ]);

  return {
    ...paginated(
      rows.map((p) => {
        const totalAmount = Number(p.total);
        const paid = Number(p.amountPaid);
        return {
          id: p.id,
          folio: formatPurchaseNumber(p.number),
          status: p.status,
          supplier: p.supplier,
          invoiceNumber: p.invoiceNumber,
          purchaseDate: dateOnly(p.purchaseDate),
          paymentMethod: p.paymentMethod,
          paymentStatus: p.paymentStatus,
          paymentDueDate: p.paymentDueDate ? dateOnly(p.paymentDueDate) : null,
          overdue: isOverdue(p, today),
          itemCount: p.items.length,
          total: totalAmount,
          balance: Math.round((totalAmount - paid) * 100) / 100,
          createdBy: fullName(p.createdBy)!,
        };
      }),
      total,
      query,
    ),
    summary,
  };
}

async function purchasesSummary(branchId: string, today: string) {
  const [row] = await prisma.$queryRaw<
    { pending_reception: number; balance: Prisma.Decimal; overdue_count: number; overdue_amount: Prisma.Decimal; month_total: Prisma.Decimal }[]
  >`
    SELECT
      COUNT(*) FILTER (WHERE status IN ('DRAFT', 'ORDERED'))::int AS pending_reception,
      COALESCE(SUM(total - amount_paid) FILTER (WHERE status = 'RECEIVED'), 0) AS balance,
      COUNT(*) FILTER (WHERE status = 'RECEIVED' AND payment_status <> 'PAID' AND payment_due_date < ${today}::date)::int AS overdue_count,
      COALESCE(SUM(total - amount_paid) FILTER (WHERE status = 'RECEIVED' AND payment_status <> 'PAID' AND payment_due_date < ${today}::date), 0) AS overdue_amount,
      COALESCE(SUM(total) FILTER (WHERE status = 'RECEIVED' AND date_trunc('month', purchase_date) = date_trunc('month', ${today}::date)), 0) AS month_total
    FROM purchases
    WHERE branch_id = ${branchId}::uuid`;
  return {
    pendingReception: row?.pending_reception ?? 0,
    balanceDue: Number(row?.balance ?? 0),
    overdueCount: row?.overdue_count ?? 0,
    overdueAmount: Number(row?.overdue_amount ?? 0),
    receivedThisMonth: Number(row?.month_total ?? 0),
  };
}

// -----------------------------------------------------------------------------
// Alta y edición
// -----------------------------------------------------------------------------

interface PreparedPurchase {
  data: {
    subtotal: number;
    discountTotal: number;
    taxTotal: number;
    total: number;
    paymentDueDate: Date | null;
  };
  items: Prisma.PurchaseItemCreateManyPurchaseInput[];
}

async function preparePurchase(dto: PurchaseDto, supplierCreditDays: number): Promise<PreparedPurchase> {
  const productIds = [...new Set(dto.items.map((i) => i.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, deletedAt: null },
    select: { id: true, taxRate: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  dto.items.forEach((item, index) => {
    if (!byId.has(item.productId)) {
      throw AppError.badRequest('Producto inválido', [{ path: `items.${index}.productId`, message: 'El producto no existe' }]);
    }
  });

  const lines = dto.items.map((i) => ({
    quantity: i.quantity,
    unitCost: i.unitCost,
    discount: i.discount,
    taxRate: i.taxRate ?? Number(byId.get(i.productId)!.taxRate),
  }));
  const totals = purchaseTotals(lines);

  let paymentDueDate: Date | null = null;
  if (dto.paymentMethod === 'CREDIT') {
    if (dto.paymentDueDate) paymentDueDate = parseDateOnly(dto.paymentDueDate);
    else {
      paymentDueDate = parseDateOnly(dto.purchaseDate);
      paymentDueDate.setUTCDate(paymentDueDate.getUTCDate() + supplierCreditDays);
    }
  }

  return {
    data: { ...totals, paymentDueDate },
    items: dto.items.map((i: PurchaseItemDto, index) => {
      const line = lines[index]!;
      const amounts = purchaseLineAmounts(line);
      return {
        position: index,
        productId: i.productId,
        lotNumber: i.lotNumber ?? null,
        expiresAt: i.expiresAt ? parseDateOnly(i.expiresAt) : null,
        manufacturedAt: i.manufacturedAt ? parseDateOnly(i.manufacturedAt) : null,
        quantity: i.quantity,
        unitCost: i.unitCost,
        discount: i.discount,
        taxRate: line.taxRate,
        taxAmount: amounts.taxAmount,
        subtotal: amounts.subtotal,
        total: amounts.total,
      };
    }),
  };
}

async function activeSupplier(id: string) {
  const supplier = await prisma.supplier.findFirst({ where: { id, deletedAt: null } });
  if (!supplier) throw AppError.badRequest('Proveedor inválido', [{ path: 'supplierId', message: 'El proveedor no existe' }]);
  if (!supplier.isActive) {
    throw AppError.businessRule('El proveedor está desactivado; reactívalo para registrarle compras.', [
      { path: 'supplierId', message: 'Proveedor desactivado' },
    ]);
  }
  return supplier;
}

async function assertInvoiceFree(supplierId: string, invoiceNumber: string | null, exceptId?: string) {
  if (!invoiceNumber) return;
  const dup = await prisma.purchase.findFirst({
    where: { supplierId, invoiceNumber, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { number: true },
  });
  if (dup) {
    throw AppError.conflict(`Esta factura ya está registrada en la compra ${formatPurchaseNumber(dup.number)}`, [
      { path: 'invoiceNumber', message: 'Factura ya registrada para este proveedor' },
    ]);
  }
}

function assertDateNotFuture(purchaseDate: string) {
  if (purchaseDate > todayISO()) {
    throw AppError.badRequest('La fecha de compra no puede ser futura', [{ path: 'purchaseDate', message: 'Fecha futura' }]);
  }
}

export async function createPurchase(
  auth: AuthContext,
  branchId: string,
  dto: PurchaseDto & { receive: boolean },
  client: ClientInfo,
) {
  if (dto.receive && !hasPermission(auth.roleCode, auth.permissions, 'purchases.receive')) {
    throw AppError.forbidden('No tienes permiso para recibir mercancía; guarda la compra como pendiente.');
  }
  assertDateNotFuture(dto.purchaseDate);
  const supplier = await activeSupplier(dto.supplierId);
  await assertInvoiceFree(supplier.id, dto.invoiceNumber);
  const prepared = await preparePurchase(dto, supplier.creditDays);

  const id = await prisma.$transaction(async (tx) => {
    const purchase = await tx.purchase.create({
      data: {
        branchId,
        supplierId: supplier.id,
        invoiceNumber: dto.invoiceNumber,
        purchaseDate: parseDateOnly(dto.purchaseDate),
        status: 'ORDERED',
        paymentMethod: dto.paymentMethod,
        notes: dto.notes,
        createdById: auth.userId,
        ...prepared.data,
        items: { createMany: { data: prepared.items } },
      },
    });
    await recordAudit(
      {
        action: 'PURCHASE_CREATE',
        userId: auth.userId,
        branchId,
        entityType: 'purchase',
        entityId: purchase.id,
        metadata: {
          folio: formatPurchaseNumber(purchase.number),
          supplier: supplier.tradeName,
          invoiceNumber: dto.invoiceNumber,
          items: prepared.items.length,
          total: prepared.data.total,
          paymentMethod: PAYMENT_METHOD_LABELS[dto.paymentMethod],
        },
        client,
      },
      tx,
    );
    if (dto.receive) await receiveInTx(tx, auth, branchId, purchase.id, client);
    return purchase.id;
  });
  return getPurchase(branchId, id);
}

function assertEditable(p: PurchaseRow) {
  if (p.status === 'RECEIVED') throw AppError.businessRule('La compra ya se recibió; no se puede editar.');
  if (p.status === 'CANCELLED') throw AppError.businessRule('La compra está cancelada.');
  if (Number(p.amountPaid) > 0) throw AppError.businessRule('La compra tiene pagos registrados; no se puede editar.');
}

export async function updatePurchase(auth: AuthContext, branchId: string, id: string, dto: PurchaseDto, client: ClientInfo) {
  assertDateNotFuture(dto.purchaseDate);
  const current = await findPurchase(prisma, branchId, id);
  assertEditable(current);
  const supplier = dto.supplierId === current.supplierId ? await prisma.supplier.findUniqueOrThrow({ where: { id: dto.supplierId } }) : await activeSupplier(dto.supplierId);
  await assertInvoiceFree(supplier.id, dto.invoiceNumber, id);
  const prepared = await preparePurchase(dto, supplier.creditDays);

  await prisma.$transaction(async (tx) => {
    const locked = await lockPurchase(tx, branchId, id);
    assertEditable(locked);
    await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });
    await tx.purchase.update({
      where: { id },
      data: {
        supplierId: supplier.id,
        invoiceNumber: dto.invoiceNumber,
        purchaseDate: parseDateOnly(dto.purchaseDate),
        paymentMethod: dto.paymentMethod,
        notes: dto.notes,
        ...prepared.data,
        items: { createMany: { data: prepared.items } },
      },
    });
    await recordAudit(
      {
        action: 'PURCHASE_UPDATE',
        userId: auth.userId,
        branchId,
        entityType: 'purchase',
        entityId: id,
        metadata: {
          folio: formatPurchaseNumber(current.number),
          totalBefore: Number(current.total),
          totalAfter: prepared.data.total,
          itemsBefore: current.items.length,
          itemsAfter: prepared.items.length,
        },
        client,
      },
      tx,
    );
  });
  return getPurchase(branchId, id);
}

// -----------------------------------------------------------------------------
// Recepción: ingresa la mercancía al inventario
// -----------------------------------------------------------------------------

/** Reescribe el error de una partida para que la interfaz lo muestre en su renglón. */
function itemError(err: unknown, index: number, field = 'lotNumber'): never {
  if (err instanceof AppError) {
    throw new AppError(err.status, err.code, `Partida ${index + 1}: ${err.message}`, [
      { path: `items.${index}.${field}`, message: err.message },
    ]);
  }
  throw err;
}

async function receiveInTx(tx: TxClient, auth: AuthContext, branchId: string, id: string, client: ClientInfo) {
  const purchase = await lockPurchase(tx, branchId, id);
  if (purchase.status === 'RECEIVED') throw AppError.businessRule('La compra ya se había recibido.');
  if (purchase.status === 'CANCELLED') throw AppError.businessRule('La compra está cancelada.');

  const today = todayISO();
  // Primero se validan todas las partidas para reportar el problema antes de mover nada
  purchase.items.forEach((item, index) => {
    if (!item.lotNumber) itemError(AppError.badRequest('Falta el número de lote'), index, 'lotNumber');
    if (!item.expiresAt) itemError(AppError.badRequest('Falta la fecha de caducidad'), index, 'expiresAt');
    if (dateOnly(item.expiresAt) < today) itemError(AppError.businessRule('El lote ya está caducado; no se puede recibir.'), index, 'expiresAt');
  });

  const folio = formatPurchaseNumber(purchase.number);
  const costChanges: { product: string; from: number; to: number }[] = [];
  for (const [index, item] of purchase.items.entries()) {
    const netUnitCost = purchaseLineAmounts({
      quantity: item.quantity,
      unitCost: Number(item.unitCost),
      discount: Number(item.discount),
      taxRate: Number(item.taxRate),
    }).netUnitCost;
    const received = await receiveStock(tx, {
      branchId,
      productId: item.productId,
      lotNumber: item.lotNumber!,
      expiresAt: item.expiresAt!,
      manufacturedAt: item.manufacturedAt,
      quantity: item.quantity,
      unitCost: netUnitCost,
      supplierId: purchase.supplierId,
      type: 'PURCHASE_ENTRY',
      userId: auth.userId,
      notes: `Compra ${folio}${purchase.invoiceNumber ? ` · factura ${purchase.invoiceNumber}` : ''}`,
      referenceType: 'PURCHASE',
      referenceId: purchase.id,
    }).catch((err: unknown) => itemError(err, index, err instanceof AppError && err.status === 409 ? 'expiresAt' : 'lotNumber'));
    await tx.purchaseItem.update({ where: { id: item.id }, data: { batchId: received.batchId } });

    // Último costo: el precio de compra del producto se actualiza con lo que realmente costó
    const product = await tx.product.findUniqueOrThrow({ where: { id: item.productId }, select: { purchasePrice: true, commercialName: true } });
    const newCost = Math.round(netUnitCost * 100) / 100;
    if (Number(product.purchasePrice) !== newCost) {
      await tx.product.update({ where: { id: item.productId }, data: { purchasePrice: newCost } });
      costChanges.push({ product: product.commercialName, from: Number(product.purchasePrice), to: newCost });
    }
  }

  // De contado: se paga al recibir (si quien recibe puede registrar pagos)
  let paidOnReceive = false;
  const total = Number(purchase.total);
  if (
    purchase.paymentMethod !== 'CREDIT' &&
    Number(purchase.amountPaid) === 0 &&
    total > 0 &&
    hasPermission(auth.roleCode, auth.permissions, 'purchases.pay')
  ) {
    await tx.purchasePayment.create({
      data: { purchaseId: purchase.id, amount: total, method: purchase.paymentMethod, paidAt: new Date(), userId: auth.userId, reference: 'Pago al recibir' },
    });
    paidOnReceive = true;
  }

  await tx.purchase.update({
    where: { id: purchase.id },
    data: {
      status: 'RECEIVED',
      receivedById: auth.userId,
      receivedAt: new Date(),
      ...(paidOnReceive ? { amountPaid: total, paymentStatus: 'PAID' } : {}),
    },
  });
  await recordAudit(
    {
      action: 'PURCHASE_RECEIVE',
      userId: auth.userId,
      branchId,
      entityType: 'purchase',
      entityId: purchase.id,
      metadata: {
        folio,
        items: purchase.items.length,
        units: purchase.items.reduce((s, i) => s + i.quantity, 0),
        total,
        paidOnReceive,
        costChanges,
      },
      client,
    },
    tx,
  );
}

export async function receivePurchase(auth: AuthContext, branchId: string, id: string, client: ClientInfo) {
  await prisma.$transaction((tx) => receiveInTx(tx, auth, branchId, id, client));
  return getPurchase(branchId, id);
}

// -----------------------------------------------------------------------------
// Cancelación
// -----------------------------------------------------------------------------

export async function cancelPurchase(auth: AuthContext, branchId: string, id: string, reason: string, client: ClientInfo) {
  await prisma.$transaction(async (tx) => {
    const purchase = await lockPurchase(tx, branchId, id);
    if (purchase.status === 'CANCELLED') throw AppError.businessRule('La compra ya estaba cancelada.');
    if (Number(purchase.amountPaid) > 0) {
      throw AppError.businessRule('La compra tiene pagos registrados; no se puede cancelar. Acuerda la devolución con el proveedor.');
    }
    const folio = formatPurchaseNumber(purchase.number);
    const wasReceived = purchase.status === 'RECEIVED';

    // Revertir el inventario: sólo si las unidades siguen en el lote
    if (wasReceived) {
      for (const item of purchase.items) {
        if (!item.batchId) continue;
        await applyMovement(tx, {
          branchId,
          batchId: item.batchId,
          type: 'ADJUSTMENT_OUT',
          change: -item.quantity,
          reason: 'RETURN',
          notes: `Cancelación de la compra ${folio}: ${reason}`,
          userId: auth.userId,
          referenceType: 'PURCHASE_CANCEL',
          referenceId: purchase.id,
        }).catch((err: unknown) => {
          if (err instanceof AppError && err.status === 422) {
            throw AppError.businessRule(
              `No se puede cancelar: del lote ${item.lotNumber} ya salieron unidades. Registra la devolución al proveedor como ajuste de inventario.`,
              err.details,
            );
          }
          throw err;
        });
      }
    }

    await tx.purchase.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
    await recordAudit(
      {
        action: 'PURCHASE_CANCEL',
        userId: auth.userId,
        branchId,
        entityType: 'purchase',
        entityId: id,
        metadata: { folio, reason, wasReceived, total: Number(purchase.total) },
        client,
      },
      tx,
    );
  });
  return getPurchase(branchId, id);
}

// -----------------------------------------------------------------------------
// Pagos a proveedor
// -----------------------------------------------------------------------------

export async function addPayment(auth: AuthContext, branchId: string, id: string, dto: PaymentDto, client: ClientInfo) {
  const today = todayISO();
  if (dto.paidAt && dto.paidAt > today) {
    throw AppError.badRequest('La fecha de pago no puede ser futura', [{ path: 'paidAt', message: 'Fecha futura' }]);
  }
  await prisma.$transaction(async (tx) => {
    const purchase = await lockPurchase(tx, branchId, id);
    if (purchase.status === 'CANCELLED') throw AppError.businessRule('La compra está cancelada.');
    const total = Number(purchase.total);
    const paid = Number(purchase.amountPaid);
    const balance = Math.round((total - paid) * 100) / 100;
    if (balance <= 0) throw AppError.businessRule('La compra ya está pagada.');
    if (dto.amount > balance + 0.005) {
      throw AppError.businessRule(`El pago excede el saldo pendiente (${balance.toFixed(2)}).`, [
        { path: 'amount', message: `Máximo ${balance.toFixed(2)}` },
      ]);
    }
    const newPaid = Math.round((paid + dto.amount) * 100) / 100;
    // Pagado "hoy" registra la hora actual; una fecha anterior, el mediodía de ese día
    const paidAt = !dto.paidAt || dto.paidAt === today ? new Date() : new Date(`${dto.paidAt}T12:00:00Z`);
    await tx.purchasePayment.create({
      data: { purchaseId: id, amount: dto.amount, method: dto.method, reference: dto.reference, paidAt, userId: auth.userId },
    });
    const paymentStatus = paymentStatusFor(total, newPaid);
    await tx.purchase.update({ where: { id }, data: { amountPaid: newPaid, paymentStatus } });
    await recordAudit(
      {
        action: 'PURCHASE_PAYMENT',
        userId: auth.userId,
        branchId,
        entityType: 'purchase',
        entityId: id,
        metadata: {
          folio: formatPurchaseNumber(purchase.number),
          amount: dto.amount,
          method: PAYMENT_METHOD_LABELS[dto.method],
          reference: dto.reference,
          balanceAfter: Math.round((total - newPaid) * 100) / 100,
        },
        client,
      },
      tx,
    );
  });
  return getPurchase(branchId, id);
}
