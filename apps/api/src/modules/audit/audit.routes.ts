import { Router } from 'express';
import { todayISO } from '../../lib/dates';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { sendCsv, toCsv } from '../../shared/csv';
import { clientInfo, requireAuth } from '../../shared/request-context';
import { AUDIT_EXPORT_HEADERS, AUDIT_EXPORT_LIMIT, auditExportRows, auditUsers, listAudit, listAuditSchema } from './audit.query';
import { recordAudit } from './audit.service';

export function auditRouter(): Router {
  const router = Router();
  router.use(authenticate, authorize('audit.view'));

  router.get('/', async (req, res) => {
    res.json(await listAudit(listAuditSchema.parse(req.query)));
  });
  router.get('/users', async (_req, res) => {
    res.json({ users: await auditUsers() });
  });
  // Exportar la bitácora también queda registrado
  router.get('/export', async (req, res) => {
    const auth = requireAuth(req);
    const query = listAuditSchema.parse(req.query);
    const rows = await auditExportRows(query);
    const { page: _p, pageSize: _s, ...filters } = query;
    await recordAudit({
      action: 'AUDIT_EXPORT',
      userId: auth.userId,
      entityType: 'audit',
      metadata: { filters, rows: rows.length, truncated: rows.length >= AUDIT_EXPORT_LIMIT },
      client: clientInfo(req),
    });
    sendCsv(res, `auditoria_${query.from ?? 'inicio'}_a_${query.to ?? todayISO()}.csv`, toCsv(AUDIT_EXPORT_HEADERS, rows));
  });

  return router;
}
