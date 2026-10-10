import { Search, UserPlus, X } from 'lucide-react';
import { useState } from 'react';
import { usePatientSearch, type PatientSummary } from '../../api/patients';
import { useAuth } from '../../auth/useAuth';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/FormField';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { PatientFormDialog } from './PatientFormDialog';
import { patientAge } from './patient-display';

/** Selector de paciente con búsqueda y, si se tiene permiso, alta rápida. */
export function PatientPicker({
  value,
  onChange,
  label = 'Paciente',
}: {
  value: PatientSummary | null;
  onChange: (p: PatientSummary | null) => void;
  label?: string;
}) {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const q = useDebouncedValue(search.trim(), 250);
  const results = usePatientSearch(q);

  if (value) {
    return (
      <div>
        <p className="mb-1.5 text-sm font-medium text-slate-700">{label}</p>
        <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-inset ring-slate-200">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-900">{value.fullName}</p>
            <p className="text-xs text-slate-500">{patientAge(value.age)}</p>
          </div>
          <button type="button" className="rounded p-1 text-slate-500 hover:bg-slate-200" aria-label="Quitar paciente" onClick={() => onChange(null)}>
            <X className="size-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-end gap-2">
        <TextField
          className="flex-1"
          label={label}
          placeholder="Nombre o teléfono"
          autoComplete="off"
          icon={<Search className="size-4" />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {can('patients.manage') && (
          <Button variant="secondary" aria-label="Nuevo paciente" onClick={() => setCreating(true)} icon={<UserPlus className="size-4" />} />
        )}
      </div>
      {q.length >= 2 && (
        <ul className="mt-2 max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
          {results.data?.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">Sin coincidencias</li>}
          {results.data?.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => {
                  onChange(p);
                  setSearch('');
                }}
                className="flex w-full justify-between gap-2 px-3 py-2 text-left hover:bg-brand-50"
              >
                <span className="text-sm font-medium text-slate-900">{p.fullName}</span>
                <span className="text-xs text-slate-500">
                  {patientAge(p.age)}
                  {p.phone ? ` · ${p.phone}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <PatientFormDialog open={creating} patient={null} onClose={() => setCreating(false)} onSaved={(p) => onChange(p)} />
    </div>
  );
}
