import { hasPermission, type PermissionKey } from '@farmacia/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  api,
  hasRefreshableSession,
  logoutRequest,
  onSessionChange,
  refreshSession,
  setSession,
  type SessionResponse,
  type SessionUser,
} from '../api/client';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export interface AuthContextValue {
  status: AuthStatus;
  user: SessionUser | null;
  login: (input: { email: string; password: string; rememberMe: boolean }) => Promise<SessionUser>;
  logout: () => Promise<void>;
  can: (permission: PermissionKey) => boolean;
  updateUser: (user: SessionUser) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>(() =>
    hasRefreshableSession() ? 'loading' : 'anonymous',
  );

  // Sincroniza el estado con renovaciones/expiraciones que ocurren dentro del cliente HTTP
  useEffect(
    () =>
      onSessionChange((session) => {
        if (session) {
          setUser(session.user);
          setStatus('authenticated');
        } else {
          setUser(null);
          setStatus('anonymous');
          queryClient.clear();
        }
      }),
    [queryClient],
  );

  // Restaurar la sesión al recargar la página (si existe la cookie de sesión)
  useEffect(() => {
    if (!hasRefreshableSession()) return;
    refreshSession().catch(() => setSession(null));
  }, []);

  const login = useCallback<AuthContextValue['login']>(async (input) => {
    const session = await api.post<SessionResponse>('/auth/login', input, { auth: false });
    setSession(session);
    return session.user;
  }, []);

  const logout = useCallback(() => logoutRequest(), []);

  const can = useCallback(
    (permission: PermissionKey) =>
      user ? hasPermission(user.role.code, user.permissions, permission) : false,
    [user],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, login, logout, can, updateUser: setUser }),
    [status, user, login, logout, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
