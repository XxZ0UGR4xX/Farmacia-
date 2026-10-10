import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setSession } from '../../api/client';
import type { PatientDetail, Prescription } from '../../api/patients';
import { mockApi, renderApp, sessionUser } from '../../test/render';
import { PatientDetailPage } from './PatientDetailPage';
import { PatientsPage } from './PatientsPage';
import { PrescriptionDetailPage } from './PrescriptionDetailPage';
import { PrescriptionFormDialog } from './PrescriptionFormDialog';

afterEach(() => {
  vi.unstubAllGlobals();
  setSession(null);
});

const page = (data: unknown[]) => ({ data, meta: { page: 1, pageSize: 25, total: data.length, totalPages: 1 } });

const detail: PatientDetail = {
  id: 'pa1',
  firstName: 'María Fernanda',
  lastName: 'Gómez Ficticio',
  fullName: 'María Fernanda Gómez Ficticio',
  birthDate: '1985-03-12',
  age: 41,
  phone: '55 0000 1000',
  email: 'paciente1@paciente-demo.local',
  address: null,
  notes: 'Paciente ficticio de demostración',
  createdAt: new Date().toISOString(),
  prescriptions: [{ id: 'rx1', folio: 'R-000001', doctorName: 'Dra. Laura Ejemplo', issuedAt: '2026-10-07', medications: ['Amoxicilina 500 mg'], sales: 1, voided: false }],
  purchases: [],
};

const prescription = (extra: Partial<Prescription> = {}): Prescription => ({
  id: 'rx1',
  folio: 'R-000001',
  patient: { id: 'pa1', fullName: 'María Fernanda Gómez Ficticio', birthDate: '1985-03-12' },
  doctorName: 'Dra. Laura Ejemplo',
  doctorLicense: '90012345',
  issuedAt: '2026-10-07',
  notes: null,
  items: [{ id: 'i1', product: null, productId: null, medicationName: 'Amoxicilina 500 mg', dose: '1 cápsula', frequency: 'cada 8 horas', duration: '7 días', instructions: null }],
  sales: [],
  createdBy: 'Carlos Ortega',
  createdAt: new Date().toISOString(),
  voided: false,
  voidedAt: null,
  voidedBy: null,
  voidReason: null,
  ...extra,
});

