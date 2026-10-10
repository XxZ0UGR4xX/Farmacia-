/** Compras a proveedor: estados, pagos y cálculo de importes (backend y frontend). */

export const PURCHASE_STATUSES = ['DRAFT', 'ORDERED', 'RECEIVED', 'CANCELLED'] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  DRAFT: 'Borrador',
  ORDERED: 'Pendiente de recibir',
  RECEIVED: 'Recibida',
  CANCELLED: 'Cancelada',
};

export const PAYMENT_STATUSES = ['PENDING', 'PARTIAL', 'PAID'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  PENDING: 'Por pagar',
  PARTIAL: 'Pago parcial',
  PAID: 'Pagada',
};

export const PAYMENT_METHODS = ['CASH', 'CARD', 'TRANSFER', 'CREDIT', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Efectivo',
  CARD: 'Tarjeta',
  TRANSFER: 'Transferencia',
  CREDIT: 'Crédito',
  OTHER: 'Otro',
};

/** Formas en que se le paga a un proveedor (el crédito no es un pago). */
export const SUPPLIER_PAYMENT_METHODS = ['CASH', 'CARD', 'TRANSFER', 'OTHER'] as const satisfies readonly PaymentMethod[];

export const formatPurchaseNumber = (n: number) => `C-${String(n).padStart(6, '0')}`;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface PurchaseLineInput {
  quantity: number;
  /** Costo unitario sin IVA */
  unitCost: number;
  /** Descuento total de la partida (importe, sin IVA) */
  discount?: number;
  /** Tasa de IVA (0.16 = 16 %) */
  taxRate: number;
}

export interface PurchaseLineAmounts {
  subtotal: number;
  taxAmount: number;
  total: number;
  /** Costo por unidad ya con el descuento aplicado (lo que vale cada pieza en inventario) */
  netUnitCost: number;
}

/** Importes de una partida de compra. El IVA se calcula sobre el importe con descuento. */
export function purchaseLineAmounts(line: PurchaseLineInput): PurchaseLineAmounts {
  const gross = line.quantity * line.unitCost;
  const discount = line.discount ?? 0;
  const subtotal = round2(gross - discount);
  const taxAmount = round2(subtotal * line.taxRate);
  return {
    subtotal,
    taxAmount,
    total: round2(subtotal + taxAmount),
    netUnitCost: line.quantity > 0 ? Math.round(((gross - discount) / line.quantity) * 10000) / 10000 : 0,
  };
}

export function purchaseTotals(lines: PurchaseLineInput[]) {
  let gross = 0;
  let discountTotal = 0;
  let taxTotal = 0;
  for (const l of lines) {
    const a = purchaseLineAmounts(l);
    gross += l.quantity * l.unitCost;
    discountTotal += l.discount ?? 0;
    taxTotal += a.taxAmount;
  }
  const subtotal = round2(gross);
  discountTotal = round2(discountTotal);
  taxTotal = round2(taxTotal);
  return { subtotal, discountTotal, taxTotal, total: round2(subtotal - discountTotal + taxTotal) };
}

/** Estado de pago según lo abonado. */
export function paymentStatusFor(total: number, paid: number): PaymentStatus {
  if (paid <= 0) return 'PENDING';
  if (paid + 0.005 >= total) return 'PAID';
  return 'PARTIAL';
}

/** RFC mexicano: 3 letras (moral) o 4 (física), fecha AAMMDD y homoclave de 3. */
export const RFC_REGEX = /^[A-ZÑ&]{3,4}\d{6}[A-Z\d]{3}$/;
