import { LICENSE_REGEX } from '@farmacia/shared';
import { clsx } from 'clsx';
import { AlertTriangle, FileText } from 'lucide-react';
import { usePrescriptions, type PatientSummary } from '../../api/patients';
import type { CreateSaleInput } from '../../api/sales';
import { useAuth } from '../../auth/useAuth';
import { Alert } from '../../components/ui/Alert';
import { Checkbox, TextField } from '../../components/ui/FormField';
import { formatDate } from '../../lib/format';
import { useToday } from '../../lib/useToday';
import { PatientPicker } from '../patients/PatientPicker';

export interface RxState {
  patient: PatientSummary | null;
  /** '' = sin elegir, 'NEW' = registrar ahora, o el id de una receta registrada */
  choice: string;
  doctorName: string;
  doctorLicense: string;
  issuedAt: string;
  /** Para productos que sólo requieren receta (no la retienen) */
  checked: boolean;
}

export const EMPTY_RX: RxState = { patient: null, choice: '', doctorName: '', doctorLicense: '', issuedAt: '', checked: false };

/** ¿Se puede cobrar con lo capturado sobre la receta? */
export function rxReady(rx: RxState, needsRetention: boolean, needsPrescription: boolean): boolean {
  if (needsRetention) {
    if (!rx.patient || !rx.choice) return false;
    if (rx.choice === 'NEW') return rx.doctorName.trim().length >= 3 && (!rx.doctorLicense.trim() || LICENSE_REGEX.test(rx.doctorLicense.trim()));
    return true;
  }
  return !needsPrescription || rx.checked;
}

/** Datos de paciente y receta para el cobro. */
export function rxPayload(rx: RxState, needsRetention: boolean, today: string): Pick<CreateSaleInput, 'patientId' | 'prescriptionId' | 'prescription' | 'prescriptionChecked'> {
  const linked = needsRetention && rx.choice && rx.choice !== 'NEW' ? rx.choice : undefined;
  const create = needsRetention && rx.choice === 'NEW';
  return {
    patientId: rx.patient?.id,
    prescriptionId: linked,
    prescription: create ? { doctorName: rx.doctorName.trim(), doctorLicense: rx.doctorLicense.trim() || null, issuedAt: rx.issuedAt || today, notes: null } : undefined,
    prescriptionChecked: rx.checked || Boolean(linked || create),
  };
}

export function PrescriptionPanel({
  value,
  onChange,
  needsRetention,
  needsPrescription,
}: {
  value: RxState;
  onChange: (rx: RxState) => void;
  needsRetention: boolean;
  needsPrescription: boolean;
}) {
  const { can } = useAuth();
  const today = useToday();
  const canSee = can('prescriptions.view');
  const canCreate = can('prescriptions.manage');
  const recent = usePrescriptions({ patientId: value.patient?.id, page: 1, pageSize: 5 }, Boolean(needsRetention && value.patient && canSee));
  const set = (patch: Partial<RxState>) => onChange({ ...value, ...patch });
  // Una receta que se retiene sólo se surte una vez: se ofrecen las que no tienen ventas
  const available = recent.data?.data.filter((r) => r.sales === 0) ?? [];

  if (!needsRetention && !needsPrescription) return null;

  if (!needsRetention) {
    return (
      <div className="rounded-lg bg-amber-50 p-3 ring-1 ring-amber-200">
        <p className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-900">
          <AlertTriangle className="size-4" /> Esta venta incluye productos con receta médica
        </p>
        <Checkbox label="Revisé la receta médica del paciente" checked={value.checked} onChange={(e) => set({ checked: e.target.checked })} />
      </div>
    );
  }

  if (!canSee && !canCreate) {
    return (
      <Alert tone="warning" title="Producto que retiene receta">
        Esta venta incluye antibióticos o medicamentos controlados. Pide a quien registra recetas (farmacéutico) que complete la venta.
      </Alert>
    );
  }

  return (
    <div className="space-y-3 rounded-lg bg-amber-50 p-3 ring-1 ring-amber-200" data-testid="rx-panel">
      <p className="flex items-center gap-2 text-sm font-medium text-amber-900">
        <FileText className="size-4" /> Retiene receta: liga la receta del paciente
      </p>
      <PatientPicker value={value.patient} onChange={(patient) => onChange({ ...value, patient, choice: '' })} />
      {value.patient && (
        <div className="space-y-2" role="radiogroup" aria-label="Receta">
          {canSee &&
            available.map((r) => (
              <label key={r.id} className={clsx('flex cursor-pointer items-start gap-2 rounded-lg bg-white p-2 text-sm ring-1 ring-inset', value.choice === r.id ? 'ring-brand-500' : 'ring-slate-200')}>
                <input type="radio" name="rx" className="mt-1 accent-brand-600" checked={value.choice === r.id} onChange={() => set({ choice: r.id })} />
                <span>
                  <span className="font-mono font-medium">{r.folio}</span> · {formatDate(r.issuedAt)} · {r.doctorName}
                  <span className="block text-xs text-slate-500">{r.medications.join(', ')}</span>
                </span>
              </label>
            ))}
          {canSee && recent.data && available.length === 0 && <p className="text-xs text-slate-600">El paciente no tiene recetas vigentes sin surtir.</p>}
          {canCreate && (
            <label className={clsx('flex cursor-pointer items-center gap-2 rounded-lg bg-white p-2 text-sm ring-1 ring-inset', value.choice === 'NEW' ? 'ring-brand-500' : 'ring-slate-200')}>
              <input type="radio" name="rx" className="accent-brand-600" checked={value.choice === 'NEW'} onChange={() => set({ choice: 'NEW' })} />
              Registrar la receta que trae el paciente
            </label>
          )}
          {value.choice === 'NEW' && (
            <div className="grid gap-2 rounded-lg bg-white p-2 ring-1 ring-inset ring-slate-200">
              <TextField label="Médico que prescribe" value={value.doctorName} onChange={(e) => set({ doctorName: e.target.value })} />
              <div className="grid grid-cols-2 gap-2">
                <TextField
                  label="Cédula (opcional)"
                  inputMode="numeric"
                  value={value.doctorLicense}
                  onChange={(e) => set({ doctorLicense: e.target.value })}
                  error={value.doctorLicense.trim() && !LICENSE_REGEX.test(value.doctorLicense.trim()) ? '7 u 8 dígitos' : undefined}
                />
                <TextField label="Fecha" type="date" max={today} value={value.issuedAt || today} onChange={(e) => set({ issuedAt: e.target.value })} />
              </div>
              <p className="text-xs text-slate-500">Se registran los medicamentos con receta de esta venta. Sólo se transcribe; no se indica tratamiento.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
