import { Building2, Pencil, Plus, Power } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../../api/client';
import { useBranchesAdmin, useSaveBranch, type BranchAdmin } from '../../api/settings';
import { useAuth } from '../../auth/useAuth';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { TextField } from '../../components/ui/FormField';
import { Modal } from '../../components/ui/Modal';
import { Spinner } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';

/** Sucursales: cada una lleva su propio inventario, ventas y compras. */
export function BranchesSection() {
  const { can } = useAuth();
  const toast = useToast();
  const branches = useBranchesAdmin();
  const save = useSaveBranch();
  const canManage = can('settings.manage');
  const [editing, setEditing] = useState<BranchAdmin | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [toggling, setToggling] = useState<BranchAdmin | null>(null);

  const toggle = async () => {
    if (!toggling) return;
    try {
      await save.mutateAsync({ id: toggling.id, input: { isActive: !toggling.isActive } });
      toast.success(toggling.isActive ? `${toggling.name} desactivada` : `${toggling.name} reactivada`);
      setToggling(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo cambiar la sucursal');
      setToggling(null);
    }
  };

  return (
    <Card className="xl:col-span-2">
      <CardHeader
        title="Sucursales"
        description="Cada sucursal tiene su propio inventario, ventas y compras. A los usuarios se les asignan desde Usuarios."
        actions={
          canManage && (
            <Button size="sm" icon={<Plus className="size-4" />} onClick={() => (setEditing(null), setFormOpen(true))}>
              Nueva sucursal
            </Button>
          )
        }
      />
      {branches.isPending ? (
        <div className="flex justify-center py-10 text-brand-600">
          <Spinner />
        </div>
      ) : branches.isError ? (
        <div className="p-5">
          <Alert tone="error">No se pudieron cargar las sucursales.</Alert>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {branches.data.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
              <span className="flex size-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                <Building2 className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
                  {b.name} <span className="font-mono text-xs text-slate-500">{b.code}</span>
                  {!b.isActive && <Badge tone="neutral">Inactiva</Badge>}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {[b.address, b.phone, `${b.users} ${b.users === 1 ? 'usuario' : 'usuarios'}`].filter(Boolean).join(' · ')}
                </p>
              </div>
              {canManage && (
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" icon={<Pencil className="size-4" />} onClick={() => (setEditing(b), setFormOpen(true))} aria-label={`Editar ${b.name}`}>
                    Editar
                  </Button>
                  <Button variant="ghost" size="sm" icon={<Power className="size-4" />} onClick={() => setToggling(b)} aria-label={`${b.isActive ? 'Desactivar' : 'Reactivar'} ${b.name}`}>
                    {b.isActive ? 'Desactivar' : 'Reactivar'}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <BranchFormDialog open={formOpen} branch={editing} onClose={() => setFormOpen(false)} />
      <ConfirmDialog
        open={toggling !== null}
        title={toggling?.isActive ? 'Desactivar sucursal' : 'Reactivar sucursal'}
        confirmLabel={toggling?.isActive ? 'Desactivar' : 'Reactivar'}
        tone={toggling?.isActive ? 'danger' : 'primary'}
        loading={save.isPending}
        onConfirm={toggle}
        onCancel={() => setToggling(null)}
      >
        {toggling?.isActive
          ? `${toggling.name} dejará de aparecer para operar. Su historial (ventas, compras, inventario) se conserva.`
          : `${toggling?.name ?? ''} volverá a estar disponible.`}
      </ConfirmDialog>
    </Card>
  );
}

const EMPTY = { code: '', name: '', address: '', phone: '', email: '' };

function BranchFormDialog({ open, branch, onClose }: { open: boolean; branch: BranchAdmin | null; onClose: () => void }) {
  const toast = useToast();
  const save = useSaveBranch();
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setValues(branch ? { code: branch.code, name: branch.name, address: branch.address ?? '', phone: branch.phone ?? '', email: branch.email ?? '' } : EMPTY);
    setErrors({});
    setFormError(null);
  }, [open, branch]);

  const field = (name: keyof typeof EMPTY) => ({
    value: values[name],
    error: errors[name],
    onChange: (e: { target: { value: string } }) => setValues((v) => ({ ...v, [name]: e.target.value })),
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!/^[A-Za-z0-9-]{2,20}$/.test(values.code.trim())) errs.code = 'Clave de 2 a 20 letras, números o guiones';
    if (values.name.trim().length < 2) errs.name = 'El nombre es obligatorio';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    try {
      const saved = await save.mutateAsync({
        id: branch?.id,
        input: {
          code: values.code.trim().toUpperCase(),
          name: values.name.trim(),
          address: values.address.trim() || null,
          phone: values.phone.trim() || null,
          email: values.email.trim() || null,
        },
      });
      toast.success(branch ? 'Sucursal actualizada' : `Sucursal ${saved.name} creada`);
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        const fields = err.fieldErrors();
        if (Object.keys(fields).length) setErrors(fields);
        else setFormError(err.message);
      } else setFormError('No se pudo guardar la sucursal.');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={save.isPending}
      title={branch ? 'Editar sucursal' : 'Nueva sucursal'}
      description={branch ? undefined : 'Quedarás asignado a ella para poder operarla.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancelar
          </Button>
          <Button type="submit" form="branch-form" loading={save.isPending}>
            {branch ? 'Guardar cambios' : 'Crear sucursal'}
          </Button>
        </>
      }
    >
      <form id="branch-form" onSubmit={submit} noValidate className="space-y-4">
        {formError && <Alert tone="error">{formError}</Alert>}
        <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
          <TextField label="Clave" placeholder="NORTE" autoComplete="off" {...field('code')} />
          <TextField label="Nombre" placeholder="Sucursal Norte" {...field('name')} />
        </div>
        <TextField label="Dirección (opcional)" {...field('address')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Teléfono (opcional)" type="tel" {...field('phone')} />
          <TextField label="Correo (opcional)" type="email" {...field('email')} />
        </div>
      </form>
    </Modal>
  );
}
