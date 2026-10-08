/** Acciones auditables. La etiqueta se muestra en la bitácora de auditoría. */
export const AUDIT_ACTIONS = {
  AUTH_LOGIN: 'Inicio de sesión',
  AUTH_LOGIN_FAILED: 'Intento de inicio de sesión fallido',
  AUTH_ACCOUNT_LOCKED: 'Cuenta bloqueada por intentos fallidos',
  AUTH_LOGOUT: 'Cierre de sesión',
  AUTH_TOKEN_REUSE: 'Reutilización de token detectada (sesión revocada)',
  AUTH_PASSWORD_RESET_REQUESTED: 'Solicitud de recuperación de contraseña',
  AUTH_PASSWORD_RESET: 'Contraseña restablecida',
  AUTH_PASSWORD_CHANGED: 'Contraseña cambiada',
  ACCESS_DENIED: 'Acceso denegado',

  USER_CREATE: 'Creación de usuario',
  USER_UPDATE: 'Edición de usuario',
  USER_DEACTIVATE: 'Desactivación de usuario',
  ROLE_CREATE: 'Creación de rol',
  ROLE_UPDATE: 'Edición de rol',
  ROLE_PERMISSIONS_CHANGE: 'Cambio de permisos',

  PRODUCT_CREATE: 'Creación de producto',
  PRODUCT_UPDATE: 'Edición de producto',
  PRODUCT_DELETE: 'Eliminación de producto',
  PRODUCT_PRICE_CHANGE: 'Cambio de precio',

  INVENTORY_ADJUST: 'Ajuste de inventario',
  SALE_CREATE: 'Venta',
  SALE_CANCEL: 'Cancelación de venta',
  PURCHASE_CREATE: 'Compra',
  PURCHASE_RECEIVE: 'Recepción de compra',
  PURCHASE_CANCEL: 'Cancelación de compra',
  RETURN_CREATE: 'Devolución',

  PATIENT_VIEW: 'Consulta de expediente de paciente',
  SETTINGS_UPDATE: 'Cambio de configuración',
} as const;

export type AuditAction = keyof typeof AUDIT_ACTIONS;
