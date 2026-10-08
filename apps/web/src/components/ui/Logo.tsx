import { clsx } from 'clsx';
import { useId } from 'react';

/** Cruz farmacéutica estilizada. */
export function Logo({ className }: { className?: string }) {
  // id único por instancia: con ids repetidos el navegador usa el primer gradiente (que puede estar oculto)
  const gradientId = useId();
  return (
    <svg viewBox="0 0 40 40" className={clsx('shrink-0', className ?? 'size-9')} aria-hidden>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#10b981" />
          <stop offset="100%" stopColor="#2563eb" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="10" fill={`url(#${gradientId})`} />
      <path d="M16.5 9h7v7.5H31v7h-7.5V31h-7v-7.5H9v-7h7.5z" fill="#fff" />
    </svg>
  );
}

export function BrandName({ light = false }: { light?: boolean }) {
  return (
    <div className="leading-tight">
      <p className={clsx('text-base font-semibold', light ? 'text-white' : 'text-slate-900')}>Farmacia</p>
      <p className={clsx('text-xs', light ? 'text-white/70' : 'text-slate-500')}>Sistema de gestión</p>
    </div>
  );
}
