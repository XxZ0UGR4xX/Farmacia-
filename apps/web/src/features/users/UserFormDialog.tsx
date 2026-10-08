import { canGrantRole, passwordPolicyErrors } from '@farmacia/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  useCreateUser,
  useUpdateUser,
  type AdminUser,
  type Branch,
  type Role,
  type UserInput,
} from '../../api/admin';
import { ApiError } from '../../api/client';
import { useAuth } from '../../auth/useAuth';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Checkbox, PasswordField, TextField } from '../../components/ui/FormField';
import { Modal } from '../../components/ui/Modal';
import { SelectField } from '../../components/ui/SelectField';
import { PASSWORD_HINT } from '../auth/password-schema';

const optional = z.string().trim().max(80);

const schema = z
  .object({
    email: z.string().trim().min(1, 'El correo es obligatorio').pipe(z.email('Correo electrónico inválido')),
    firstName: z.string().trim().min(1, 'El nombre es obligatorio').max(80),
    lastName: z.string().trim().min(1, 'El apellido es obligatorio').max(80),
    phone: optional,
    professionalLicense: optional,
    roleId: z.string().min(1, 'Selecciona un rol'),
    branchIds: z.array(z.string()).min(1, 'Asigna al menos una sucursal'),
    defaultBranchId: z.string(),
    passwordMode: z.enum(['auto', 'manual']),
    temporaryPassword: z.string(),
  })
  .superRefine((d, ctx) => {
    if (d.passwordMode === 'manual') {
      const [first] = passwordPolicyErrors(d.temporaryPassword);
      if (first) ctx.addIssue({ code: 'custom', path: ['temporaryPassword'], message: first });
    }
    if (d.defaultBranchId && !d.branchIds.includes(d.defaultBranchId)) {
      ctx.addIssue({ code: 'custom', path: ['defaultBranchId'], message: 'Debe ser una de las sucursales asignadas' });
    }
  });
type FormValues = z.infer<typeof schema>;

export interface CreatedUserResult {
  user: AdminUser;
  temporaryPassword: string;
}

