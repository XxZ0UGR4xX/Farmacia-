import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, KeyRound } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router';
import { z } from 'zod';
import { api, ApiError } from '../../api/client';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { PasswordField } from '../../components/ui/FormField';
import { AuthLayout } from './AuthLayout';
import { newPasswordFields, PASSWORD_HINT, passwordsMatch } from './password-schema';

const schema = z
  .object(newPasswordFields)
  .refine(passwordsMatch, { message: 'Las contraseñas no coinciden', path: ['confirmPassword'] });
type FormValues = z.infer<typeof schema>;

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  const onSubmit = handleSubmit(async ({ password }) => {
    setError(null);
    try {
      await api.post('/auth/reset-password', { token, password }, { auth: false });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo restablecer la contraseña.');
    }
  });

  const backLink = (
    <Link to="/iniciar-sesion" className="inline-flex items-center gap-2 text-sm font-medium text-brand-700">
      <ArrowLeft className="size-4" /> Ir a iniciar sesión
    </Link>
  );

  if (!token) {
    return (
      <AuthLayout title="Enlace inválido">
        <div className="space-y-6">
          <Alert tone="error">El enlace de recuperación no es válido. Solicita uno nuevo.</Alert>
          <Link to="/recuperar-contrasena" className="text-sm font-medium text-brand-700">
            Solicitar un nuevo enlace
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Nueva contraseña" subtitle="Elige una contraseña segura que no uses en otros sitios.">
      {done ? (
        <div className="space-y-6">
          <Alert tone="success" title="Contraseña actualizada">
            Por seguridad cerramos todas tus sesiones abiertas. Ya puedes iniciar sesión.
          </Alert>
          {backLink}
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          {error && (
            <Alert tone="error">
              {error}{' '}
              <Link to="/recuperar-contrasena" className="font-medium underline">
                Solicitar otro enlace
              </Link>
            </Alert>
          )}
          <PasswordField
            label="Nueva contraseña"
            autoComplete="new-password"
            autoFocus
            hint={PASSWORD_HINT}
            error={errors.password?.message}
            {...register('password')}
          />
          <PasswordField
            label="Confirmar contraseña"
            autoComplete="new-password"
            error={errors.confirmPassword?.message}
            {...register('confirmPassword')}
          />
          <Button type="submit" size="lg" fullWidth loading={isSubmitting} icon={<KeyRound className="size-4" />}>
            Guardar contraseña
          </Button>
          <div className="text-center">{backLink}</div>
        </form>
      )}
    </AuthLayout>
  );
}
