/** Ventas y devoluciones: estados, formas de pago e importes (backend y frontend). */

export const SALE_STATUSES = ['COMPLETED', 'CANCELLED', 'PARTIALLY_RETURNED', 'RETURNED'] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

export const SALE_STATUS_LABELS: Record<SaleStatus, string> = {
  COMPLETED: 'Pagada',
  CANCELLED: 'Cancelada',
  PARTIALLY_RETURNED: 'Devolución parcial',
  RETURNED: 'Devuelta',
};

/** Formas de cobro en mostrador (el crédito sólo existe con proveedores). */
export const SALE_PAYMENT_METHODS = ['CASH', 'CARD', 'TRANSFER', 'OTHER'] as const;
export type SalePaymentMethod = (typeof SALE_PAYMENT_METHODS)[number];

export const RETURN_DISPOSITIONS = ['RESTOCKED', 'QUARANTINE', 'DISCARDED'] as const;
export type ReturnDisposition = (typeof RETURN_DISPOSITIONS)[number];

export const RETURN_DISPOSITION_LABELS: Record<ReturnDisposition, string> = {
  RESTOCKED: 'Regresa al inventario',
  QUARANTINE: 'En revisión',
  DISCARDED: 'Desechado',
};

export const formatSaleNumber = (n: number) => `V-${String(n).padStart(6, '0')}`;
export const formatReturnNumber = (n: number) => `D-${String(n).padStart(6, '0')}`;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface SaleLineInput {
  quantity: number;
  /** Precio de venta por unidad, tal como está en el catálogo */
  unitPrice: number;
  /** Descuento total de la partida (importe) */
  discount?: number;
  taxRate: number;
}

export interface SaleLineAmounts {
  /** Importe antes de descuento (cantidad × precio) */
  gross: number;
  /** Base sin IVA, ya con descuento */
  subtotal: number;
  taxAmount: number;
  /** Lo que paga el cliente por la partida */
  total: number;
}

/**
 * Importes de una partida de venta. Con precios que incluyen IVA (lo normal en mostrador)
 * el total es precio × cantidad − descuento y el IVA se desglosa de ahí.
 * Siempre se cumple total = subtotal + IVA.
 */
export function saleLineAmounts(line: SaleLineInput, pricesIncludeTax = true): SaleLineAmounts {
  const gross = round2(line.quantity * line.unitPrice);
  const afterDiscount = round2(gross - (line.discount ?? 0));
  if (pricesIncludeTax) {
    const subtotal = round2(afterDiscount / (1 + line.taxRate));
    const taxAmount = round2(afterDiscount - subtotal);
    return { gross, subtotal, taxAmount, total: round2(subtotal + taxAmount) };
  }
  const taxAmount = round2(afterDiscount * line.taxRate);
  return { gross, subtotal: afterDiscount, taxAmount, total: round2(afterDiscount + taxAmount) };
}

export interface SaleTotals {
  gross: number;
  discountTotal: number;
  subtotal: number;
  taxTotal: number;
  total: number;
}

export function saleTotals(lines: SaleLineInput[], pricesIncludeTax = true): SaleTotals {
  let gross = 0;
  let discountTotal = 0;
  let subtotal = 0;
  let taxTotal = 0;
  for (const l of lines) {
    const a = saleLineAmounts(l, pricesIncludeTax);
    gross += a.gross;
    discountTotal += l.discount ?? 0;
    subtotal += a.subtotal;
    taxTotal += a.taxAmount;
  }
  subtotal = round2(subtotal);
  taxTotal = round2(taxTotal);
  return { gross: round2(gross), discountTotal: round2(discountTotal), subtotal, taxTotal, total: round2(subtotal + taxTotal) };
}

/** Cambio a entregar: lo recibido en efectivo menos lo que se cobra en efectivo. */
export function cashChange(received: number, cashAmount: number): number {
  return round2(Math.max(0, received - cashAmount));
}
