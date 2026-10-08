import { ShieldX } from 'lucide-react';
import { Link } from 'react-router';
import { Card } from '../../components/ui/Card';

export function ForbiddenPage() {
  return (
    <Card className="flex flex-col items-center px-6 py-16 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-red-50 text-red-600">
        <ShieldX className="size-7" />
      </span>
      <h1 className="mt-4 text-lg font-semibold text-slate-900">Acceso restringido</h1>
      <p className="mt-2 max-w-md text-sm text-slate-500">
        Tu rol no tiene permiso para ver esta sección. Si lo necesitas, solicítalo al administrador.
      </p>
      <Link to="/" className="mt-6 text-sm font-medium text-brand-700 hover:text-brand-800">
        Volver al inicio
      </Link>
    </Card>
  );
}
