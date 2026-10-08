import type { Request } from 'express';
import { AppError } from './errors';

export interface AuthContext {
  userId: string;
  sessionId: string;
  email: string;
  roleCode: string;
  permissions: ReadonlySet<string>;
  branchIds: readonly string[];
  defaultBranchId: string | null;
}

export interface ClientInfo {
  ipAddress: string | null;
  userAgent: string | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    id: string;
    auth?: AuthContext;
  }
}

export function clientInfo(req: Request): ClientInfo {
  return {
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent')?.slice(0, 512) ?? null,
  };
}

/** Obtiene el contexto autenticado (el middleware authenticate ya debió correr). */
export function requireAuth(req: Request): AuthContext {
  if (!req.auth) throw AppError.unauthenticated();
  return req.auth;
}

/**
 * Sucursal en la que opera la petición: header `X-Branch-Id` (validado contra las
 * sucursales del usuario) o, si no se envía, su sucursal predeterminada.
 */
export function currentBranchId(req: Request): string {
  const auth = requireAuth(req);
  const requested = req.get('x-branch-id');
  if (requested) {
    if (!auth.branchIds.includes(requested)) throw AppError.forbidden('No tienes acceso a esa sucursal');
    return requested;
  }
  const branchId = auth.defaultBranchId ?? auth.branchIds[0];
  if (!branchId) throw AppError.businessRule('Tu usuario no tiene una sucursal asignada');
  return branchId;
}
