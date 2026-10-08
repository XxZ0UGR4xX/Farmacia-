import { zodResolver } from '@hookform/resolvers/zod';
import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useSearchParams } from 'react-router';
import { z } from 'zod';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/useAuth';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader, PageHeader } from '../../components/ui/Card';
import { PasswordField } from '../../components/ui/FormField';
import { newPasswordFields, PASSWORD_HINT, passwordsMatch } from '../auth/password-schema';

const schema = z
  .object({ currentPassword: z.string().min(1, 'Ingresa tu contraseña actual'), ...newPasswordFields })
  .refine(passwordsMatch, { message: 'Las contraseñas no coinciden', path: ['confirmPassword'] })
  .refine((d) => d.password !== d.currentPassword, {
    message: 'La nueva contraseña debe ser distinta a la actual',
    path: ['password'],
  });
type FormValues = z.infer<typeof schema>;

export function ProfilePage() {
  const { user, updateUser } = useAuth();
  const [params] = useSearchParams();
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setError: setFieldError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', password: '', confirmPassword: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    setSuccess(null);
    try {
      const res = await api.post<{ message: string }>('/auth/change-password', {
        currentPassword: values.currentPassword,
        newPassword: values.password,
      });
      setSuccess(res.message);
      reset();
      if (user?.mustChangePassword) updateUser({ ...user, mustChangePassword: false });
    } catch (err) {
      if (err instanceof ApiError) {
        const fields = err.fieldErrors();
        if (fields.currentPassword) setFieldError('currentPassword', { message: fields.currentPassword });
        else setError(err.message);
      } else {
        setError('No se pudo cambiar la contraseña.');
      }
    }
  });

  if (!user) return null;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Mi perfil" description="Tus datos de acceso y seguridad." />

      {params.get('obligatorio') && user.mustChangePassword && (
        <Alert tone="warning" title="Cambio de contraseña requerido" className="mb-6">
          Por seguridad debes establecer una nueva contraseña antes de continuar.
        </Alert>
      )}

      <Card className="mb-6">
        <CardHeader title="Información de la cuenta" />
        <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">Nombre</dt>
            <dd className="font-medium text-slate-900">{user.fullName}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Correo</dt>
            <dd className="font-medium text-slate-900">{user.email}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Rol</dt>
            <dd className="font-medium text-slate-900">{user.role.name}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Sucursales</dt>
            <dd className="font-medium text-slate-900">{user.branches.map((b) => b.name).join(', ') || '—'}</dd>
          </div>
        </dl>
      </Card>

      <Card>
        <CardHeader title="Cambiar contraseña" description="Al cambiarla se cerrarán tus sesiones en otros equipos." />
        <form onSubmit={onSubmit} noValidate className="space-y-5 px-5 py-5">
          {success && <Alert tone="success">{success}</Alert>}
          {error && <Alert tone="error">{error}</Alert>}
          <PasswordField
            label="Contraseña actual"
            autoComplete="current-password"
            error={errors.currentPassword?.message}
            {...register('currentPassword')}
          />
          <PasswordField
            label="Nueva contraseña"
            autoComplete="new-password"
            hint={PASSWORD_HINT}
            error={errors.password?.message}
            {...register('password')}
          />
          <PasswordField
            label="Confirmar nueva contraseña"
            autoComplete="new-password"
            error={errors.confirmPassword?.message}
            {...register('confirmPassword')}
          />
          <div className="flex justify-end">
            <Button type="submit" loading={isSubmitting} icon={<KeyRound className="size-4" />}>
              Actualizar contraseña
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
