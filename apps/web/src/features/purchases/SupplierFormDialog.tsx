import { RFC_REGEX } from '@farmacia/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../../api/client';
import { useSaveSupplier, type Supplier, type SupplierInput } from '../../api/purchases';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { TextAreaField, TextField } from '../../components/ui/FormField';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';

const FIELDS = ['tradeName', 'legalName', 'rfc', 'phone', 'email', 'address', 'contactName', 'paymentTerms', 'creditDays', 'notes'] as const;
type Values = Record<(typeof FIELDS)[number], string>;

function initialValues(s: Supplier | null): Values {
  return {
    tradeName: s?.tradeName ?? '',
    legalName: s?.legalName ?? '',
    rfc: s?.rfc ?? '',
    phone: s?.phone ?? '',
    email: s?.email ?? '',
    address: s?.address ?? '',
    contactName: s?.contactName ?? '',
    paymentTerms: s?.paymentTerms ?? '',
    creditDays: String(s?.creditDays ?? 0),
    notes: s?.notes ?? '',
  };
}

export function SupplierFormDialog({ open, supplier, onClose }: { open: boolean; supplier: Supplier | null; onClose: () => void }) {
  const toast = useToast();
  const save = useSaveSupplier();
  const [values, setValues] = useState<Values>(initialValues(null));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setValues(initialValues(supplier));
    setErrors({});
    setFormError(null);
  }, [open, supplier]);

  const field = (name: keyof Values) => ({
    value: values[name],
    error: errors[name],
    onChange: (e: { target: { value: string } }) => setValues((v) => ({ ...v, [name]: e.target.value })),
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (values.tradeName.trim().length < 2) errs.tradeName = 'El nombre comercial es obligatorio';
    if (values.rfc.trim() && !RFC_REGEX.test(values.rfc.trim().toUpperCase())) errs.rfc = 'RFC inválido (12 o 13 caracteres)';
    const days = Number(values.creditDays || 0);
    if (!Number.isInteger(days) || days < 0 || days > 365) errs.creditDays = 'De 0 a 365 días';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const input: Partial<SupplierInput> = {
      tradeName: values.tradeName.trim(),
      legalName: values.legalName.trim() || null,
      rfc: values.rfc.trim().toUpperCase() || null,
      phone: values.phone.trim() || null,
      email: values.email.trim() || null,
      address: values.address.trim() || null,
      contactName: values.contactName.trim() || null,
      paymentTerms: values.paymentTerms.trim() || null,
      creditDays: days,
      notes: values.notes.trim() || null,
    };
    try {
      const saved = await save.mutateAsync({ id: supplier?.id, input });
      toast.success(supplier ? 'Proveedor actualizado' : `Proveedor ${saved.tradeName} registrado`);
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        const fields = err.fieldErrors();
        if (Object.keys(fields).length) setErrors(fields);
        else setFormError(err.message);
      } else setFormError('No se pudo guardar el proveedor.');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={save.isPending}
      size="lg"
      title={supplier ? 'Editar proveedor' : 'Nuevo proveedor'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancelar
          </Button>
          <Button type="submit" form="supplier-form" loading={save.isPending}>
            {supplier ? 'Guardar cambios' : 'Registrar proveedor'}
          </Button>
        </>
      }
    >
      <form id="supplier-form" onSubmit={submit} noValidate className="space-y-4">
        {formError && <Alert tone="error">{formError}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Nombre comercial" className="sm:col-span-2" autoFocus {...field('tradeName')} />
          <TextField label="Razón social (opcional)" {...field('legalName')} />
          <TextField label="RFC (opcional)" autoComplete="off" {...field('rfc')} />
          <TextField label="Contacto (opcional)" {...field('contactName')} />
          <TextField label="Teléfono (opcional)" type="tel" {...field('phone')} />
          <TextField label="Correo (opcional)" type="email" {...field('email')} />
          <TextField
            label="Días de crédito"
            inputMode="numeric"
            hint="0 = de contado. Se usa para calcular el vencimiento de las compras a crédito."
            {...field('creditDays')}
          />
          <TextField label="Condiciones de pago (opcional)" placeholder="Ej. 30 días fecha factura" {...field('paymentTerms')} />
          <TextField label="Dirección (opcional)" className="sm:col-span-2" {...field('address')} />
        </div>
        <TextAreaField label="Notas (opcional)" rows={2} {...field('notes')} />
      </form>
    </Modal>
  );
}
