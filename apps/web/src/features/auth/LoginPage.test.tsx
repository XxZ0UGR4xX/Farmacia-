import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setSession } from '../../api/client';
import { AuthProvider } from '../../auth/AuthProvider';
import { postLoginPath, PublicOnly } from '../../auth/guards';
import { LoginPage } from './LoginPage';

function renderLogin(from?: string) {
  const router = createMemoryRouter(
    [
      { element: <PublicOnly />, children: [{ path: '/iniciar-sesion', element: <LoginPage /> }] },
      { path: '/', element: <p>Inicio</p> },
      { path: '/inventario/productos', element: <p>Productos</p> },
    ],
    { initialEntries: [{ pathname: '/iniciar-sesion', state: from ? { from } : null }] },
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return router;
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setSession(null);
});

describe('LoginPage', () => {
  it('muestra los campos de la pantalla de acceso', () => {
    renderLogin();
    expect(screen.getByLabelText('Correo electrónico')).toBeInTheDocument();
    expect(screen.getByLabelText('Contraseña')).toBeInTheDocument();
    expect(screen.getByLabelText('Recordarme')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /olvidaste tu contraseña/i })).toBeInTheDocument();
  });

  it('valida antes de llamar a la API', async () => {
    renderLogin();
    await userEvent.click(screen.getByRole('button', { name: /entrar/i }));
    expect(await screen.findByText('Ingresa tu correo electrónico')).toBeInTheDocument();
    expect(screen.getByText('Ingresa tu contraseña')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('muestra el error del servidor ante credenciales incorrectas', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { code: 'INVALID_CREDENTIALS', message: 'Correo o contraseña incorrectos' } }),
        { status: 401 },
      ),
    );
    renderLogin();
    await userEvent.type(screen.getByLabelText('Correo electrónico'), 'doc@test.local');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'equivocada');
    await userEvent.click(screen.getByRole('button', { name: /entrar/i }));
    expect(await screen.findByText('Correo o contraseña incorrectos')).toBeInTheDocument();
  });

  it('inicia sesión con "Recordarme" y redirige al inicio', async () => {
    fetchMock.mockResolvedValueOnce(sessionResponse());
    const router = renderLogin();
    await userEvent.type(screen.getByLabelText('Correo electrónico'), 'doc@test.local');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'Correcta12345');
    await userEvent.click(screen.getByLabelText('Recordarme'));
    await userEvent.click(screen.getByRole('button', { name: /entrar/i }));

    expect(await screen.findByText('Inicio')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'doc@test.local',
      password: 'Correcta12345',
      rememberMe: true,
    });
  });

  it('tras iniciar sesión regresa a la página protegida que se intentó abrir', async () => {
    fetchMock.mockResolvedValueOnce(sessionResponse());
    const router = renderLogin('/inventario/productos');
    await userEvent.type(screen.getByLabelText('Correo electrónico'), 'doc@test.local');
    await userEvent.type(screen.getByLabelText('Contraseña'), 'Correcta12345');
    await userEvent.click(screen.getByRole('button', { name: /entrar/i }));

    expect(await screen.findByText('Productos')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/inventario/productos');
  });

  it('sólo redirige a rutas internas', () => {
    expect(postLoginPath({ from: '/ventas/historial' })).toBe('/ventas/historial');
    expect(postLoginPath({ from: '//sitio-malicioso.com' })).toBe('/');
    expect(postLoginPath({ from: 'https://sitio-malicioso.com' })).toBe('/');
    expect(postLoginPath({ from: '/iniciar-sesion' })).toBe('/');
    expect(postLoginPath(null)).toBe('/');
  });
});

function sessionResponse() {
  return new Response(
    JSON.stringify({
      accessToken: 't',
      expiresIn: 900,
      user: {
        id: 'u',
        email: 'doc@test.local',
        firstName: 'Doc',
        lastName: 'Tor',
        fullName: 'Doc Tor',
        role: { code: 'OWNER', name: 'Propietario' },
        permissions: [],
        branches: [],
        defaultBranchId: null,
        mustChangePassword: false,
      },
    }),
    { status: 200 },
  );
}
