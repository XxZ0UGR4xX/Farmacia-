import { lazy, type ComponentType } from 'react';
import { createBrowserRouter, Navigate, Outlet, type RouteObject } from 'react-router';
import { PublicOnly, RequireAuth, RequirePermission } from './auth/guards';
import { useAuth } from './auth/useAuth';
import { AppLayout } from './components/layout/AppLayout';
import { allNavItems, firstAllowedPath } from './components/layout/navigation';
import { ForgotPasswordPage } from './features/auth/ForgotPasswordPage';
import { LoginPage } from './features/auth/LoginPage';
import { ResetPasswordPage } from './features/auth/ResetPasswordPage';
import { ComingSoonPage } from './features/common/ComingSoonPage';
import { ForbiddenPage } from './features/common/ForbiddenPage';
import { NotFoundPage } from './features/common/NotFoundPage';

/**
 * Cada módulo se descarga la primera vez que se visita (división del código por ruta):
 * la carga inicial sólo trae lo necesario para iniciar sesión y mostrar el menú.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cada página declara sus propias props
type AnyPage = ComponentType<any>;
function page<M extends Record<K, AnyPage>, K extends keyof M>(loader: () => Promise<M>, name: K) {
  return lazy<M[K]>(() => loader().then((m) => ({ default: m[name] })));
}

const DashboardPage = page(() => import('./features/dashboard/DashboardPage'), 'DashboardPage');
const BatchesPage = page(() => import('./features/inventory/BatchesPage'), 'BatchesPage');
const ExpirationsPage = page(() => import('./features/inventory/ExpirationsPage'), 'ExpirationsPage');
const MovementsPage = page(() => import('./features/inventory/MovementsPage'), 'MovementsPage');
const ProductInventoryPage = page(() => import('./features/inventory/ProductInventoryPage'), 'ProductInventoryPage');
const StockPage = page(() => import('./features/inventory/StockPage'), 'StockPage');
const CatalogPage = page(() => import('./features/products/CatalogPage'), 'CatalogPage');
const ProductFormPage = page(() => import('./features/products/ProductFormPage'), 'ProductFormPage');
const ProductsLayout = page(() => import('./features/products/ProductsLayout'), 'ProductsLayout');
const ProductsListPage = page(() => import('./features/products/ProductsListPage'), 'ProductsListPage');
const NotificationsPage = page(() => import('./features/notifications/NotificationsPage'), 'NotificationsPage');
const PatientDetailPage = page(() => import('./features/patients/PatientDetailPage'), 'PatientDetailPage');
const PatientsPage = page(() => import('./features/patients/PatientsPage'), 'PatientsPage');
const PrescriptionDetailPage = page(() => import('./features/patients/PrescriptionDetailPage'), 'PrescriptionDetailPage');
const PrescriptionsPage = page(() => import('./features/patients/PrescriptionsPage'), 'PrescriptionsPage');
const ProfilePage = page(() => import('./features/profile/ProfilePage'), 'ProfilePage');
const PurchaseDetailPage = page(() => import('./features/purchases/PurchaseDetailPage'), 'PurchaseDetailPage');
const PurchaseFormPage = page(() => import('./features/purchases/PurchaseFormPage'), 'PurchaseFormPage');
const PurchasesListPage = page(() => import('./features/purchases/PurchasesListPage'), 'PurchasesListPage');
const SuppliersPage = page(() => import('./features/purchases/SuppliersPage'), 'SuppliersPage');
const PosPage = page(() => import('./features/sales/PosPage'), 'PosPage');
const ReturnsPage = page(() => import('./features/sales/ReturnsPage'), 'ReturnsPage');
const SaleDetailPage = page(() => import('./features/sales/SaleDetailPage'), 'SaleDetailPage');
const SalesHistoryPage = page(() => import('./features/sales/SalesHistoryPage'), 'SalesHistoryPage');
const RoleEditorPage = page(() => import('./features/users/RoleEditorPage'), 'RoleEditorPage');
const RolesListPage = page(() => import('./features/users/RolesListPage'), 'RolesListPage');
const UsersLayout = page(() => import('./features/users/UsersLayout'), 'UsersLayout');
const UsersListPage = page(() => import('./features/users/UsersListPage'), 'UsersListPage');
const AuditPage = page(() => import('./features/audit/AuditPage'), 'AuditPage');
const ReportsPage = page(() => import('./features/reports/ReportsPage'), 'ReportsPage');
const SettingsPage = page(() => import('./features/settings/SettingsPage'), 'SettingsPage');

/** Inicio: dashboard si hay permiso; si no, el primer módulo permitido (p.ej. punto de venta). */
function HomeRoute() {
  const { can } = useAuth();
  if (can('dashboard.view')) return <DashboardPage />;
  const first = firstAllowedPath(can);
  return first && first !== '/' ? <Navigate to={first} replace /> : <ForbiddenPage />;
}

