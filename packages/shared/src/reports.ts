/** Reportes: agrupaciones, límites y nombres compartidos por API e interfaz. */

export const REPORT_GROUP_BY = ['day', 'week', 'month'] as const;
export type ReportGroupBy = (typeof REPORT_GROUP_BY)[number];

export const REPORT_GROUP_BY_LABELS: Record<ReportGroupBy, string> = {
  day: 'Por día',
  week: 'Por semana',
  month: 'Por mes',
};

/** Periodo máximo de un reporte (protege a la base de datos de consultas enormes). */
export const REPORT_MAX_DAYS = 731;

export const REPORT_KINDS = ['sales', 'products', 'inventory', 'shrinkage', 'purchases'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_KIND_LABELS: Record<ReportKind, string> = {
  sales: 'Ventas',
  products: 'Productos',
  inventory: 'Inventario',
  shrinkage: 'Mermas y ajustes',
  purchases: 'Compras',
};

/** Reportes que sólo existen con costos (permiso reports.financial). */
export const FINANCIAL_ONLY_REPORTS: readonly ReportKind[] = ['purchases'];

export const EXPORT_FORMATS = ['csv', 'xlsx'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** Agrupación sugerida para un periodo: días hasta ~2 meses, semanas hasta ~6 meses, luego meses. */
export function defaultGroupBy(days: number): ReportGroupBy {
  if (days <= 62) return 'day';
  if (days <= 186) return 'week';
  return 'month';
}

/** Días naturales entre dos fechas "AAAA-MM-DD", incluyendo ambas. */
export function daysInRange(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** Inicio del periodo ("AAAA-MM-DD") al que pertenece una fecha. La semana empieza en lunes. */
export function bucketStart(date: string, groupBy: ReportGroupBy): string {
  if (groupBy === 'day') return date;
  if (groupBy === 'month') return `${date.slice(0, 7)}-01`;
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Todos los periodos entre dos fechas (también los que no tienen datos). */
export function bucketsInRange(from: string, to: string, groupBy: ReportGroupBy): string[] {
  const out: string[] = [];
  let current = bucketStart(from, groupBy);
  while (current <= to) {
    out.push(current);
    const d = new Date(`${current}T00:00:00Z`);
    if (groupBy === 'day') d.setUTCDate(d.getUTCDate() + 1);
    else if (groupBy === 'week') d.setUTCDate(d.getUTCDate() + 7);
    else d.setUTCMonth(d.getUTCMonth() + 1);
    current = d.toISOString().slice(0, 10);
  }
  return out;
}
