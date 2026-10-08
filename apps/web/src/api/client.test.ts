import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, onSessionChange, setSession, type SessionResponse } from './client';

const session = (token: string): SessionResponse => ({
  accessToken: token,
  expiresIn: 900,
  user: {
    id: 'u1',
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
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const apiError = (status: number, code: string) => json(status, { error: { code, message: code } });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  document.cookie = 'csrf_token=csrf-abc';
  setSession(session('expired-token'));
});

afterEach(() => {
  vi.unstubAllGlobals();
  setSession(null);
});

function authHeader(call: unknown[]): string | undefined {
  return ((call[1] as RequestInit).headers as Record<string, string>).Authorization;
}

describe('cliente HTTP', () => {
  it('envía el access token y devuelve el JSON', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    await expect(api.get('/algo')).resolves.toEqual({ ok: true });
    expect(authHeader(fetchMock.mock.calls[0]!)).toBe('Bearer expired-token');
  });

  it('ante TOKEN_EXPIRED renueva la sesión con CSRF y reintenta', async () => {
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.endsWith('/auth/refresh')) {
        expect((init.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-abc');
        return json(200, session('new-token'));
      }
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === 'Bearer new-token' ? json(200, { ok: 1 }) : apiError(401, 'TOKEN_EXPIRED');
    });

    await expect(api.get('/datos')).resolves.toEqual({ ok: 1 });
    expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('peticiones simultáneas comparten una sola renovación', async () => {
    let refreshes = 0;
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.endsWith('/auth/refresh')) {
        refreshes++;
        await new Promise((r) => setTimeout(r, 10));
        return json(200, session('new-token'));
      }
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === 'Bearer new-token' ? json(200, { ok: 1 }) : apiError(401, 'TOKEN_EXPIRED');
    });

    await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')]);
    expect(refreshes).toBe(1);
  });

  it('reintenta la renovación ante una carrera entre pestañas (REFRESH_RACE)', async () => {
    let refreshes = 0;
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.endsWith('/auth/refresh')) {
        refreshes++;
        return refreshes === 1 ? apiError(401, 'REFRESH_RACE') : json(200, session('new-token'));
      }
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === 'Bearer new-token' ? json(200, { ok: 1 }) : apiError(401, 'TOKEN_EXPIRED');
    });

    await expect(api.get('/x')).resolves.toEqual({ ok: 1 });
    expect(refreshes).toBe(2);
  });

  it('si la renovación falla, cierra la sesión localmente', async () => {
    const listener = vi.fn();
    const unsubscribe = onSessionChange(listener);
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/auth/refresh') ? apiError(401, 'INVALID_TOKEN') : apiError(401, 'TOKEN_EXPIRED'),
    );

    await expect(api.get('/x')).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(listener).toHaveBeenLastCalledWith(null);
    unsubscribe();
  });

  it('no intenta renovar en endpoints públicos', async () => {
    fetchMock.mockResolvedValueOnce(apiError(401, 'INVALID_CREDENTIALS'));
    await expect(api.post('/auth/login', {}, { auth: false })).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('expone errores de validación por campo', async () => {
    fetchMock.mockResolvedValueOnce(
      json(400, {
        error: { code: 'VALIDATION_ERROR', message: 'x', details: [{ path: 'email', message: 'Inválido' }] },
      }),
    );
    const err = await api.post('/algo', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).fieldErrors()).toEqual({ email: 'Inválido' });
  });

  it('traduce fallas de red a un mensaje claro', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(api.get('/x')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});
