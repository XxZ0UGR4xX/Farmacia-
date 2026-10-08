import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Mail, Send } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { z } from 'zod';
import { api, ApiError } from '../../api/client';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/FormField';
import { AuthLayout } from './AuthLayout';

const schema = z.object({
  email: z.string().trim().min(1, 'Ingresa tu correo electrónico').pipe(z.email('Correo electrónico inválido')),
});
type FormValues = z.infer<typeof schema>;

export function ForgotPasswordPage() {
  const [sentMessage, setSentMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: '' } });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await api.post<{ message: string }>('/auth/forgot-password', values, { auth: false });
      setSentMessage(res.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo enviar la solicitud.');
    }
  });

  return (
    <AuthLayout
      title="Recuperar contraseña"
      subtitle="Te enviaremos un enlace para crear una contraseña nueva."
    >
      {sentMessage ? (
        <div className="space-y-6">
          <Alert tone="success" title="Revisa tu correo">
            {sentMessage} El enlace vence en 30 minutos.
          </Alert>
          <Link to="/iniciar-sesion" className="inline-flex items-center gap-2 text-sm font-medium text-brand-700">
            <ArrowLeft className="size-4" /> Volver a iniciar sesión
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          {error && <Alert tone="error">{error}</Alert>}
          <TextField
            label="Correo electrónico"
            type="email"
            autoComplete="email"
            autoFocus
            icon={<Mail className="size-4" />}
            error={errors.email?.message}
            {...register('email')}
          />
          <Button type="submit" size="lg" fullWidth loading={isSubmitting} icon={<Send className="size-4" />}>
            Enviar enlace
          </Button>
          <Link
            to="/iniciar-sesion"
            className="flex items-center justify-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="size-4" /> Volver a iniciar sesión
          </Link>
        </form>
      )}
    </AuthLayout>
  );
}
