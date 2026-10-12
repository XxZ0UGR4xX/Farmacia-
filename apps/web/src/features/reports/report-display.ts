import { ADJUSTMENT_REASON_LABELS, MOVEMENT_TYPE_LABELS, type AdjustmentReason, type MovementType, type ReportGroupBy } from '@farmacia/shared';
import { formatPercent } from '../../lib/format';

const dayMonth = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const full = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthShort = new Intl.DateTimeFormat('es-MX', { month: 'short', year: '2-digit', timeZone: 'UTC' });
const monthLong = new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' });

const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const clean = (s: string) => s.replace(/\./g, '');

export function shiftDate(iso: string, days: number): string {
  const d = asDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Etiqueta corta (eje) y larga (tooltip y tabla) de un periodo; la semana se recorta al rango pedido. */
export function periodLabel(period: string, groupBy: ReportGroupBy, range: { from: string; to: string }): { axis: string; title: string } {
  if (groupBy === 'day') return { axis: clean(dayMonth.format(asDate(period))), title: capitalize(full.format(asDate(period))) };
  if (groupBy === 'month') return { axis: clean(monthShort.format(asDate(period))), title: capitalize(monthLong.format(asDate(period))) };
  const start = period < range.from ? range.from : period;
  const endOfWeek = shiftDate(period, 6);
  const end = endOfWeek > range.to ? range.to : endOfWeek;
  return { axis: clean(dayMonth.format(asDate(start))), title: `Semana del ${clean(dayMonth.format(asDate(start)))} al ${clean(dayMonth.format(asDate(end)))}` };
}

export function rangeLabel(from: string, to: string): string {
  const fmt = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return from === to ? clean(fmt.format(asDate(from))) : `${clean(fmt.format(asDate(from)))} – ${clean(fmt.format(asDate(to)))}`;
}

/** Proporción (0.528) → "52.8 %". */
export const ratio = (value: number | null | undefined) => (value == null ? '—' : formatPercent(value * 100));

export function lossLabel(type: string, reason: string | null): string {
  if (type === 'CUSTOMER_RETURN_DISCARDED') return 'Devolución de cliente desechada';
  if (reason && reason in ADJUSTMENT_REASON_LABELS) return ADJUSTMENT_REASON_LABELS[reason as AdjustmentReason];
  return MOVEMENT_TYPE_LABELS[type as MovementType] ?? type;
}

export const units = (n: number) => `${n.toLocaleString('es-MX')} ${n === 1 ? 'unidad' : 'unidades'}`;
export const count = (n: number, one: string, many: string) => `${n.toLocaleString('es-MX')} ${n === 1 ? one : many}`;
