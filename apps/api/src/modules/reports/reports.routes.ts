import { REPORT_KIND_LABELS } from '@farmacia/shared';
import { Router } from 'express';
import { buildXlsx } from '../../lib/xlsx';
import { todayISO } from '../../lib/dates';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { toCsv, sendCsv } from '../../shared/csv';
import { AppError } from '../../shared/errors';
import { clientInfo, currentBranchId, requireAuth } from '../../shared/request-context';
import { recordAudit } from '../audit/audit.service';
import { buildReportSheets } from './reports.export';
import { exportSchema, rangeSchema } from './reports.schemas';
import * as reports from './reports.service';

export function reportsRouter(): Router {
  const router = Router();
  router.use(authenticate);

  router.get('/dashboard', authorize('dashboard.view'), async (req, res) => {
    res.json(await reports.dashboard(requireAuth(req), currentBranchId(req)));
  });
  router.get('/sales', authorize('reports.view'), async (req, res) => {
    res.json(await reports.salesReport(requireAuth(req), currentBranchId(req), rangeSchema.parse(req.query)));
  });
  router.get('/products', authorize('reports.view'), async (req, res) => {
    res.json(await reports.productsReport(requireAuth(req), currentBranchId(req), rangeSchema.parse(req.query)));
  });
  router.get('/inventory', authorize('reports.view'), async (req, res) => {
    res.json(await reports.inventoryReport(requireAuth(req), currentBranchId(req)));
  });
  router.get('/shrinkage', authorize('reports.view'), async (req, res) => {
    res.json(await reports.shrinkageReport(requireAuth(req), currentBranchId(req), rangeSchema.parse(req.query)));
  });
  router.get('/purchases', authorize('reports.view', 'reports.financial'), async (req, res) => {
    res.json(await reports.purchasesReport(requireAuth(req), currentBranchId(req), rangeSchema.parse(req.query)));
  });

  // Exportación: Excel con todas las tablas del reporte, o CSV con la tabla principal
  router.get('/:report/export', authorize('reports.view', 'reports.export'), async (req, res) => {
    const auth = requireAuth(req);
    const branchId = currentBranchId(req);
    const { report, format } = exportSchema.parse({ ...req.query, report: req.params.report });
    const range = rangeSchema.parse(req.query);
    const sheets = await buildReportSheets(report, auth, branchId, range);
    if (!sheets.length) throw AppError.notFound('Reporte no disponible');

    await recordAudit({
      action: 'REPORT_EXPORT',
      userId: auth.userId,
      branchId,
      entityType: 'report',
      entityId: report,
      metadata: { report, format, ...(report === 'inventory' ? { date: todayISO() } : { from: range.from, to: range.to, groupBy: range.groupBy }), financial: reports.isFinancial(auth) },
      client: clientInfo(req),
    });

    const base = `${REPORT_KIND_LABELS[report].toLowerCase().replace(/\s+/g, '-')}_${report === 'inventory' ? todayISO() : `${range.from}_a_${range.to}`}`;
    if (format === 'csv') {
      const [main] = sheets;
      sendCsv(res, `${base}.csv`, toCsv(main!.columns.map((c) => c.header), main!.rows));
      return;
    }
    const filename = `${base}.xlsx`.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]/g, '_');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buildXlsx(sheets));
  });

  return router;
}
