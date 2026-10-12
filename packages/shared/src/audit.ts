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
  USER_ACTIVATE: 'Reactivación de usuario',
  USER_PASSWORD_RESET_BY_ADMIN: 'Restablecimiento de contraseña por administrador',
  USER_UNLOCK: 'Desbloqueo de cuenta',
  USER_SESSIONS_REVOKED: 'Cierre forzado de sesiones',
  ROLE_CREATE: 'Creación de rol',
  ROLE_UPDATE: 'Edición de rol',
  ROLE_PERMISSIONS_CHANGE: 'Cambio de permisos',
  ROLE_DELETE: 'Eliminación de rol',

  PRODUCT_CREATE: 'Creación de producto',
  PRODUCT_UPDATE: 'Edición de producto',
  PRODUCT_DELETE: 'Eliminación de producto',
  PRODUCT_PRICE_CHANGE: 'Cambio de precio',
  PRODUCT_IMAGE_CHANGE: 'Cambio de imagen de producto',
  CATALOG_CREATE: 'Alta en catálogo (categoría/laboratorio)',
  CATALOG_UPDATE: 'Edición de catálogo (categoría/laboratorio)',
  CATALOG_DELETE: 'Baja de catálogo (categoría/laboratorio)',

  INVENTORY_ADJUST: 'Ajuste de inventario',
  INVENTORY_ENTRY: 'Entrada de inventario (carga inicial / ajuste)',
  SALE_CREATE: 'Venta',
  SALE_CANCEL: 'Cancelación de venta',
  PURCHASE_CREATE: 'Compra',
  PURCHASE_UPDATE: 'Edición de compra',
  PURCHASE_RECEIVE: 'Recepción de compra',
  PURCHASE_CANCEL: 'Cancelación de compra',
  PURCHASE_PAYMENT: 'Pago a proveedor',
  SUPPLIER_CREATE: 'Alta de proveedor',
  SUPPLIER_UPDATE: 'Edición de proveedor',
  SUPPLIER_DEACTIVATE: 'Desactivación de proveedor',
  SUPPLIER_ACTIVATE: 'Reactivación de proveedor',
  RETURN_CREATE: 'Devolución',
  RETURN_REVIEW: 'Revisión de producto devuelto',

  PATIENT_VIEW: 'Consulta de expediente de paciente',
  PATIENT_CREATE: 'Alta de paciente',
  PATIENT_UPDATE: 'Edición de datos de paciente',
  PRESCRIPTION_CREATE: 'Registro de receta',
  PRESCRIPTION_VIEW: 'Consulta de receta',
  PRESCRIPTION_VOID: 'Anulación de receta',
  REPORT_EXPORT: 'Exportación de reporte',
  AUDIT_EXPORT: 'Exportación de la bitácora de auditoría',
  SETTINGS_UPDATE: 'Cambio de configuración',
  BRANCH_CREATE: 'Alta de sucursal',
  BRANCH_UPDATE: 'Edición de sucursal',
} as const;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

/** Grupos para filtrar la bitácora (cada acción pertenece a uno). */
export const AUDIT_GROUPS = {
  security: 'Seguridad y sesiones',
  users: 'Usuarios y roles',
  products: 'Productos y precios',
  inventory: 'Inventario',
  purchases: 'Compras y proveedores',
  sales: 'Ventas y devoluciones',
  patients: 'Pacientes y recetas',
  admin: 'Configuración y reportes',
} as const;
export type AuditGroup = keyof typeof AUDIT_GROUPS;

export function auditGroup(action: string): AuditGroup {
  if (action.startsWith('AUTH_') || action === 'ACCESS_DENIED') return 'security';
  if (action.startsWith('USER_') || action.startsWith('ROLE_')) return 'users';
  if (action.startsWith('PRODUCT_') || action.startsWith('CATALOG_')) return 'products';
  if (action.startsWith('INVENTORY_')) return 'inventory';
  if (action.startsWith('PURCHASE_') || action.startsWith('SUPPLIER_')) return 'purchases';
  if (action.startsWith('SALE_') || action.startsWith('RETURN_')) return 'sales';
  if (action.startsWith('PATIENT_') || action.startsWith('PRESCRIPTION_')) return 'patients';
  return 'admin';
}

/** Eventos que merecen revisión (intentos fallidos, bloqueos, accesos negados, tokens reutilizados). */
export const SECURITY_ALERT_ACTIONS: readonly AuditAction[] = ['AUTH_LOGIN_FAILED', 'AUTH_ACCOUNT_LOCKED', 'AUTH_TOKEN_REUSE', 'ACCESS_DENIED'];

export const isAuditAction = (value: string): value is AuditAction => Object.hasOwn(AUDIT_ACTIONS, value);