/** Módulos ya implementados, con sus rutas reales. */
const implementedRoutes: RouteObject[] = [
  {
    path: 'ventas/punto-de-venta',
    element: (
      <RequirePermission permission="sales.create">
        <PosPage />
      </RequirePermission>
    ),
  },
  {
    path: 'ventas/historial',
    element: (
      <RequirePermission permission="sales.view">
        <Outlet />
      </RequirePermission>
    ),
    children: [
      { index: true, element: <SalesHistoryPage /> },
      { path: ':id', element: <SaleDetailPage /> },
    ],
  },
  {
    path: 'ventas/devoluciones',
    element: (
      <RequirePermission permission="returns.view">
        <ReturnsPage />
      </RequirePermission>
    ),
  },
  {
    path: 'inventario/existencias',
    element: (
      <RequirePermission permission="inventory.view">
        <Outlet />
      </RequirePermission>
    ),
    children: [
      { index: true, element: <StockPage /> },
      { path: ':productId', element: <ProductInventoryPage /> },
    ],
  },
  {
    path: 'inventario/lotes',
    element: (
      <RequirePermission permission="inventory.view">
        <BatchesPage />
      </RequirePermission>
    ),
  },
  {
    path: 'inventario/caducidades',
    element: (
      <RequirePermission permission="expirations.view">
        <ExpirationsPage />
      </RequirePermission>
    ),
  },
  {
    path: 'pacientes/recetas',
    element: (
      <RequirePermission permission="prescriptions.view">
        <Outlet />
      </RequirePermission>
    ),
    children: [
      { index: true, element: <PrescriptionsPage /> },
      { path: ':id', element: <PrescriptionDetailPage /> },
    ],
  },
  {
    path: 'pacientes',
    element: (
      <RequirePermission permission="patients.view">
        <Outlet />
      </RequirePermission>
    ),
    children: [
      { index: true, element: <PatientsPage /> },
      { path: ':id', element: <PatientDetailPage /> },
    ],
  },
  {
    path: 'notificaciones',
    element: (
      <RequirePermission permission="notifications.view">
        <NotificationsPage />
      </RequirePermission>
    ),
  },
  {
    path: 'inventario/movimientos',
    element: (
      <RequirePermission permission="inventory.movements.view">
        <MovementsPage />
      </RequirePermission>
    ),
  },
  {
    path: 'inventario/productos',
    element: (
      <RequirePermission permission="products.view">
        <Outlet />
      </RequirePermission>
    ),
    children: [
      {
        element: <ProductsLayout />,
        children: [
          { index: true, element: <ProductsListPage /> },
          { path: 'categorias', element: <CatalogPage kind="categories" /> },
          { path: 'laboratorios', element: <CatalogPage kind="laboratories" /> },
        ],
      },
      {
        path: 'nuevo',
        element: (
          <RequirePermission permission="products.create">
            <ProductFormPage />
          </RequirePermission>
        ),
      },
      { path: ':id', element: <ProductFormPage /> },
    ],
  },
  {
    path: 'compras/nueva',
    element: (
      <RequirePermission permission="purchases.create">
        <PurchaseFormPage />
      </RequirePermission>
    ),
  },
  {
    path: 'compras/historial',
    element: (
      <RequirePermission permission="purchases.view">
        <Outlet />
      </RequirePermission>
    ),
    children: [
      { index: true, element: <PurchasesListPage /> },
      { path: ':id', element: <PurchaseDetailPage /> },
      {
        path: ':id/editar',
        element: (
          <RequirePermission permission="purchases.create">
            <PurchaseFormPage />
          </RequirePermission>
        ),
      },
    ],
  },
  {
    path: 'compras/proveedores',
    element: (
      <RequirePermission permission="suppliers.view">
        <SuppliersPage />
      </RequirePermission>
    ),
  },
  {
    path: 'reportes',
    element: (
      <RequirePermission permission="reports.view">
        <ReportsPage />
      </RequirePermission>
    ),
  },
  {
    path: 'auditoria',
    element: (
      <RequirePermission permission="audit.view">
        <AuditPage />
      </RequirePermission>
    ),
  },
  {
    path: 'configuracion',
    element: (
      <RequirePermission permission="settings.view">
        <SettingsPage />
      </RequirePermission>
    ),
  },
  {
    path: 'usuarios',
    element: (
      <RequirePermission permission="users.view">
        <UsersLayout />
      </RequirePermission>
    ),
    children: [
      { index: true, element: <UsersListPage /> },
      { path: 'roles', element: <RolesListPage /> },
      {
        path: 'roles/nuevo',
        element: (
          <RequirePermission permission="roles.manage">
            <RoleEditorPage />
          </RequirePermission>
        ),
      },
      { path: 'roles/:id', element: <RoleEditorPage /> },
    ],
  },
];
const implementedPaths = new Set(implementedRoutes.map((r) => `/${r.path}`));

/** Módulos aún no implementados (se reemplazan por sus páginas reales en cada fase). */
const moduleRoutes: RouteObject[] = allNavItems()
  .filter((item) => item.to !== '/' && !implementedPaths.has(item.to))
  .map((item) => ({
    path: item.to.slice(1),
    element: (
      <RequirePermission permission={item.permission}>
        <ComingSoonPage item={item} />
      </RequirePermission>
    ),
  }));

export const routes: RouteObject[] = [
  {
    element: <PublicOnly />,
    children: [
      { path: 'iniciar-sesion', element: <LoginPage /> },
      { path: 'recuperar-contrasena', element: <ForgotPasswordPage /> },
    ],
  },
  // Accesible con o sin sesión (el enlace llega por correo)
  { path: 'restablecer-contrasena', element: <ResetPasswordPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <HomeRoute /> },
          { path: 'perfil', element: <ProfilePage /> },
          ...implementedRoutes,
          ...moduleRoutes,
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
];

export const router = createBrowserRouter(routes);
