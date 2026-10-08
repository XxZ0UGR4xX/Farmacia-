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
