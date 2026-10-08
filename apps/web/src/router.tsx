import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
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
import { DashboardPage } from './features/dashboard/DashboardPage';
import { ProfilePage } from './features/profile/ProfilePage';

/** Inicio: dashboard si hay permiso; si no, el primer módulo permitido (p.ej. punto de venta). */
function HomeRoute() {
  const { can } = useAuth();
  if (can('dashboard.view')) return <DashboardPage />;
  const first = firstAllowedPath(can);
  return first && first !== '/' ? <Navigate to={first} replace /> : <ForbiddenPage />;
}

/** Módulos aún no implementados (se reemplazan por sus páginas reales en cada fase). */
const moduleRoutes: RouteObject[] = allNavItems()
  .filter((item) => item.to !== '/')
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
          ...moduleRoutes,
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
];

export const router = createBrowserRouter(routes);