export function UserFormDialog({
  open,
  user,
  roles,
  branches,
  onClose,
  onCreated,
  onUpdated,
}: {
  open: boolean;
  /** Si se pasa, el diálogo edita a este usuario */
  user: AdminUser | null;
  roles: Role[];
  branches: Branch[];
  onClose: () => void;
  onCreated: (result: CreatedUserResult) => void;
  onUpdated: (user: AdminUser) => void;
}) {
  const { user: actor } = useAuth();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const [formError, setFormError] = useState<string | null>(null);
  const isEdit = user !== null;
  const isSelf = isEdit && actor?.id === user.id;

  // Sólo se ofrecen los roles que el usuario actual puede otorgar
  const grantableRoles = useMemo(
    () => (actor ? roles.filter((r) => canGrantRole(actor.role.code, actor.permissions, r)) : []),
    [actor, roles],
  );

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    const singleBranch = branches.length === 1 ? [branches[0]!.id] : [];
    reset({
      email: user?.email ?? '',
      firstName: user?.firstName ?? '',
      lastName: user?.lastName ?? '',
      phone: user?.phone ?? '',
      professionalLicense: user?.professionalLicense ?? '',
      roleId: user?.role.id ?? '',
      branchIds: user ? user.branches.map((b) => b.id) : singleBranch,
      defaultBranchId: user?.defaultBranchId ?? singleBranch[0] ?? '',
      passwordMode: 'auto',
      temporaryPassword: '',
    });
  }, [open, user, branches, reset]);

  const branchIds = watch('branchIds') ?? [];
  const defaultBranchId = watch('defaultBranchId');
  const passwordMode = watch('passwordMode');

  // Mantener la sucursal predeterminada coherente con las asignadas
  useEffect(() => {
    if (branchIds.length && !branchIds.includes(defaultBranchId)) setValue('defaultBranchId', branchIds[0]!);
  }, [branchIds, defaultBranchId, setValue]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const input: UserInput = {
      email: values.email,
      firstName: values.firstName,
      lastName: values.lastName,
      phone: values.phone || null,
      professionalLicense: values.professionalLicense || null,
      roleId: values.roleId,
      branchIds: values.branchIds,
      defaultBranchId: values.defaultBranchId || null,
    };
    try {
      if (isEdit) {
        const { roleId, ...rest } = input;
        onUpdated(await updateUser.mutateAsync({ id: user.id, input: isSelf ? rest : { ...rest, roleId } }));
      } else {
        if (values.passwordMode === 'manual') input.temporaryPassword = values.temporaryPassword;
        onCreated(await createUser.mutateAsync(input));
      }
    } catch (err) {
      if (err instanceof ApiError) {
        const fields = err.fieldErrors();
        let mapped = false;
        for (const [path, message] of Object.entries(fields)) {
          if (path in values) {
            setError(path as keyof FormValues, { message });
            mapped = true;
          }
        }
        if (!mapped) setFormError(err.message);
      } else {
        setFormError('No se pudo guardar. Intenta de nuevo.');
      }
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={isSubmitting}
      size="lg"
      title={isEdit ? 'Editar usuario' : 'Nuevo usuario'}
      description={isEdit ? user.email : 'El usuario recibirá una contraseña temporal y deberá cambiarla al entrar.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button type="submit" form="user-form" loading={isSubmitting}>
            {isEdit ? 'Guardar cambios' : 'Crear usuario'}
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={onSubmit} noValidate className="space-y-5">
        {formError && <Alert tone="error">{formError}</Alert>}

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Nombre(s)" autoComplete="off" error={errors.firstName?.message} {...register('firstName')} />
          <TextField label="Apellidos" autoComplete="off" error={errors.lastName?.message} {...register('lastName')} />
          <TextField
            label="Correo electrónico"
            type="email"
            autoComplete="off"
            className="sm:col-span-2"
            hint="Con este correo iniciará sesión."
            error={errors.email?.message}
            {...register('email')}
          />
          <TextField label="Teléfono (opcional)" type="tel" error={errors.phone?.message} {...register('phone')} />
          <TextField
            label="Cédula profesional (opcional)"
            hint="Para médicos y farmacéuticos."
            error={errors.professionalLicense?.message}
            {...register('professionalLicense')}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Rol"
            disabled={isSelf}
            hint={isSelf ? 'No puedes cambiar tu propio rol.' : undefined}
            error={errors.roleId?.message}
            {...register('roleId')}
          >
            <option value="">Selecciona un rol…</option>
            {(isSelf && user ? roles.filter((r) => r.id === user.role.id) : grantableRoles).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </SelectField>

          {branches.length > 1 ? (
            <SelectField label="Sucursal predeterminada" error={errors.defaultBranchId?.message} {...register('defaultBranchId')}>
              {branches
                .filter((b) => branchIds.includes(b.id))
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </SelectField>
          ) : (
            <div>
              <p className="mb-1.5 text-sm font-medium text-slate-700">Sucursal</p>
              <p className="flex h-11 items-center rounded-lg bg-slate-50 px-3 text-sm text-slate-700 ring-1 ring-inset ring-slate-200">
                {branches[0]?.name ?? '—'}
              </p>
            </div>
          )}
        </div>

        {branches.length > 1 && (
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-slate-700">Sucursales a las que tiene acceso</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {branches.map((b) => (
                <Checkbox key={b.id} label={b.name} value={b.id} {...register('branchIds')} />
              ))}
            </div>
            {errors.branchIds && <p className="mt-1.5 text-sm text-red-600">{errors.branchIds.message}</p>}
          </fieldset>
        )}

        {!isEdit && (
          <fieldset className="rounded-lg border border-slate-200 p-4">
            <legend className="px-1 text-sm font-medium text-slate-700">Contraseña temporal</legend>
            <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="radio" value="auto" className="accent-brand-600" {...register('passwordMode')} />
                Generar automáticamente
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="radio" value="manual" className="accent-brand-600" {...register('passwordMode')} />
                Definirla yo
              </label>
            </div>
            {passwordMode === 'manual' && (
              <PasswordField
                label="Contraseña temporal"
                className="mt-4"
                autoComplete="new-password"
                hint={PASSWORD_HINT}
                error={errors.temporaryPassword?.message}
                {...register('temporaryPassword')}
              />
            )}
          </fieldset>
        )}
      </form>
    </Modal>
  );
}
