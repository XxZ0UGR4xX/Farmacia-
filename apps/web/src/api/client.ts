/**
 * Cliente HTTP de la API.
 *  - El access token vive SÓLO en memoria (no localStorage) para reducir el impacto de un XSS.
 *  - El refresh token viaja en una cookie httpOnly que JavaScript no puede leer.
 *  - Ante un 401 se renueva la sesión una sola vez (single-flight) y se reintenta la petición.
 */

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Errores de validación por campo: { email: 'mensaje' } */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    if (Array.isArray(this.details)) {
      for (const d of this.details as { path?: string; message?: string }[]) {
        if (d.path && d.message && !out[d.path]) out[d.path] = d.message;
      }
    }
    return out;
  }
}

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  role: { code: string; name: string };
  permissions: string[];
  branches: { id: string; code: string; name: string }[];
  defaultBranchId: string | null;
  mustChangePassword: boolean;
}

export interface SessionResponse {
  accessToken: string;
  expiresIn: number;
  user: SessionUser;
}

const API_BASE = '/api/v1';
const CSRF_COOKIE = 'csrf_token';

let accessToken: string | null = null;
let refreshInFlight: Promise<SessionResponse> | null = null;

type SessionListener = (session: SessionResponse | null) => void;
const listeners = new Set<SessionListener>();

/** Notifica cambios de sesión (renovación o expiración) al AuthProvider. */
export function onSessionChange(listener: SessionListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setSession(session: SessionResponse | null): void {
  accessToken = session?.accessToken ?? null;
  for (const l of listeners) l(session);
}

export function hasAccessToken(): boolean {
  return accessToken !== null;
}

export function readCookie(name: string): string | null {
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

/** Hay indicios de una sesión previa que se puede renovar. */
export function hasRefreshableSession(): boolean {
  return readCookie(CSRF_COOKIE) !== null;
}

async function toApiError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as ApiErrorBody;
    return new ApiError(res.status, body.error.code, body.error.message, body.error.details);
  } catch {
    return new ApiError(res.status, 'HTTP_ERROR', 'No se pudo conectar con el servidor');
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function doRefresh(): Promise<SessionResponse> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-CSRF-Token': readCookie(CSRF_COOKIE) ?? '' },
    });
    if (res.ok) {
      const session = (await res.json()) as SessionResponse;
      setSession(session);
      return session;
    }
    const error = await toApiError(res);
    // Otra pestaña renovó al mismo tiempo: reintentar con la cookie nueva
    if (error.code === 'REFRESH_RACE') {
      await sleep(150 * (attempt + 1));
      continue;
    }
    throw error;
  }
  throw new ApiError(401, 'INVALID_TOKEN', 'No se pudo renovar la sesión');
}

/** Renueva la sesión. Peticiones simultáneas comparten la misma renovación. */
export function refreshSession(): Promise<SessionResponse> {
  refreshInFlight ??= doRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

const RENEWABLE_CODES = new Set(['TOKEN_EXPIRED', 'INVALID_TOKEN', 'UNAUTHENTICATED']);

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** false para endpoints públicos (login, recuperación) */
  auth?: boolean;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, auth = true } = options;

  const send = () => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'include',
      signal,
    });
  };

  let res: Response;
  try {
    res = await send();
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK_ERROR', 'Sin conexión con el servidor. Revisa tu red.');
  }

  if (res.status === 401 && auth) {
    const error = await toApiError(res);
    if (!RENEWABLE_CODES.has(error.code)) throw error;
    try {
      await refreshSession();
    } catch {
      setSession(null); // La sesión terminó: el AuthProvider redirige al login
      throw new ApiError(401, 'SESSION_EXPIRED', 'Tu sesión expiró. Inicia sesión de nuevo.');
    }
    res = await send();
  }

  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...opts, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...opts, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...opts, method: 'PATCH', body }),
  delete: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...opts, method: 'DELETE' }),
};

/** Cierre de sesión (endpoint autenticado por cookie: requiere CSRF). */
export async function logoutRequest(): Promise<void> {
  try {
    await fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-CSRF-Token': readCookie(CSRF_COOKIE) ?? '' },
    });
  } finally {
    setSession(null);
  }
}
