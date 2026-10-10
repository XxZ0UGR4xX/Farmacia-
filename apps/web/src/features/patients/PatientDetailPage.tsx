import { ArrowLeft, FilePlus2, Lock, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { usePatient } from '../../api/patients';
import { useAuth } from '../../auth/useAuth';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { Spinner } from '../../components/ui/Spinner';
import { formatDate, formatDateTime, formatMoney } from '../../lib/format';
import { SaleStatusBadge } from '../sales/sales-display';
import { PatientFormDialog } from './PatientFormDialog';
import { AdministrativeNotice, patientAge } from './patient-display';
import { PrescriptionFormDialog } from './PrescriptionFormDialog';

export function PatientDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const patient = usePatient(id);
  const [editing, setEditing] = useState(false);
  const [prescribing, setPrescribing] = useState(false);

  if (patient.isPending) {
    return (
      <div className="flex justify-center py-16 text-brand-600">
        <Spinner />
      </div>
    );
  }
  if (patient.isError || !patient.data) return <Alert tone="error">El paciente no existe.</Alert>;
  const p = patient.data;

  return (
    <div>
      <ButtonLink to="/pacientes" variant="ghost" size="sm" className="-ml-2 mb-3" icon={<ArrowLeft className="size-4" />}>
        Pacientes
      </ButtonLink>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{p.fullName}</h1>
          <p className="text-sm text-slate-500">
            {patientAge(p.age)}
            {p.birthDate && ` · nació el ${formatDate(p.birthDate)}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can('patients.manage') && (
            <Button variant="secondary" onClick={() => setEditing(true)} icon={<Pencil className="size-4" />}>
              Editar datos
            </Button>
          )}
          {can('prescriptions.manage') && (
            <Button onClick={() => setPrescribing(true)} icon={<FilePlus2 className="size-4" />}>
              Registrar receta
            </Button>
          )}
        </div>
      </div>
      <p className="mb-4 flex items-center gap-2 text-xs text-slate-500">
        <Lock className="size-3.5" /> Expediente confidencial: tu consulta quedó registrada en la auditoría.
      </p>

      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        <Card className="h-fit p-5 text-sm">
          <h2 className="mb-3 font-semibold text-slate-900">Datos de contacto</h2>
          <dl className="space-y-2">
            {[
              ['Teléfono', p.phone],
              ['Correo', p.email],
              ['Dirección', p.address],
              ['Notas administrativas', p.notes],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-slate-500">{label}</dt>
                <dd className="whitespace-pre-line text-slate-900">{value || '—'}</dd>
              </div>
            ))}
            <div>
              <dt className="text-xs text-slate-500">Registrado</dt>
              <dd className="text-slate-900">{formatDateTime(p.createdAt)}</dd>
            </div>
          </dl>
        </Card>

        <div className="space-y-6">
          {can('prescriptions.view') && (
            <Card className="overflow-hidden">
              <CardHeader title="Recetas" description="Registro de lo indicado por el médico." />
              {p.prescriptions.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-500">Sin recetas registradas.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {p.prescriptions.map((r) => (
                    <li key={r.id}>
                      <Link to={`/pacientes/recetas/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm hover:bg-slate-50">
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900">
                            <span className="font-mono">{r.folio}</span> · {formatDate(r.issuedAt)}
                          </p>
                          <p className="text-xs text-slate-500">
                            {r.doctorName} · {r.medications.join(', ')}
                          </p>
                        </div>
                        <div className="flex gap-1">
                          {r.sales > 0 && <Badge tone="green">Surtida</Badge>}
                          {r.voided && <Badge>Anulada</Badge>}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
          {can('sales.view') && (
            <Card className="overflow-hidden">
              <CardHeader title="Compras" />
              {p.purchases.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-500">Sin compras ligadas a este paciente.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {p.purchases.map((s) => (
                    <li key={s.id}>
                      <Link to={`/ventas/historial/${s.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm hover:bg-slate-50">
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900">
                            <span className="font-mono">{s.folio}</span> · {formatDateTime(s.createdAt)}
                          </p>
                          <p className="text-xs text-slate-500">{s.products.join(', ')}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <SaleStatusBadge status={s.status} />
                          <span className="font-medium tabular-nums">{formatMoney(s.total)}</span>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
          <AdministrativeNotice />
        </div>
      </div>

      <PatientFormDialog open={editing} patient={p} onClose={() => setEditing(false)} onSaved={() => void patient.refetch()} />
      <PrescriptionFormDialog
        open={prescribing}
        patient={{ id: p.id, fullName: p.fullName, age: p.age, phone: null }}
        onClose={() => setPrescribing(false)}
        onCreated={(rx) => navigate(`/pacientes/recetas/${rx.id}`)}
      />
    </div>
  );
}
