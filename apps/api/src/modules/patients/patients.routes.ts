import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { uuidParam } from '../../shared/params';
import { clientInfo, currentBranchId, requireAuth } from '../../shared/request-context';
import { listPatientsSchema, listPrescriptionsSchema, patientSchema, prescriptionSchema, voidPrescriptionSchema } from './patients.schemas';
import * as patients from './patients.service';
import * as prescriptions from './prescriptions.service';

export function patientsRouter(): Router {
  const router = Router();
  router.use(authenticate);

  router.get('/', authorize('patients.view'), async (req, res) => {
    res.json(await patients.listPatients(listPatientsSchema.parse(req.query)));
  });
  // Selector rápido (punto de venta, recetas)
  router.get('/search', authorize('patients.view'), async (req, res) => {
    const { q } = z.object({ q: z.string().max(100).default('') }).parse(req.query);
    res.json({ items: await patients.searchPatients(q) });
  });
  router.get('/:id', authorize('patients.view'), async (req, res) => {
    res.json({ patient: await patients.getPatient(requireAuth(req), currentBranchId(req), uuidParam(req), clientInfo(req)) });
  });
  router.post('/', authorize('patients.manage'), async (req, res) => {
    const dto = patientSchema.parse(req.body);
    res.status(201).json({ patient: await patients.createPatient(requireAuth(req), currentBranchId(req), dto, clientInfo(req)) });
  });
  router.patch('/:id', authorize('patients.manage'), async (req, res) => {
    const id = uuidParam(req);
    const dto = patientSchema.partial().parse(req.body);
    res.json({ patient: await patients.updatePatient(requireAuth(req), currentBranchId(req), id, dto, clientInfo(req)) });
  });

  return router;
}

export function prescriptionsRouter(): Router {
  const router = Router();
  router.use(authenticate);

  router.get('/', authorize('prescriptions.view'), async (req, res) => {
    res.json(await prescriptions.listPrescriptions(listPrescriptionsSchema.parse(req.query)));
  });
  router.get('/:id', authorize('prescriptions.view'), async (req, res) => {
    res.json({ prescription: await prescriptions.getPrescription(requireAuth(req), currentBranchId(req), uuidParam(req), clientInfo(req)) });
  });
  router.post('/', authorize('prescriptions.manage'), async (req, res) => {
    const dto = prescriptionSchema.parse(req.body);
    res.status(201).json({ prescription: await prescriptions.createPrescription(requireAuth(req), currentBranchId(req), dto, clientInfo(req)) });
  });
  // No hay edición ni borrado: sólo anulación con motivo
  router.post('/:id/void', authorize('prescriptions.void'), async (req, res) => {
    const id = uuidParam(req);
    const { reason } = voidPrescriptionSchema.parse(req.body);
    res.json({ prescription: await prescriptions.voidPrescription(requireAuth(req), currentBranchId(req), id, reason, clientInfo(req)) });
  });

  return router;
}
