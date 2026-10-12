import {
  ADJUSTMENT_REASON_LABELS,
  MOVEMENT_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  REPORT_GROUP_BY_LABELS,
  type AdjustmentReason,
  type MovementType,
  type PaymentMethod,
  type ReportKind,
} from '@farmacia/shared';
import type { XlsxColumn, XlsxSheet } from '../../lib/xlsx';
import type { AuthContext } from '../../shared/request-context';
import type { RangeDto } from './reports.schemas';
import * as reports from './reports.service';

/**
 * Convierte cada reporte en hojas de cálculo. Las columnas de costo y utilidad
 * sólo existen si el usuario tiene el permiso financiero (los datos ya llegan sin ellas).
 * El CSV lleva sólo la primera hoja (la tabla principal del reporte).
 */

type Row = (string | number | null)[];

const col = (header: string, format: XlsxColumn['format'] = 'text', width?: number): XlsxColumn => ({ header, format, width });
const methodLabel = (m: string) => PAYMENT_METHOD_LABELS[m as PaymentMethod] ?? m;
const lossLabel = (type: string, reason: string | null) =>
  type === 'CUSTOMER_RETURN_DISCARDED'
    ? 'Devolución de cliente desechada'
    : reason
      ? ADJUSTMENT_REASON_LABELS[reason as AdjustmentReason] ?? reason
      : MOVEMENT_TYPE_LABELS[type as MovementType] ?? type;

/** Sólo las columnas permitidas: [columna, valor] con el valor ya calculado. */
function table<T>(name: string, items: T[], spec: [XlsxColumn, (item: T) => string | number | null | undefined, boolean?][]): XlsxSheet {
  const visible = spec.filter(([, , show]) => show !== false);
  return {
    name,
    columns: visible.map(([c]) => c),
    rows: items.map((item) => visible.map(([, f]) => f(item) ?? null) as Row),
  };
}

