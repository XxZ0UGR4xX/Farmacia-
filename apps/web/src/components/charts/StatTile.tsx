import { clsx } from 'clsx';
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Card } from '../ui/Card';

/**
 * Indicador de un solo número (no es gráfica). El color sólo va en el ícono;
 * el valor y la etiqueta usan tinta de texto. El cambio se indica con flecha y texto.
 */
export function StatTile({
  label,
  value,
  icon: Icon,
  tone = 'neutral',
  hint,
  delta,
  to,
  testId,
}: {
  label: string;
  value: ReactNode;
  icon: LucideIcon;
  tone?: 'neutral' | 'info' | 'warning' | 'critical' | 'good';
  hint?: ReactNode;
  /** Cambio relativo (0.12 = +12 %) contra la referencia indicada */
  delta?: { ratio: number | null; against: string };
  to?: string;
  testId?: string;
}) {
  const tones = {
    neutral: 'bg-slate-100 text-slate-600',
    info: 'bg-accent-50 text-accent-700',
    good: 'bg-brand-50 text-brand-700',
    warning: 'bg-amber-50 text-amber-700',
    critical: 'bg-red-50 text-red-700',
  };
  const body = (
    <Card className={clsx('h-full p-4 sm:p-5', to && 'transition-shadow hover:shadow-md')}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-slate-500 sm:text-sm">{label}</p>
        <span className={clsx('flex size-8 shrink-0 items-center justify-center rounded-lg sm:size-9', tones[tone])}>
          <Icon className="size-4 sm:size-5" />
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-slate-900" data-testid={testId}>
        {value}
      </p>
      {delta && delta.ratio !== null && (
        <p className="mt-1 flex items-center gap-1 text-xs text-slate-600">
          {delta.ratio >= 0 ? <ArrowUpRight className="size-3.5 text-brand-600" /> : <ArrowDownRight className="size-3.5 text-red-600" />}
          <span className="tabular-nums">
            {delta.ratio >= 0 ? '+' : '−'}
            {Math.abs(delta.ratio * 100).toLocaleString('es-MX', { maximumFractionDigits: 0 })} %
          </span>
          <span className="text-slate-500">{delta.against}</span>
        </p>
      )}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </Card>
  );
  return to ? (
    <Link to={to} className="block rounded-xl focus-visible:outline-offset-4">
      {body}
    </Link>
  ) : (
    body
  );
}
