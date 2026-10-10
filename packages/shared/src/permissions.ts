/**
 * Catálogo único de permisos. Backend y frontend usan exactamente estas claves.
 * Agregar un permiso aquí + correr el seeder lo registra en la base de datos.
 */
export const PERMISSIONS = {
  // Dashboard
  'dashboard.view': { module: 'dashboard', description: 'Ver el dashboard' },

  // Productos y catálogos
  'products.view': { module: 'products', description: 'Ver productos' },
  'products.create': { module: 'products', description: 'Crear productos' },
  'products.edit': { module: 'products', description: 'Editar productos' },
  'products.delete': { module: 'products', description: 'Eliminar productos' },
  'products.change_price': { module: 'products', description: 'Cambiar precios de venta', sensitive: true },
  'catalogs.manage': { module: 'products', description: 'Administrar categorías y laboratorios' },

  // Inventario
  'inventory.view': { module: 'inventory', description: 'Ver existencias y lotes' },
  'inventory.adjust': { module: 'inventory', description: 'Ajustar inventario (entradas/salidas manuales)', sensitive: true },
  'inventory.movements.view': { module: 'inventory', description: 'Ver historial de movimientos' },
  'inventory.transfer': { module: 'inventory', description: 'Transferir inventario entre sucursales' },
  'expirations.view': { module: 'inventory', description: 'Ver control de caducidades' },

  // Compras y proveedores
  'purchases.view': { module: 'purchases', description: 'Ver compras' },
  'purchases.create': { module: 'purchases', description: 'Registrar compras' },
  'purchases.receive': { module: 'purchases', description: 'Recibir compras (ingresar a inventario)' },
  'purchases.cancel': { module: 'purchases', description: 'Cancelar compras' },
  'purchases.pay': { module: 'purchases', description: 'Registrar pagos a proveedores', sensitive: true },
  'suppliers.view': { module: 'suppliers', description: 'Ver proveedores' },
  'suppliers.manage': { module: 'suppliers', description: 'Crear, editar y desactivar proveedores' },

  // Ventas
  'sales.view': { module: 'sales', description: 'Ver historial de ventas' },
  'sales.create': { module: 'sales', description: 'Realizar ventas (punto de venta)' },
  'sales.discount': { module: 'sales', description: 'Aplicar descuentos' },
  'sales.cancel': { module: 'sales', description: 'Cancelar ventas', sensitive: true },
  'returns.view': { module: 'sales', description: 'Ver devoluciones' },
  'returns.create': { module: 'sales', description: 'Registrar devoluciones' },

  // Pacientes y recetas (información sensible)
  'patients.view': { module: 'patients', description: 'Ver pacientes', sensitive: true },
  'patients.manage': { module: 'patients', description: 'Crear y editar pacientes', sensitive: true },
  'prescriptions.view': { module: 'patients', description: 'Ver recetas', sensitive: true },
  'prescriptions.manage': { module: 'patients', description: 'Registrar recetas' },
  'prescriptions.void': { module: 'patients', description: 'Anular recetas registradas (el historial no se borra)', sensitive: true },

  // Reportes
  'reports.view': { module: 'reports', description: 'Ver reportes operativos' },
  'reports.financial': { module: 'reports', description: 'Ver reportes financieros (costos y utilidad)', sensitive: true },
  'reports.export': { module: 'reports', description: 'Exportar reportes' },

  // Administración
  'users.view': { module: 'users', description: 'Ver usuarios' },
  'users.manage': { module: 'users', description: 'Crear, editar y desactivar usuarios', sensitive: true },
  'roles.manage': { module: 'users', description: 'Administrar roles y permisos', sensitive: true },
  'audit.view': { module: 'audit', description: 'Consultar auditoría', sensitive: true },
  'settings.view': { module: 'settings', description: 'Ver configuración' },
  'settings.manage': { module: 'settings', description: 'Modificar configuración de la farmacia', sensitive: true },
  'notifications.view': { module: 'notifications', description: 'Ver notificaciones' },
} as const satisfies Record<string, { module: string; description: string; sensitive?: boolean }>;

export type PermissionKey = keyof typeof PERMISSIONS;

export type PermissionModule = (typeof PERMISSIONS)[PermissionKey]['module'];

/** Nombre de cada módulo para la matriz de permisos (en orden de presentación). */
export const PERMISSION_MODULE_LABELS: Record<PermissionModule, string> = {
  dashboard: 'Dashboard',
  sales: 'Ventas y devoluciones',
  products: 'Productos y catálogos',
  inventory: 'Inventario y caducidades',
  purchases: 'Compras',
  suppliers: 'Proveedores',
  patients: 'Pacientes y recetas',
  reports: 'Reportes',
  users: 'Usuarios y roles',
  audit: 'Auditoría',
  settings: 'Configuración',
  notifications: 'Notificaciones',
};

/** Permisos que dan acceso a información sensible o a acciones críticas. */
export function isSensitivePermission(key: PermissionKey): boolean {
  return 'sensitive' in PERMISSIONS[key] && PERMISSIONS[key].sensitive === true;
}

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionKey[];

export function isPermissionKey(value: string): value is PermissionKey {
  return Object.hasOwn(PERMISSIONS, value);
}
