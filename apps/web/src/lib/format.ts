const dateTimeFormat = new Intl.DateTimeFormat('es-MX', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const relativeFormat = new Intl.RelativeTimeFormat('es-MX', { numeric: 'auto' });

export function formatDateTime(iso: string | null | undefined): string {
  return iso ? dateTimeFormat.format(new Date(iso)) : '—';
}

/** "hace 5 minutos", "ayer", "hace 3 días"... */
export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'Nunca';
  const diffSeconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(diffSeconds);
  if (abs < 60) return 'hace un momento';
  if (abs < 3600) return relativeFormat.format(Math.round(diffSeconds / 60), 'minute');
  if (abs < 86_400) return relativeFormat.format(Math.round(diffSeconds / 3600), 'hour');
  if (abs < 30 * 86_400) return relativeFormat.format(Math.round(diffSeconds / 86_400), 'day');
  return dateTimeFormat.format(new Date(iso));
}

/** Iniciales para avatares: "Laura Méndez" → "LM". */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

const moneyFormat = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });

export function formatMoney(value: number | null | undefined): string {
  return value == null || Number.isNaN(value) ? '—' : moneyFormat.format(value);
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  return value == null ? '—' : `${value.toLocaleString('es-MX', { maximumFractionDigits: digits })} %`;
}

const dateFormat = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Fecha "AAAA-MM-DD" (sin hora) → "28 oct 2026". Se formatea en UTC para no correr el día. */
export function formatDate(isoDate: string | null | undefined): string {
  return isoDate ? dateFormat.format(new Date(`${isoDate.slice(0, 10)}T00:00:00Z`)) : '—';
}

/** Fecha local de hoy en formato "AAAA-MM-DD" (para inputs de fecha). */
export function todayInputValue(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** "en 15 días", "hoy", "hace 3 días" para caducidades. */
export function formatDaysLeft(days: number | null | undefined): string {
  if (days == null) return '—';
  if (days === 0) return 'Caduca hoy';
  if (days === 1) return 'Mañana';
  if (days < 0) return days === -1 ? 'Caducó ayer' : `Caducó hace ${-days} días`;
  return `${days} días`;
}
