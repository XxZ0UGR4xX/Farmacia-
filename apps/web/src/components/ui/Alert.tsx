import { clsx } from 'clsx';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';

type Tone = 'info' | 'success' | 'warning' | 'error';

const tones: Record<Tone, { box: string; icon: ReactNode }> = {
  info: { box: 'bg-accent-50 text-accent-700 ring-accent-100', icon: <Info className="size-5" /> },
  success: { box: 'bg-brand-50 text-brand-800 ring-brand-100', icon: <CheckCircle2 className="size-5" /> },
  warning: { box: 'bg-amber-50 text-amber-800 ring-amber-100', icon: <AlertTriangle className="size-5" /> },
  error: { box: 'bg-red-50 text-red-700 ring-red-100', icon: <XCircle className="size-5" /> },
};

export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  const t = tones[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={clsx('flex gap-3 rounded-lg p-3 text-sm ring-1 ring-inset', t.box, className)}
    >
      <span className="mt-px shrink-0">{t.icon}</span>
      <div className="space-y-0.5">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className="opacity-90">{children}</div>}
      </div>
    </div>
  );
}
