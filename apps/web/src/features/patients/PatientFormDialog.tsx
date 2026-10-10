import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../../api/client';
import { useSavePatient, type PatientDetail, type PatientInput, type PatientSummary } from '../../api/patients';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { TextAreaField, TextField } from '../../components/ui/FormField';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { useToday } from '../../lib/useToday';

const EMPTY = { firstName: '', lastName: '', birthDate: '', phone: '', email: '', address: '', notes: '' };

export function PatientFormDialog({
  open,
  patient,
  onClose,
  onSaved,
}: {
  open: boolean;
  patient: PatientDetail | null;
  onClose: () => void;
  onSaved?: (p: PatientSummary) => void;
}) {
  const toast = useToast();
  const save = useSavePatient();
  const today = useToday();
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setValues(
      patient
        ? {
            firstName: patient.firstName,
            lastName: patient.lastName,
            birthDate: patient.birthDate ?? '',
            phone: patient.phone ?? '',
            email: patient.email ?? '',
            address: patient.address ?? '',
            notes: patient.notes ?? '',
          }
        : EMPTY,
    );
    setErrors({});
    setFormError(null);
  }, [open, patient]);

  const field = (name: keyof typeof EMPTY) => ({
    value: values[name],
    error: errors[name],
    onChange: (e: { target: { value: string } }) => setValues((v) => ({ ...v, [name]: e.target.value })),
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!values.firstName.trim()) errs.firstName = 'El nombre es obligatorio';
    if (!values.lastName.trim()) errs.lastName = 'El apellido es obligatorio';
    if (values.birthDate && values.birthDate > today) errs.birthDate = 'La fecha no puede ser futura';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const input: PatientInput = {
      firstName: values.firstName.trim(),
      lastName: values.lastName.trim(),
      birthDate: values.birthDate || null,
      phone: values.phone.trim() || null,
      email: values.email.trim() || null,
      address: values.address.trim() || null,
      notes: values.notes.trim() || null,
    };
    try {
      const saved = await save.mutateAsync({ id: patient?.id, input });
      toast.success(patient ? 'Datos del paciente actualizados' : `Paciente ${saved.fullName} registrado`);
      onSaved?.(saved);
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        const fields = err.fieldErrors();
        if (Object.keys(fields).length) setErrors(fields);
        else setFormError(err.message);
      } else setFormError('No se pudo guardar el paciente.');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={save.isPending}
      size="lg"
      title={patient ? 'Editar datos del paciente' : 'Nuevo paciente'}
      description="Información personal protegida: registra sólo lo necesario para atenderlo."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancelar
          </Button>
          <Button type="submit" form="patient-form" loading={save.isPending}>
            {patient ? 'Guardar cambios' : 'Registrar paciente'}
          </Button>
        </>
      }
    >
      <form id="patient-form" onSubmit={submit} noValidate className="space-y-4">
        {formError && <Alert tone="error">{formError}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Nombre(s)" autoFocus autoComplete="off" {...field('firstName')} />
          <TextField label="Apellidos" autoComplete="off" {...field('lastName')} />
          <TextField label="Fecha de nacimiento (opcional)" type="date" max={today} {...field('birthDate')} />
          <TextField label="Teléfono (opcional)" type="tel" autoComplete="off" {...field('phone')} />
          <TextField label="Correo (opcional)" type="email" autoComplete="off" {...field('email')} />
          <TextField label="Dirección (opcional)" autoComplete="off" {...field('address')} />
        </div>
        <TextAreaField label="Notas administrativas (opcional)" rows={2} hint="Contacto o preferencias. No registres diagnósticos aquí." {...field('notes')} />
      </form>
    </Modal>
  );
}
