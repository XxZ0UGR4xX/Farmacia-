import type { PermissionKey } from '@farmacia/shared';
import {
  Activity,
  BarChart3,
  Boxes,
  CalendarClock,
  ClipboardList,
  FileText,
  History,
  LayoutDashboard,
  type LucideIcon,
  Package,
  PackagePlus,
  Pill,
  Receipt,
  RotateCcw,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Truck,
  UserRound,
  Users,
} from 'lucide-react';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  permission: PermissionKey;
  /** Fase del plan en que se habilita el módulo (para la página "en construcción") */
  phase: number;
  description: string;
}

export interface NavSection {
  label: string;
  icon: LucideIcon;
  items: NavItem[];
}

export type NavEntry = NavItem | NavSection;

export const isSection = (e: NavEntry): e is NavSection => 'items' in e;

/** Fuente única de la navegación: el sidebar y las rutas se generan desde aquí. */
export const NAVIGATION: NavEntry[] = [
  {
    label: 'Dashboard',
    to: '/',
    icon: LayoutDashboard,
    permission: 'dashboard.view',
    phase: 9,
    description: 'Resumen del estado de la farmacia',
  },
  {
    label: 'Ventas',
    icon: ShoppingCart,
    items: [
      { label: 'Punto de venta', to: '/ventas/punto-de-venta', icon: Receipt, permission: 'sales.create', phase: 6, description: 'Cobro rápido con lector de código de barras y selección automática de lotes (FEFO).' },
      { label: 'Historial', to: '/ventas/historial', icon: History, permission: 'sales.view', phase: 6, description: 'Consulta de ventas, tickets y cancelaciones.' },
      { label: 'Devoluciones', to: '/ventas/devoluciones', icon: RotateCcw, permission: 'returns.view', phase: 6, description: 'Devoluciones de clientes con revisión antes de regresar al inventario.' },
    ],
  },
  {
    label: 'Inventario',
    icon: Package,
    items: [
      { label: 'Productos', to: '/inventario/productos', icon: Pill, permission: 'products.view', phase: 3, description: 'Catálogo de medicamentos, categorías y laboratorios.' },
      { label: 'Existencias', to: '/inventario/existencias', icon: Boxes, permission: 'inventory.view', phase: 4, description: 'Stock por producto y lote, con ajustes justificados.' },
      { label: 'Lotes', to: '/inventario/lotes', icon: ClipboardList, permission: 'inventory.view', phase: 4, description: 'Control individual de cada lote y su caducidad.' },
      { label: 'Caducidades', to: '/inventario/caducidades', icon: CalendarClock, permission: 'expirations.view', phase: 7, description: 'Productos caducados, críticos y próximos a caducar.' },
      { label: 'Movimientos', to: '/inventario/movimientos', icon: Activity, permission: 'inventory.movements.view', phase: 4, description: 'Bitácora inmutable de entradas, salidas y ajustes.' },
    ],
  },
  {
    label: 'Compras',
    icon: Truck,
    items: [
      { label: 'Nueva compra', to: '/compras/nueva', icon: PackagePlus, permission: 'purchases.create', phase: 5, description: 'Registro de facturas de proveedor con lotes y caducidades.' },
      { label: 'Historial', to: '/compras/historial', icon: History, permission: 'purchases.view', phase: 5, description: 'Compras, recepciones y pagos pendientes.' },
      { label: 'Proveedores', to: '/compras/proveedores', icon: Truck, permission: 'suppliers.view', phase: 5, description: 'Directorio de proveedores e historial de compras.' },
    ],
  },
  {
    label: 'Pacientes',
    icon: UserRound,
    items: [
      { label: 'Pacientes', to: '/pacientes', icon: UserRound, permission: 'patients.view', phase: 8, description: 'Expedientes administrativos de pacientes (información protegida).' },
      { label: 'Recetas', to: '/pacientes/recetas', icon: FileText, permission: 'prescriptions.view', phase: 8, description: 'Registro de recetas médicas.' },
    ],
  },
  { label: 'Reportes', to: '/reportes', icon: BarChart3, permission: 'reports.view', phase: 9, description: 'Reportes de inventario, ventas y finanzas con exportación.' },
  { label: 'Usuarios', to: '/usuarios', icon: Users, permission: 'users.view', phase: 2, description: 'Usuarios, roles y permisos.' },
  { label: 'Auditoría', to: '/auditoria', icon: ShieldCheck, permission: 'audit.view', phase: 10, description: 'Historial completo de acciones de los usuarios.' },
  { label: 'Configuración', to: '/configuracion', icon: Settings, permission: 'settings.view', phase: 10, description: 'Datos de la farmacia, impuestos y alertas.' },
];

export function allNavItems(entries: NavEntry[] = NAVIGATION): NavItem[] {
  return entries.flatMap((e) => (isSection(e) ? e.items : [e]));
}

/** Filtra la navegación según los permisos del usuario (oculta secciones vacías). */
export function filterNavigation(can: (p: PermissionKey) => boolean, entries: NavEntry[] = NAVIGATION): NavEntry[] {
  return entries.flatMap<NavEntry>((e) => {
    if (!isSection(e)) return can(e.permission) ? [e] : [];
    const items = e.items.filter((i) => can(i.permission));
    return items.length ? [{ ...e, items }] : [];
  });
}

/** Primera ruta a la que el usuario tiene acceso (p.ej. el cajero entra directo al punto de venta). */
export function firstAllowedPath(can: (p: PermissionKey) => boolean): string | null {
  return allNavItems().find((i) => can(i.permission))?.to ?? null;
}
