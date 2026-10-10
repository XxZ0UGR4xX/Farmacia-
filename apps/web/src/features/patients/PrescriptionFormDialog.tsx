import { LICENSE_REGEX } from '@farmacia/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../../api/client';
import { useCreatePrescription, type Prescription, type PatientSummary } from '../../api/patients';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { TextAreaField, TextField } from '../../components/ui/FormField';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { useToday } from '../../lib/useToday';
import { ProductPicker } from '../products/ProductPicker';
import { AdministrativeNotice } from './patient-display';
import { PatientPicker } from './PatientPicker';

interface ItemDraft {
  key: number;
  productId: string | null;
  medicationName: string;
  dose: string;
  frequency: string;
  duration: string;
  instructions: string;
}

let seq = 0;
const emptyItem = (): ItemDraft => ({ key: ++seq, productId: null, medicationName: '', dose: '', frequency: '', duration: '', instructions: '' });

/**
 * Registro de una receta: se transcribe lo que escribió el médico, renglón por renglón.
 * No hay sugerencias de dosis ni de medicamentos.
 */
export function PrescriptionFormDialog({
  open,
  patient: fixedPatient,
  onClose,
  onCreated,
}: {
  open: boolean;
  patient: PatientSummary | null;
  onClose: () => void;
  onCreated?: (rx: Prescription) => void;
}) {
  const toast = useToast();
  const create = useCreatePrescription();
  const today = useToday();
  const [patient, setPatient] = useState<PatientSummary | null>(fixedPatient);
  const [doctorName, setDoctorName] = useState('');
  const [doctorLicense, setDoctorLicense] = useState('');
  const [issuedAt, setIssuedAt] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<ItemDraft[]>([emptyItem()]);
  const [linking, setLinking] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPatient(fixedPatient);
    setDoctorName('');
    setDoctorLicense('');
    setIssuedAt('');
    setNotes('');
    setItems([emptyItem()]);
    setLinking(null);
    setErrors({});
    setFormError(null);
  }, [open, fixedPatient]);

  const date = issuedAt || today;
  const update = (key: number, patch: Partial<ItemDraft>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!patient) errs.patientId = 'Selecciona al paciente';
    if (doctorName.trim().length < 3) errs.doctorName = 'Indica el nombre del médico';
    if (doctorLicense.trim() && !LICENSE_REGEX.test(doctorLicense.trim())) errs.doctorLicense = 'La cédula tiene 7 u 8 dígitos';
    if (date > today) errs.issuedAt = 'La fecha no puede ser futura';
    items.forEach((it, i) => {
      if (it.medicationName.trim().length < 2) errs[`items.${i}.medicationName`] = 'Escribe el medicamento como viene en la receta';
    });
    setErrors(errs);
    if (Object.keys(errs).length || !patient) return;
    try {
      const rx = await create.mutateAsync({
        patientId: patient.id,
        doctorName: doctorName.trim(),
        doctorLicense: doctorLicense.trim() || null,
        issuedAt: date,
        notes: notes.trim() || null,
        items: items.map((it) => ({
          productId: it.productId,
          medicationName: it.medicationName.trim(),
          dose: it.dose.trim() || null,
          frequency: it.frequency.trim() || null,
          duration: it.duration.trim() || null,
          instructions: it.instructions.trim() || null,
        })),
      });
      toast.success(`Receta ${rx.folio} registrada`);
      onCreated?.(rx);
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        const fields = err.fieldErrors();
        if (Object.keys(fields).length) setErrors(fields);
        else setFormError(err.message);
      } else setFormError('No se pudo registrar la receta.');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={create.isPending}
      size="lg"
      title="Registrar receta"
      description="Transcribe la receta tal como la escribió el médico. Una vez registrada no se puede modificar."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
            Cancelar
          </Button>
          <Button type="submit" form="prescription-form" loading={create.isPending}>
            Registrar receta
          </Button>
        </>
      }
    >
      <form id="prescription-form" onSubmit={submit} noValidate className="space-y-4">
        <AdministrativeNotice />
        {formError && <Alert tone="error">{formError}</Alert>}
        {!fixedPatient && <PatientPicker value={patient} onChange={setPatient} />}
        {errors.patientId && <p className="text-sm text-red-600">{errors.patientId}</p>}
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="Médico que prescribe" className="sm:col-span-2" autoComplete="off" value={doctorName} onChange={(e) => setDoctorName(e.target.value)} error={errors.doctorName} />
          <TextField label="Cédula profesional (opcional)" inputMode="numeric" autoComplete="off" value={doctorLicense} onChange={(e) => setDoctorLicense(e.target.value)} error={errors.doctorLicense} />
          <TextField label="Fecha de la receta" type="date" max={today} value={date} onChange={(e) => setIssuedAt(e.target.value)} error={errors.issuedAt} />
        </div>

        <div className="space-y-3">
          <p className="text-sm font-medium text-slate-700">Medicamentos indicados</p>
          {items.map((it, i) => (
            <div key={it.key} className="space-y-3 rounded-lg border border-slate-200 p-3" data-testid="rx-item">
              <div className="flex items-end gap-2">
                <TextField
                  className="flex-1"
                  label={`Medicamento ${i + 1}`}
                  placeholder="Como viene escrito en la receta"
                  autoComplete="off"
                  value={it.medicationName}
                  onChange={(e) => update(it.key, { medicationName: e.target.value, productId: null })}
                  error={errors[`items.${i}.medicationName`]}
                />
                <Button variant="ghost" size="sm" onClick={() => setLinking(linking === it.key ? null : it.key)}>
                  {it.productId ? 'Vinculado ✓' : 'Vincular al catálogo'}
                </Button>
                {items.length > 1 && (
                  <Button variant="ghost" size="sm" aria-label={`Quitar medicamento ${i + 1}`} onClick={() => setItems((list) => list.filter((x) => x.key !== it.key))} icon={<Trash2 className="size-4" />} />
                )}
              </div>
              {linking === it.key && (
                <ProductPicker
                  label="Producto del catálogo (opcional)"
                  onSelect={(p) => {
                    update(it.key, { productId: p.id, medicationName: it.medicationName || p.commercialName });
                    setLinking(null);
                  }}
                />
              )}
              <div className="grid gap-3 sm:grid-cols-3">
                <TextField label="Dosis" placeholder="Ej. 1 tableta" value={it.dose} onChange={(e) => update(it.key, { dose: e.target.value })} />
                <TextField label="Frecuencia" placeholder="Ej. cada 8 horas" value={it.frequency} onChange={(e) => update(it.key, { frequency: e.target.value })} />
                <TextField label="Duración" placeholder="Ej. 7 días" value={it.duration} onChange={(e) => update(it.key, { duration: e.target.value })} />
              </div>
              <TextField label="Indicaciones (opcional)" value={it.instructions} onChange={(e) => update(it.key, { instructions: e.target.value })} />
            </div>
          ))}
          {items.length < 20 && (
            <Button variant="secondary" size="sm" onClick={() => setItems((list) => [...list, emptyItem()])} icon={<Plus className="size-4" />}>
              Agregar medicamento
            </Button>
          )}
        </div>
        <TextAreaField label="Notas (opcional)" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </form>
    </Modal>
  );
}