describe('PatientsPage', () => {
  it('lista con el teléfono enmascarado; la cajera consulta pero no da de alta', async () => {
    mockApi({ 'GET /patients': page([{ id: 'pa1', fullName: 'María Fernanda Gómez Ficticio', age: 41, phone: '•••• 1000', prescriptions: 1, purchases: 2, lastVisit: '2026-10-07' }]) });
    renderApp(<PatientsPage />, { user: sessionUser('CASHIER') });
    expect((await screen.findAllByText('María Fernanda Gómez Ficticio')).length).toBeGreaterThan(0);
    expect(screen.getByText('•••• 1000')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nuevo paciente' })).not.toBeInTheDocument();
    expect(screen.getByText(/no sugiere, calcula ni determina tratamientos/)).toBeInTheDocument();
  });
});

describe('PatientDetailPage', () => {
  const routes = [{ path: '/pacientes/:id', element: <PatientDetailPage /> }];

  it('el médico ve recetas y puede registrar una; se avisa que la consulta queda registrada', async () => {
    mockApi({ 'GET /patients/pa1': { patient: detail } });
    renderApp(<PatientDetailPage />, { user: sessionUser('DOCTOR'), path: '/pacientes/pa1', routes });
    expect(await screen.findByRole('heading', { name: 'María Fernanda Gómez Ficticio' })).toBeInTheDocument();
    expect(screen.getByText(/tu consulta quedó registrada/)).toBeInTheDocument();
    expect(screen.getByText(/R-000001/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Registrar receta' })).toBeInTheDocument();
  });

  it('sin permiso de recetas no se muestran', async () => {
    mockApi({ 'GET /patients/pa1': { patient: { ...detail, prescriptions: [] } } });
    renderApp(<PatientDetailPage />, { user: sessionUser('CASHIER'), path: '/pacientes/pa1', routes });
    expect(await screen.findByRole('heading', { name: 'María Fernanda Gómez Ficticio' })).toBeInTheDocument();
    expect(screen.queryByText('Recetas')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Registrar receta' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar datos' })).not.toBeInTheDocument();
  });
});

describe('PrescriptionFormDialog', () => {
  it('transcribe los medicamentos en orden y valida la cédula', async () => {
    const fetchMock = mockApi({ 'POST /prescriptions': { prescription: prescription() } });
    renderApp(<PrescriptionFormDialog open patient={{ id: 'pa1', fullName: 'María', age: 41, phone: null }} onClose={() => {}} />, { user: sessionUser('DOCTOR') });
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Médico que prescribe'), 'Dra. Laura Ejemplo');
    await userEvent.type(within(dialog).getByLabelText('Cédula profesional (opcional)'), '12');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Registrar receta' }));
    expect(within(dialog).getByText('La cédula tiene 7 u 8 dígitos')).toBeInTheDocument();
    expect(within(dialog).getByText('Escribe el medicamento como viene en la receta')).toBeInTheDocument();

    await userEvent.clear(within(dialog).getByLabelText('Cédula profesional (opcional)'));
    await userEvent.type(within(dialog).getByLabelText('Cédula profesional (opcional)'), '90012345');
    await userEvent.type(within(dialog).getByLabelText('Medicamento 1'), 'Amoxicilina 500 mg');
    await userEvent.type(within(dialog).getAllByLabelText('Dosis')[0]!, '1 cápsula');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Agregar medicamento' }));
    await userEvent.type(within(dialog).getByLabelText('Medicamento 2'), 'Paracetamol 500 mg');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Registrar receta' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(call && JSON.parse(call[1]!.body as string)).toMatchObject({
        patientId: 'pa1',
        doctorLicense: '90012345',
        items: [
          { medicationName: 'Amoxicilina 500 mg', dose: '1 cápsula', productId: null },
          { medicationName: 'Paracetamol 500 mg', dose: null },
        ],
      });
    });
  });
});

describe('PrescriptionDetailPage', () => {
  const routes = [{ path: '/pacientes/recetas/:id', element: <PrescriptionDetailPage /> }];

  it('sólo el administrador anula, con motivo, y no si ya se surtió', async () => {
    const fetchMock = mockApi({
      'GET /prescriptions/rx1': { prescription: prescription() },
      'POST /prescriptions/rx1/void': { prescription: prescription({ voided: true, voidReason: 'Error de captura' }) },
    });
    const { unmount } = renderApp(<PrescriptionDetailPage />, { user: sessionUser('ADMIN'), path: '/pacientes/recetas/rx1', routes });
    await userEvent.click(await screen.findByRole('button', { name: 'Anular' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anular receta' }));
    expect(within(dialog).getByText(/mínimo 5 caracteres/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Motivo'), 'Error de captura');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anular receta' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/void') && init?.method === 'POST')).toBe(true));
    unmount();
    setSession(null);

    mockApi({ 'GET /prescriptions/rx1': { prescription: prescription() } });
    const doctor = renderApp(<PrescriptionDetailPage />, { user: sessionUser('DOCTOR'), path: '/pacientes/recetas/rx1', routes });
    expect(await screen.findByText(/1\. Amoxicilina 500 mg/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Anular' })).not.toBeInTheDocument();
    doctor.unmount();
    setSession(null);

    mockApi({ 'GET /prescriptions/rx1': { prescription: prescription({ sales: [{ id: 's1', folio: 'V-000001', createdAt: new Date().toISOString(), total: 89, status: 'COMPLETED' }] }) } });
    renderApp(<PrescriptionDetailPage />, { user: sessionUser('OWNER'), path: '/pacientes/recetas/rx1', routes });
    expect(await screen.findByText('V-000001')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Anular' })).not.toBeInTheDocument();
  });
});