export async function buildReportSheets(kind: ReportKind, auth: AuthContext, branchId: string, range: RangeDto): Promise<XlsxSheet[]> {
  const periodHeader = `Periodo (${REPORT_GROUP_BY_LABELS[range.groupBy].toLowerCase()})`;
  switch (kind) {
    case 'sales': {
      const r = await reports.salesReport(auth, branchId, range);
      const fin = r.financial;
      return [
        table('Ventas por periodo', r.series, [
          [col(periodHeader, 'date', 16), (s) => s.period],
          [col('Ventas', 'int'), (s) => s.count],
          [col('Unidades', 'int'), (s) => s.units],
          [col('Ventas brutas', 'money', 16), (s) => s.gross],
          [col('Devoluciones', 'money', 14), (s) => s.refunds],
          [col('Ventas netas', 'money', 16), (s) => s.net],
          [col('Utilidad bruta', 'money', 16), (s) => s.profit, fin],
        ]),
        table('Formas de pago', r.byMethod, [
          [col('Forma de pago', 'text', 18), (m) => methodLabel(m.method)],
          [col('Ventas', 'int'), (m) => m.count],
          [col('Cobrado', 'money', 14), (m) => m.amount],
          [col('Reembolsado', 'money', 14), (m) => m.refunds],
          [col('Neto', 'money', 14), (m) => m.net],
        ]),
        table('Por cajero', r.byCashier, [
          [col('Usuario', 'text', 28), (c) => c.fullName],
          [col('Ventas', 'int'), (c) => c.count],
          [col('Total', 'money', 14), (c) => c.total],
          [col('Ticket promedio', 'money', 16), (c) => c.averageTicket],
          [col('Descuentos', 'money', 14), (c) => c.discount],
          [col('Canceladas', 'int'), (c) => c.cancelled],
        ]),
        table('Por categoría', r.byCategory, [
          [col('Categoría', 'text', 28), (c) => c.name],
          [col('Unidades', 'int'), (c) => c.units],
          [col('Total', 'money', 14), (c) => c.total],
          [col('Utilidad bruta', 'money', 16), (c) => c.profit, fin],
        ]),
        table('Por hora', r.byHour, [
          [col('Hora', 'text'), (h) => `${String(h.hour).padStart(2, '0')}:00`],
          [col('Ventas', 'int'), (h) => h.count],
          [col('Total', 'money', 14), (h) => h.total],
        ]),
      ];
    }
    case 'products': {
      const r = await reports.productsReport(auth, branchId, range, 500);
      const fin = r.financial;
      return [
        table('Más vendidos', r.top, [
          [col('SKU', 'text', 14), (p) => p.sku],
          [col('Producto', 'text', 36), (p) => p.name],
          [col('Categoría', 'text', 20), (p) => p.category],
          [col('Unidades', 'int'), (p) => p.units],
          [col('Devueltas', 'int'), (p) => p.returned],
          [col('Ventas', 'int'), (p) => p.sales],
          [col('Total', 'money', 14), (p) => p.total],
          [col('Utilidad bruta', 'money', 16), (p) => p.profit, fin],
        ]),
        table('Sin movimiento', r.slow, [
          [col('SKU', 'text', 14), (p) => p.sku],
          [col('Producto', 'text', 36), (p) => p.name],
          [col('Categoría', 'text', 20), (p) => p.category],
          [col('Existencia', 'int'), (p) => p.stock],
          [col('Valor a precio de venta', 'money', 22), (p) => p.retailValue],
          [col('Valor a costo', 'money', 16), (p) => p.costValue, fin],
          [col('Última venta', 'date', 14), (p) => p.lastSale?.slice(0, 10)],
        ]),
      ];
    }
    case 'inventory': {
      const r = await reports.inventoryReport(auth, branchId);
      const fin = r.financial;
      return [
        table('Inventario por categoría', r.byCategory, [
          [col('Categoría', 'text', 28), (c) => c.name],
          [col('Productos', 'int'), (c) => c.products],
          [col('Unidades', 'int'), (c) => c.units],
          [col('Valor a precio de venta', 'money', 22), (c) => c.retailValue],
          [col('Valor a costo', 'money', 16), (c) => c.costValue, fin],
        ]),
        table(
          'Riesgo',
          [
            { label: `Caduca en menos de ${r.risk.criticalDays} días`, lots: r.risk.expiringSoon.lots, units: r.risk.expiringSoon.units, cost: r.risk.expiringSoon.costValue },
            { label: 'Caducado con existencia', lots: r.risk.expired.lots, units: r.risk.expired.units, cost: r.risk.expired.costValue },
            { label: 'En cuarentena', lots: null, units: r.risk.quarantine.units, cost: r.risk.quarantine.costValue },
          ],
          [
            [col('Concepto', 'text', 32), (x) => x.label],
            [col('Lotes', 'int'), (x) => x.lots],
            [col('Unidades', 'int'), (x) => x.units],
            [col('Valor a costo', 'money', 16), (x) => x.cost, fin],
          ],
        ),
      ];
    }
    case 'shrinkage': {
      const r = await reports.shrinkageReport(auth, branchId, range);
      const fin = r.financial;
      const lossRows = [...r.losses.map((l) => ({ ...l, direction: 'Salida' })), ...r.gains.map((g) => ({ ...g, direction: 'Entrada' }))];
      return [
        table('Mermas por motivo', lossRows, [
          [col('Sentido', 'text', 10), (l) => l.direction],
          [col('Motivo', 'text', 36), (l) => lossLabel(l.type, l.reason)],
          [col('Registros', 'int'), (l) => l.movements],
          [col('Unidades', 'int'), (l) => l.units],
          [col('Costo', 'money', 14), (l) => ('cost' in l ? (l.cost as number) : null), fin],
        ]),
        table('Productos con más merma', r.top, [
          [col('SKU', 'text', 14), (p) => p.sku],
          [col('Producto', 'text', 36), (p) => p.name],
          [col('Unidades', 'int'), (p) => p.units],
          [col('Costo', 'money', 14), (p) => ('cost' in p ? (p.cost as number) : null), fin],
        ]),
      ];
    }
    case 'purchases': {
      const r = await reports.purchasesReport(auth, branchId, range);
      return [
        table('Compras por proveedor', r.bySupplier, [
          [col('Proveedor', 'text', 32), (s) => s.name],
          [col('Compras', 'int'), (s) => s.count],
          [col('Subtotal', 'money', 14), (s) => s.subtotal],
          [col('IVA', 'money', 12), (s) => s.tax],
          [col('Total', 'money', 14), (s) => s.total],
          [col('Pagado', 'money', 14), (s) => s.paid],
          [col('Participación', 'percent'), (s) => s.share],
        ]),
        table('Cuentas por pagar', r.payables, [
          [col('Proveedor', 'text', 32), (p) => p.name],
          [col('Compras con saldo', 'int', 18), (p) => p.count],
          [col('Saldo', 'money', 14), (p) => p.balance],
          [col('Vencido', 'money', 14), (p) => p.overdue],
          [col('Próximo vencimiento', 'date', 20), (p) => p.nextDue],
        ]),
        table('Compras por periodo', r.series, [
          [col(periodHeader, 'date', 16), (s) => s.period],
          [col('Compras', 'int'), (s) => s.count],
          [col('Total', 'money', 14), (s) => s.total],
        ]),
      ];
    }
  }
}
