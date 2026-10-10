import type { PermissionKey } from './permissions';

/** Alertas del sistema: tipos, gravedad y quién puede verlas. */

export const NOTIFICATION_TYPES = [
  'OUT_OF_STOCK',
  'LOW_STOCK',
  'EXPIRING_SOON',
  'EXPIRED',
  'PURCHASE_PENDING',
  'SUPPLIER_PAYMENT_DUE',
  'INVENTORY_ANOMALY',
  'SYSTEM',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  OUT_OF_STOCK: 'Agotado',
  LOW_STOCK: 'Stock bajo',
  EXPIRING_SOON: 'Próximo a caducar',
  EXPIRED: 'Caducado',
  PURCHASE_PENDING: 'Compra por recibir',
  SUPPLIER_PAYMENT_DUE: 'Pago a proveedor',
  INVENTORY_ANOMALY: 'Revisión pendiente',
  SYSTEM: 'Sistema',
};

export const NOTIFICATION_SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

export const NOTIFICATION_SEVERITY_LABELS: Record<NotificationSeverity, string> = {
  INFO: 'Informativa',
  WARNING: 'Atención',
  CRITICAL: 'Urgente',
};

/**
 * Permiso necesario para ver cada tipo de alerta (basta con uno de la lista).
 * Así, por ejemplo, un cajero no recibe avisos de pagos a proveedores.
 */
export const NOTIFICATION_PERMISSIONS: Record<NotificationType, readonly PermissionKey[]> = {
  OUT_OF_STOCK: ['inventory.view'],
  LOW_STOCK: ['inventory.view'],
  EXPIRING_SOON: ['expirations.view', 'inventory.adjust'],
  EXPIRED: ['expirations.view', 'inventory.adjust'],
  PURCHASE_PENDING: ['purchases.receive', 'purchases.create'],
  SUPPLIER_PAYMENT_DUE: ['purchases.pay'],
  INVENTORY_ANOMALY: ['inventory.adjust'],
  SYSTEM: ['notifications.view'],
};
