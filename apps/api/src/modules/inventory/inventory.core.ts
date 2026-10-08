import type { AdjustmentReason, MovementType } from '@farmacia/shared';
import type { Prisma } from '../../generated/prisma/client';
import type { TxClient } from '../../lib/prisma';
import { dateOnly } from '../../lib/dates';
import { AppError } from '../../shared/errors';

/**
 * Núcleo del inventario. ÚNICO lugar del sistema que modifica existencias.
 * Cada cambio de cantidad:
 *   1. bloquea la fila del lote (SELECT ... FOR UPDATE) dentro de la transacción,
 *   2. valida que el resultado no sea negativo,
 *   3. actualiza el lote y registra el movimiento inmutable (antes, cambio, después).
 * Las funciones reciben el cliente de transacción: quien llama decide qué más
 * ocurre de forma atómica (venta, compra, auditoría...).
 */

interface LockedBatch {
  id: string;
  product_id: string;
  branch_id: string;
  lot_number: string;
  quantity: number;
  status: string;
  unit_cost: Prisma.Decimal;
  expires_at: Date;
}

async function lockBatch(tx: TxClient, batchId: string): Promise<LockedBatch> {
  const [batch] = await tx.$queryRaw<LockedBatch[]>`
    SELECT id, product_id, branch_id, lot_number, quantity, status, unit_cost, expires_at
    FROM product_batches
    WHERE id = ${batchId}::uuid
    FOR UPDATE`;
  if (!batch) throw AppError.notFound('Lote no encontrado');
  return batch;
}

export interface MovementInput {
  branchId: string;
  batchId: string;
  type: MovementType;
  /** Cambio con signo: positivo entra, negativo sale. Nunca 0. */
  change: number;
  userId: string;
  reason?: AdjustmentReason | null;
  notes?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
}

export async function applyMovement(tx: TxClient, input: MovementInput) {
  if (!Number.isInteger(input.change) || input.change === 0) {
    throw AppError.badRequest('La cantidad del movimiento debe ser un entero distinto de cero');
  }
  const batch = await lockBatch(tx, input.batchId);
  // Un lote de otra sucursal se trata como inexistente
  if (batch.branch_id !== input.branchId) throw AppError.notFound('Lote no encontrado');

  const before = batch.quantity;
  const after = before + input.change;
  if (after < 0) {
    throw AppError.businessRule(
      `No hay suficientes unidades en el lote ${batch.lot_number}: hay ${before} y se intentan retirar ${-input.change}.`,
      { available: before, requested: -input.change },
    );
  }

  // Agotado ↔ disponible según la cantidad; cuarentena y baja se conservan
  const status =
    after === 0 && batch.status === 'ACTIVE' ? 'DEPLETED' : after > 0 && batch.status === 'DEPLETED' ? 'ACTIVE' : batch.status;

  await tx.productBatch.update({
    where: { id: batch.id },
    data: { quantity: after, status: status as 'ACTIVE' | 'DEPLETED' | 'QUARANTINE' | 'DISCARDED' },
  });
  return tx.inventoryMovement.create({
    data: {
      branchId: input.branchId,
      productId: batch.product_id,
      batchId: batch.id,
      type: input.type,
      reason: input.reason ?? null,
      quantityBefore: before,
      quantityChange: input.change,
      quantityAfter: after,
      unitCost: batch.unit_cost,
      notes: input.notes ?? null,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      userId: input.userId,
    },
  });
}

export interface ReceiveInput {
  branchId: string;
  productId: string;
  lotNumber: string;
  expiresAt: Date;
  manufacturedAt?: Date | null;
  quantity: number;
  unitCost: number;
  supplierId?: string | null;
  type: Extract<MovementType, 'INITIAL_STOCK' | 'PURCHASE_ENTRY' | 'ADJUSTMENT_IN'>;
  userId: string;
  reason?: AdjustmentReason | null;
  notes?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
}

/**
 * Ingresa unidades de un lote. Si el lote ya existe en la sucursal se suma a él
 * (la caducidad debe coincidir); si no, se crea. Siempre genera un movimiento.
 */
