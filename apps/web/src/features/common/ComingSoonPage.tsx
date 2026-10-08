import { Hammer } from 'lucide-react';
import type { NavItem } from '../../components/layout/navigation';
import { Card } from '../../components/ui/Card';

/** Marcador para módulos que se implementan en fases posteriores. */
export function ComingSoonPage({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
          <Icon className="size-5" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{item.label}</h1>
      </div>
      <Card className="flex flex-col items-center px-6 py-16 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-accent-50 text-accent-600">
          <Hammer className="size-7" />
        </span>
        <h2 className="mt-4 text-lg font-semibold text-slate-900">Módulo en desarrollo</h2>
        <p className="mt-2 max-w-md text-sm text-slate-500">{item.description}</p>
        <p className="mt-4 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
          Se habilita en la Fase {item.phase}
        </p>
      </Card>
    </div>
  );
}
