import { Link } from 'react-router';
import { Logo } from '../../components/ui/Logo';

export function NotFoundPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-slate-50 px-4 text-center">
      <Logo className="size-12" />
      <p className="text-5xl font-semibold text-slate-300">404</p>
      <h1 className="text-lg font-semibold text-slate-900">Página no encontrada</h1>
      <Link to="/" className="text-sm font-medium text-brand-700 hover:text-brand-800">
        Volver al inicio
      </Link>
    </div>
  );
}
