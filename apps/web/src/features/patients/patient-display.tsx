import { ADMINISTRATIVE_NOTICE } from '@farmacia/shared';
import { ShieldCheck } from 'lucide-react';

/** Aviso permanente: el sistema registra, no indica tratamientos. */
export function AdministrativeNotice({ className }: { className?: string }) {
  return (
    <p className={`flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-inset ring-slate-200 ${className ?? ''}`}>
      <ShieldCheck className="mt-px size-4 shrink-0 text-accent-600" />
      {ADMINISTRATIVE_NOTICE}
    </p>
  );
}

export const patientAge = (age: number | null) => (age === null ? 'Edad no registrada' : age === 1 ? '1 año' : `${age} años`);
