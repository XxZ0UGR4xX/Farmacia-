import type { AuditAction } from '@farmacia/shared';
import type { Prisma } from '../../generated/prisma/client';
import { prisma, type DbClient } from '../../lib/prisma';
import type { ClientInfo } from '../../shared/request-context';

export interface AuditEntry {
  action: AuditAction;
  userId?: string | null;
  branchId?: string | null;
  entityType?: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
  client?: ClientInfo;
}

/**
 * Registra un evento de auditoría. Pasar `db` (cliente de transacción) para que
 * el registro se confirme o revierta junto con la operación auditada.
 */
export async function recordAudit(entry: AuditEntry, db: DbClient = prisma): Promise<void> {
  await db.auditLog.create({
    data: {
      action: entry.action,
      userId: entry.userId ?? null,
      branchId: entry.branchId ?? null,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      metadata: entry.metadata,
      ipAddress: entry.client?.ipAddress ?? null,
      userAgent: entry.client?.userAgent ?? null,
    },
  });
}
