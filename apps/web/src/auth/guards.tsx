import type { PermissionKey } from '@farmacia/shared';
import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { FullPageSpinner } from '../components/ui/Spinner';
import { ForbiddenPage } from '../features/common/ForbiddenPage';
import { useAuth } from './useAuth';

/** Rutas privadas: exige sesión. Guarda la ruta original para volver tras el login. */
export function RequireAuth() {
  const { status, user } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <FullPageSpinner label="Verificando sesión..." />;
  if (status === 'anonymous' || !user) {
    return <Navigate to="/iniciar-sesion" replace state={{ from: location.pathname + location.search }} />;
  }
  if (user.mustChangePassword && location.pathname !== '/perfil') {
    return <Navigate to="/perfil?obligatorio=1" replace />;
  }
  return <Outlet />;
}

/** Destino tras iniciar sesión: la ruta protegida que se intentó abrir, o el inicio. */
export function postLoginPath(state: unknown): string {
  const from = (state as { from?: unknown } | null)?.from;
  // Sólo rutas internas: '//dominio' sería una redirección a otro sitio
  const internal = typeof from === 'string' && from.startsWith('/') && !from.startsWith('//');
  return internal && !from.startsWith('/iniciar-sesion') ? from : '/';
}

/** Rutas públicas de autenticación: si ya hay sesión, ir a la ruta solicitada o al inicio. */
export function PublicOnly() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullPageSpinner label="Verificando sesión..." />;
  if (status === 'authenticated') return <Navigate to={postLoginPath(location.state)} replace />;
  return <Outlet />;
}

/** Muestra el contenido sólo con el permiso. El backend también lo valida siempre. */
export function RequirePermission({
  permission,
  children,
}: {
  permission: PermissionKey;
  children: ReactNode;
}) {
  const { can } = useAuth();
  return can(permission) ? <>{children}</> : <ForbiddenPage />;
}