export async function receiveStock(tx: TxClient, input: ReceiveInput) {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw AppError.badRequest('La cantidad debe ser un entero mayor a cero');
  }
  const existing = await tx.productBatch.findUnique({
    where: {
      productId_branchId_lotNumber: { productId: input.productId, branchId: input.branchId, lotNumber: input.lotNumber },
    },
  });

  let batchId: string;
  if (existing) {
    if (dateOnly(existing.expiresAt) !== dateOnly(input.expiresAt)) {
      throw AppError.conflict(
        `El lote ${input.lotNumber} ya existe con caducidad ${dateOnly(existing.expiresAt)}. Verifica el número de lote o la fecha.`,
        [{ path: 'expiresAt', message: 'No coincide con la caducidad registrada de este lote' }],
      );
    }
    if (existing.status === 'DISCARDED' || existing.status === 'QUARANTINE') {
      throw AppError.businessRule(`El lote ${input.lotNumber} está ${existing.status === 'DISCARDED' ? 'dado de baja' : 'en cuarentena'}.`);
    }
    batchId = existing.id;
  } else {
    const created = await tx.productBatch.create({
      data: {
        productId: input.productId,
        branchId: input.branchId,
        lotNumber: input.lotNumber,
        expiresAt: input.expiresAt,
        manufacturedAt: input.manufacturedAt ?? null,
        quantity: 0, // la cantidad entra con el movimiento
        initialQuantity: input.quantity,
        unitCost: input.unitCost,
        supplierId: input.supplierId ?? null,
      },
    });
    batchId = created.id;
  }

  const movement = await applyMovement(tx, {
    branchId: input.branchId,
    batchId,
    type: input.type,
    change: input.quantity,
    userId: input.userId,
    reason: input.reason,
    notes: input.notes,
    referenceType: input.referenceType,
    referenceId: input.referenceId,
  });
  return { batchId, movement, createdBatch: !existing };
}

export interface FefoAllocation {
  batchId: string;
  lotNumber: string;
  quantity: number;
  unitCost: Prisma.Decimal;
  expiresAt: Date;
}

/**
 * FEFO (First Expired, First Out): reparte la cantidad entre los lotes vendibles,
 * empezando por el que caduca primero. Bloquea esos lotes hasta el fin de la
 * transacción para que dos ventas simultáneas no tomen las mismas unidades.
 * No vende lotes caducados, en cuarentena ni dados de baja.
 */
export async function allocateFefo(
  tx: TxClient,
  params: { branchId: string; productId: string; quantity: number; today: string },
): Promise<FefoAllocation[]> {
  if (!Number.isInteger(params.quantity) || params.quantity <= 0) {
    throw AppError.badRequest('La cantidad debe ser un entero mayor a cero');
  }
  const batches = await tx.$queryRaw<{ id: string; lot_number: string; quantity: number; unit_cost: Prisma.Decimal; expires_at: Date }[]>`
    SELECT id, lot_number, quantity, unit_cost, expires_at
    FROM product_batches
    WHERE branch_id = ${params.branchId}::uuid
      AND product_id = ${params.productId}::uuid
      AND status = 'ACTIVE'
      AND quantity > 0
      AND expires_at >= ${params.today}::date
    ORDER BY expires_at ASC, received_at ASC
    FOR UPDATE`;

  const available = batches.reduce((sum, b) => sum + b.quantity, 0);
  if (available < params.quantity) {
    throw AppError.businessRule(`Existencia insuficiente: hay ${available} unidad(es) disponibles y se solicitan ${params.quantity}.`, {
      available,
      requested: params.quantity,
    });
  }

  const allocations: FefoAllocation[] = [];
  let pending = params.quantity;
  for (const b of batches) {
    if (pending === 0) break;
    const take = Math.min(b.quantity, pending);
    allocations.push({ batchId: b.id, lotNumber: b.lot_number, quantity: take, unitCost: b.unit_cost, expiresAt: b.expires_at });
    pending -= take;
  }
  return allocations;
}
