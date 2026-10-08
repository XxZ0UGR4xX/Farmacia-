import { zodResolver } from '@hookform/resolvers/zod';
import { LogIn, Mail } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router';
import { z } from 'zod';
import { ApiError } from '../../api/client';
import { postLoginPath } from '../../auth/guards';
import { useAuth } from '../../auth/useAuth';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Checkbox, PasswordField, TextField } from '../../components/ui/FormField';
import { AuthLayout } from './AuthLayout';

const schema = z.object({
  email: z.string().trim().min(1, 'Ingresa tu correo electrónico').pipe(z.email('Correo electrónico inválido')),
  password: z.string().min(1, 'Ingresa tu contraseña'),
  rememberMe: z.boolean(),
});
type FormValues = z.infer<typeof schema>;

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<{ message: string; tone: 'error' | 'warning' } | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '', rememberMe: false },
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await login(values);
      navigate(postLoginPath(location.state), { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError({
          message: err.message,
          tone: err.code === 'ACCOUNT_LOCKED' || err.code === 'RATE_LIMITED' ? 'warning' : 'error',
        });
      } else {
        setError({ message: 'No se pudo iniciar sesión. Intenta de nuevo.', tone: 'error' });
      }
    }
  });

  return (
    <AuthLayout title="Iniciar sesión" subtitle="Ingresa con tu correo y contraseña.">
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        {error && <Alert tone={error.tone}>{error.message}</Alert>}

        <TextField
          label="Correo electrónico"
          type="email"
          autoComplete="username"
          inputMode="email"
          autoFocus
          placeholder="nombre@farmacia.com"
          icon={<Mail className="size-4" />}
          error={errors.email?.message}
          {...register('email')}
        />

        <PasswordField
          label="Contraseña"
          autoComplete="current-password"
          placeholder="••••••••••"
          error={errors.password?.message}
          {...register('password')}
        />

        <div className="flex items-center justify-between gap-3">
          <Checkbox label="Recordarme" {...register('rememberMe')} />
          <Link to="/recuperar-contrasena" className="text-sm font-medium text-brand-700 hover:text-brand-800">
            ¿Olvidaste tu contraseña?
          </Link>
        </div>

        <Button type="submit" size="lg" fullWidth loading={isSubmitting} icon={<LogIn className="size-4" />}>
          Entrar
        </Button>

        <p className="text-center text-xs text-slate-400">
          Usa "Recordarme" sólo en equipos de confianza.
        </p>
      </form>
    </AuthLayout>
  );
}
