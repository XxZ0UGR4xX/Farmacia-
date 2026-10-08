import { hasPermission, type PermissionKey } from '@farmacia/shared';
import type { RequestHandler } from 'express';
import { logger } from '../lib/logger';
import { recordAudit } from '../modules/audit/audit.service';
import { AppError } from '../shared/errors';
import { clientInfo, requireAuth } from '../shared/request-context';

/**
 * Exige TODOS los permisos indicados. El propietario (OWNER) siempre pasa.
 * Debe ir después de `authenticate`.
 */
export function authorize(...required: PermissionKey[]): RequestHandler {
  return async (req, _res, next) => {
    const auth = requireAuth(req);
    const missing = required.filter((p) => !hasPermission(auth.roleCode, auth.permissions, p));
    if (missing.length === 0) return next();

    // Los intentos de acceso no autorizado quedan en auditoría
    await recordAudit({
      action: 'ACCESS_DENIED',
      userId: auth.userId,
      metadata: { method: req.method, path: req.originalUrl.split('?')[0] ?? '', missing },
      client: clientInfo(req),
    }).catch((err: unknown) => logger.error({ err }, 'No se pudo auditar el acceso denegado'));

    throw AppError.forbidden();
  };
}
