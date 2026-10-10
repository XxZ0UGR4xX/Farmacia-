import { ArrowLeft, Ban, Printer } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError } from '../../api/client';
import { usePrescription, useVoidPrescription } from '../../api/patients';
import { useAuth } from '../../auth/useAuth';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { TextAreaField } from '../../components/ui/FormField';
import { Modal } from '../../components/ui/Modal';
import { Spinner } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { formatDate, formatDateTime, formatMoney } from '../../lib/format';
import { AdministrativeNotice } from './patient-display';

export function PrescriptionDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const rx = usePrescription(id);
  const voidRx = useVoidPrescription();
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (rx.isPending) {
    return (
      <div className="flex justify-center py-16 text-brand-600">
        <Spinner />
      </div>
    );
  }
  if (rx.isError || !rx.data) return <Alert tone="error">La receta no existe.</Alert>;
  const r = rx.data;
  const canVoid = can('prescriptions.void') && !r.voided && r.sales.length === 0;

  const submitVoid = async (e: FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 5) return setError('Explica el motivo (mínimo 5 caracteres)');
    try {
      await voidRx.mutateAsync({ id: r.id, reason: reason.trim() });
      toast.success(`Receta ${r.folio} anulada`);
      setVoiding(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo anular la receta.');
    }
  };

  return (
    <div className="print-page">
      <ButtonLink to="/pacientes/recetas" variant="ghost" size="sm" className="-ml-2 mb-3 print:hidden" icon={<ArrowLeft className="size-4" />}>
        Recetas
      </ButtonLink>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-mono text-2xl font-semibold tracking-tight text-slate-900">{r.folio}</h1>
            {r.voided ? <Badge>Anulada</Badge> : r.sales.length > 0 ? <Badge tone="green">Surtida</Badge> : <Badge tone="blue">Vigente</Badge>}
          </div>
          <p className="mt-1 text-sm text-slate-600">
            Paciente:{' '}
            <Link to={`/pacientes/${r.patient.id}`} className="font-medium text-slate-900 hover:text-brand-700">
              {r.patient.fullName}
            </Link>
          </p>
          <p className="text-sm text-slate-500">
            {formatDate(r.issuedAt)} · {r.doctorName}
            {r.doctorLicense && ` · Cédula ${r.doctorLicense}`}
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          <Button variant="secondary" onClick={() => window.print()} icon={<Printer className="size-4" />}>
            Imprimir
          </Button>
          {canVoid && (
            <Button variant="ghost" onClick={() => setVoiding(true)} icon={<Ban className="size-4" />}>
              Anular
            </Button>
          )}
        </div>
      </div>

      {r.voided && (
        <Alert tone="warning" className="mb-4">
          Anulada el {formatDateTime(r.voidedAt)} por {r.voidedBy}: {r.voidReason}
        </Alert>
      )}
      <AdministrativeNotice className="mb-4" />

      <Card className="mb-6 overflow-hidden">
        <CardHeader title="Medicamentos indicados" description="Transcripción de la receta del médico." />
        <ol className="divide-y divide-slate-100">
          {r.items.map((i, idx) => (
            <li key={i.id} className="px-5 py-3 text-sm">
              <p className="font-medium text-slate-900">
                {idx + 1}. {i.medicationName}
                {i.product && i.product.commercialName !== i.medicationName && <span className="font-normal text-slate-500"> (catálogo: {i.product.commercialName})</span>}
              </p>
              <p className="text-slate-600">{[i.dose, i.frequency, i.duration].filter(Boolean).join(' · ') || 'Sin dosis registrada'}</p>
              {i.instructions && <p className="text-slate-500">{i.instructions}</p>}
            </li>
          ))}
        </ol>
        {r.notes && <p className="border-t border-slate-100 px-5 py-3 text-sm text-slate-600">Notas: {r.notes}</p>}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader title="Ventas surtidas con esta receta" />
          {r.sales.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500">Todavía no se ha surtido.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {r.sales.map((s) => (
                <li key={s.id} className="flex justify-between px-5 py-3 text-sm">
                  <Link to={`/ventas/historial/${s.id}`} className="font-mono font-medium text-slate-900 hover:text-brand-700">
                    {s.folio}
                  </Link>
                  <span className="text-slate-500">
                    {formatDateTime(s.createdAt)} · {formatMoney(s.total)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-5 text-sm text-slate-600">
          <h2 className="mb-2 font-semibold text-slate-900">Registro</h2>
          <p>
            Registrada por <strong>{r.createdBy}</strong> el {formatDateTime(r.createdAt)}.
          </p>
          <p className="mt-2 text-xs text-slate-500">Una receta registrada no se modifica. Si tiene un error, quien tiene permiso la anula con un motivo y se registra una nueva.</p>
        </Card>
      </div>

      <Modal
        open={voiding}
        onClose={() => setVoiding(false)}
        busy={voidRx.isPending}
        size="sm"
        title={`Anular receta ${r.folio}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setVoiding(false)} disabled={voidRx.isPending}>
              Volver
            </Button>
            <Button variant="danger" type="submit" form="void-rx-form" loading={voidRx.isPending}>
              Anular receta
            </Button>
          </>
        }
      >
        <form id="void-rx-form" onSubmit={submitVoid} noValidate className="space-y-3 text-sm text-slate-600">
          <p>La receta quedará en el historial marcada como anulada. Esta acción no se puede deshacer.</p>
          <TextAreaField label="Motivo" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} error={error ?? undefined} />
        </form>
      </Modal>
    </div>
  );
}
