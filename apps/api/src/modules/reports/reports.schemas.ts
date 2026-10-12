import { daysInRange, defaultGroupBy, EXPORT_FORMATS, REPORT_GROUP_BY, REPORT_KINDS, REPORT_MAX_DAYS, type ReportGroupBy } from '@farmacia/shared';
import { z } from 'zod';
import { todayISO } from '../../lib/dates';
import { isoDate } from '../../shared/schema-fields';

const shift = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Periodo del reporte. Sin fechas: los últimos 30 días (incluido hoy). */
export const rangeSchema = z
  .object({
    from: isoDate('Fecha inicial').optional(),
    to: isoDate('Fecha final').optional(),
    groupBy: z.enum(REPORT_GROUP_BY).optional(),
  })
  .transform((q, ctx) => {
    const today = todayISO();
    const to = q.to ?? (q.from && q.from > today ? q.from : today);
    const from = q.from ?? shift(to, -29);
    if (from > to) {
      ctx.addIssue({ code: 'custom', path: ['from'], message: 'La fecha inicial no puede ser posterior a la final' });
      return z.NEVER;
    }
    const days = daysInRange(from, to);
    if (days > REPORT_MAX_DAYS) {
      ctx.addIssue({ code: 'custom', path: ['from'], message: `El periodo máximo es de ${REPORT_MAX_DAYS} días` });
      return z.NEVER;
    }
    return { from, to, days, groupBy: (q.groupBy ?? defaultGroupBy(days)) as ReportGroupBy };
  });
export type RangeDto = z.output<typeof rangeSchema>;

export const exportSchema = z.object({
  report: z.enum(REPORT_KINDS),
  format: z.enum(EXPORT_FORMATS).default('xlsx'),
});
