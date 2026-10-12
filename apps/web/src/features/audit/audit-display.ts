import { AUDIT_ACTIONS, type AuditAction, type AuditGroup } from '@farmacia/shared';
import type { BadgeTone } from '../../components/ui/Badge';

export const actionLabel = (action: string) => AUDIT_ACTIONS[action as AuditAction] ?? action;

export const GROUP_TONES: Record<AuditGroup, BadgeTone> = {
  security: 'red',
  users: 'violet',
  products: 'blue',
  inventory: 'amber',
  purchases: 'neutral',
  sales: 'green',
  patients: 'violet',
  admin: 'neutral',
};

/** Nombres legibles de los datos más comunes del detalle (el resto se muestra tal cual). */
const KEY_LABELS: Record<string, string> = {
  reason: 'Motivo',
  email: 'Correo',
  product: 'Producto',
  quantity: 'Cantidad',
  before: 'Antes',
  after: 'Después',
  folio: 'Folio',
  total: 'Total',
  method: 'Método',
  path: 'Ruta',
  missing: 'Permisos faltantes',
  changes: 'Cambios',
  fields: 'Campos',
  key: 'Sección',
  lotNumber: 'Lote',
  expiresAt: 'Caducidad',
  type: 'Tipo',
  role: 'Rol',
  name: 'Nombre',
  code: 'Clave',
  format: 'Formato',
  report: 'Reporte',
  filters: 'Filtros',
  rows: 'Filas',
  items: 'Partidas',
  refundTotal: 'Reembolso',
  amount: 'Monto',
  financial: 'Con datos financieros',
  isActive: 'Activa',
  rememberMe: 'Recordar sesión',
  attempts: 'Intentos',
  lockedUntil: 'Bloqueada hasta',
  tradeName: 'Proveedor',
  commercialName: 'Producto',
  sku: 'SKU',
  barcode: 'Código de barras',
  permissions: 'Permisos',
  revokedSessions: 'Sesiones cerradas',
  affectedUsers: 'Usuarios afectados',
  branchIds: 'Sucursales',
  truncated: 'Recortada al máximo',
  from: 'Desde',
  to: 'Hasta',
  date: 'Fecha',
  // Configuración
  phone: 'Teléfono',
  address: 'Dirección',
  rfc: 'RFC',
  legalName: 'Razón social',
  taxRegime: 'Régimen fiscal',
  fiscalAddress: 'Domicilio fiscal',
  zipCode: 'Código postal',
  defaultRate: 'IVA predeterminado',
  pricesIncludeTax: 'Precios con IVA incluido',
  defaultMarginPercent: 'Margen predeterminado (%)',
  marginBasis: 'Cálculo del margen',
  defaultMinStock: 'Stock mínimo predeterminado',
  criticalDays: 'Días críticos de caducidad',
  warningDays: 'Días de aviso de caducidad',
};

/** Códigos que se guardan en la bitácora y su significado. */
const VALUE_LABELS: Record<string, string> = {
  COST: 'Sobre el costo',
  PRICE: 'Sobre el precio de venta',
  UNKNOWN_USER: 'Correo no registrado',
  BAD_PASSWORD: 'Contraseña incorrecta',
  ACCOUNT_LOCKED: 'Cuenta bloqueada',
  ACCOUNT_INACTIVE: 'Cuenta inactiva',
  'pharmacy.profile': 'Datos de la farmacia',
  'pharmacy.fiscal': 'Datos fiscales',
  'pharmacy.taxes': 'Impuestos',
  'inventory.defaults': 'Precios y margen',
  'alerts.expiry': 'Alertas de caducidad',
};

export const keyLabel = (key: string) => KEY_LABELS[key] ?? key;

export function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (typeof value === 'string') return VALUE_LABELS[value] ?? value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value) && value.every((v) => typeof v !== 'object' || v === null)) return value.map(formatValue).join(', ');
  return JSON.stringify(value);
}

/** Resumen de una línea del detalle para la tabla. */
export function summarize(action: string, metadata: unknown): string {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return '';
  const m = metadata as Record<string, unknown>;
  if (action === 'ACCESS_DENIED') return `${formatValue(m.method)} ${formatValue(m.path)} · falta ${formatValue(m.missing)}`;
  if (action === 'SETTINGS_UPDATE' && Array.isArray(m.changes)) {
    return `${formatValue(m.key)}: ${(m.changes as { field: string }[]).map((c) => keyLabel(c.field)).join(', ')}`;
  }
  return Object.entries(m)
    .filter(([, v]) => v !== null && (typeof v !== 'object' || (Array.isArray(v) && v.length <= 4)))
    .slice(0, 3)
    .map(([k, v]) => `${keyLabel(k)}: ${formatValue(v)}`)
    .join(' · ');
}

/** "Chrome en Windows" a partir del user agent (sólo para orientar; el texto completo queda en el detalle). */
export function deviceLabel(ua: string | null): string {
  if (!ua) return '—';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Otro navegador';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'otro sistema';
  return `${browser} en ${os}`;
}
