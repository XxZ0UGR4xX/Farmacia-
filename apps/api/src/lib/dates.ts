import { env } from '../config/env';

/** Fecha "AAAA-MM-DD" en la zona horaria de la farmacia. */
export function todayISO(now = new Date(), timeZone = env.APP_TIMEZONE): string {
  // en-CA formatea como AAAA-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Fecha de una columna DATE de PostgreSQL (llega como medianoche UTC) → "AAAA-MM-DD". */
export function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** "AAAA-MM-DD" → Date a medianoche UTC (formato que Prisma espera para columnas DATE). */
export function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

/** Minutos de diferencia entre la zona horaria y UTC en un instante dado. */
function offsetMinutes(at: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!);
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** Instante en que empieza el día "AAAA-MM-DD" en la zona horaria de la farmacia. */
export function startOfDay(date: string, timeZone = env.APP_TIMEZONE): Date {
  const utcMidnight = parseDateOnly(date);
  return new Date(utcMidnight.getTime() - offsetMinutes(utcMidnight, timeZone) * 60_000);
}

/** Instante en que empieza el día siguiente (límite exclusivo de un rango). */
export function endOfDayExclusive(date: string, timeZone = env.APP_TIMEZONE): Date {
  const next = parseDateOnly(date);
  next.setUTCDate(next.getUTCDate() + 1);
  return startOfDay(dateOnly(next), timeZone);
}
