/** Inventario: tipos de movimiento, motivos de ajuste y caducidades. */

export const MOVEMENT_TYPES = [
  'INITIAL_STOCK',
  'PURCHASE_ENTRY',
  'SALE',
  'SALE_CANCELLATION',
  'CUSTOMER_RETURN',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'EXPIRED',
  'DAMAGED',
  'SHRINKAGE',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'QUARANTINE_RELEASE',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  INITIAL_STOCK: 'Carga inicial',
  PURCHASE_ENTRY: 'Entrada por compra',
  SALE: 'Venta',
  SALE_CANCELLATION: 'Cancelación de venta',
  CUSTOMER_RETURN: 'Devolución de cliente',
  ADJUSTMENT_IN: 'Ajuste positivo',
  ADJUSTMENT_OUT: 'Ajuste negativo',
  EXPIRED: 'Baja por caducidad',
  DAMAGED: 'Producto dañado',
  SHRINKAGE: 'Merma / pérdida',
  TRANSFER_IN: 'Transferencia (entrada)',
  TRANSFER_OUT: 'Transferencia (salida)',
  QUARANTINE_RELEASE: 'Liberación de cuarentena',
};

export const ADJUSTMENT_REASONS = [
  'DAMAGED',
  'EXPIRED',
  'DATA_ENTRY_ERROR',
  'THEFT_LOSS',
  'RETURN',
  'INVENTORY_CORRECTION',
  'INTERNAL_USE',
  'OTHER',
] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export const ADJUSTMENT_REASON_LABELS: Record<AdjustmentReason, string> = {
  DAMAGED: 'Producto dañado',
  EXPIRED: 'Producto caducado',
  DATA_ENTRY_ERROR: 'Error de captura',
  THEFT_LOSS: 'Robo / pérdida',
  RETURN: 'Devolución',
  INVENTORY_CORRECTION: 'Corrección de inventario (conteo físico)',
  INTERNAL_USE: 'Consumo interno',
  OTHER: 'Otro',
};

export type AdjustmentDirection = 'IN' | 'OUT';

/** Motivos válidos según el sentido del ajuste. */
export const REASONS_BY_DIRECTION: Record<AdjustmentDirection, readonly AdjustmentReason[]> = {
  IN: ['INVENTORY_CORRECTION', 'DATA_ENTRY_ERROR', 'RETURN', 'OTHER'],
  OUT: ['DAMAGED', 'EXPIRED', 'THEFT_LOSS', 'INTERNAL_USE', 'INVENTORY_CORRECTION', 'DATA_ENTRY_ERROR', 'RETURN', 'OTHER'],
};

/** Tipo de movimiento que genera un ajuste manual. */
export function adjustmentMovementType(direction: AdjustmentDirection, reason: AdjustmentReason): MovementType {
  if (direction === 'IN') return 'ADJUSTMENT_IN';
  switch (reason) {
    case 'EXPIRED':
      return 'EXPIRED';
    case 'DAMAGED':
      return 'DAMAGED';
    case 'THEFT_LOSS':
      return 'SHRINKAGE';
    default:
      return 'ADJUSTMENT_OUT';
  }
}

export type ExpiryStatus = 'EXPIRED' | 'CRITICAL' | 'WARNING' | 'OK';

export const EXPIRY_STATUS_LABELS: Record<ExpiryStatus, string> = {
  EXPIRED: 'Caducado',
  CRITICAL: 'Crítico',
  WARNING: 'Próximo',
  OK: 'Normal',
};

/**
 * Clasificación de caducidad: caducado (ya pasó), crítico (< 30 días),
 * próximo (30 a 90 días) y normal (> 90 días). Los umbrales son configurables.
 */
export function classifyExpiry(daysLeft: number, criticalDays = 30, warningDays = 90): ExpiryStatus {
  if (daysLeft < 0) return 'EXPIRED';
  if (daysLeft < criticalDays) return 'CRITICAL';
  if (daysLeft <= warningDays) return 'WARNING';
  return 'OK';
}

/** Días entre dos fechas "AAAA-MM-DD" (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
