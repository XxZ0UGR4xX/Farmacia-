import { clsx } from 'clsx';
import { Logo } from './Logo';

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={clsx('animate-spin', className ?? 'size-5')} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function FullPageSpinner({ label = 'Cargando...' }: { label?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-slate-50" role="status">
      <Logo className="size-12" />
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="size-4 text-brand-600" />
        {label}
      </div>
    </div>
  );
}
