import { ALL_PERMISSIONS, SYSTEM_ROLES, type SystemRoleCode } from '@farmacia/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';
import { vi } from 'vitest';
import { setSession, type SessionUser } from '../api/client';
import { AuthProvider } from '../auth/AuthProvider';
import { ToastProvider } from '../components/ui/Toast';

export function sessionUser(roleCode: SystemRoleCode, overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: `user-${roleCode.toLowerCase()}`,
    email: `${roleCode.toLowerCase()}@test.local`,
    firstName: 'Prueba',
    lastName: roleCode,
    fullName: `Prueba ${roleCode}`,
    role: { code: roleCode, name: SYSTEM_ROLES[roleCode].name },
    permissions: roleCode === 'OWNER' ? [...ALL_PERMISSIONS] : [...SYSTEM_ROLES[roleCode].permissions],
    branches: [{ id: 'b1', code: 'MATRIZ', name: 'Matriz' }],
    defaultBranchId: 'b1',
    mustChangePassword: false,
    ...overrides,
  };
}

type Handler = (init: RequestInit & { url: string }) => unknown;

/**
 * Simula la API: cada ruta "MÉTODO /ruta" (sin query) devuelve un JSON.
 * Devuelve el mock para inspeccionar llamadas.
 */
export function mockApi(routes: Record<string, unknown | Handler>) {
  const fetchMock = vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = String(input).replace(/^\/api\/v1/, '');
    const key = `${init.method ?? 'GET'} ${url.split('?')[0]}`;
    if (!(key in routes)) {
      return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: `Sin mock: ${key}` } }), { status: 404 });
    }
    const route = routes[key];
    const body = typeof route === 'function' ? (route as Handler)({ ...init, url }) : route;
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export function renderApp(element: ReactElement, opts: { user: SessionUser; path?: string; routes?: RouteObject[] }) {
  const router = createMemoryRouter(opts.routes ?? [{ path: '*', element }], {
    initialEntries: [opts.path ?? '/'],
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>,
  );
  // El AuthProvider escucha los cambios de sesión una vez montado
  act(() => setSession({ accessToken: 'test-token', expiresIn: 900, user: opts.user }));
  return { ...result, router };
}
