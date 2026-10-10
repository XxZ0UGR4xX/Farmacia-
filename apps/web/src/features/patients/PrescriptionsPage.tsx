import { clsx } from 'clsx';
import { FilePlus2, FileText, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { usePrescriptions } from '../../api/patients';
import { useAuth } from '../../auth/useAuth';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, PageHeader } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { TextField } from '../../components/ui/FormField';
import { Pagination } from '../../components/ui/Pagination';
import { Spinner } from '../../components/ui/Spinner';
import { formatDate } from '../../lib/format';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { AdministrativeNotice } from './patient-display';
import { PrescriptionFormDialog } from './PrescriptionFormDialog';

export function PrescriptionsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [includeVoided, setIncludeVoided] = useState(false);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const q = useDebouncedValue(search.trim());
  const invalid = Boolean(from && to && from > to);
  const list = usePrescriptions({ q, from: from || undefined, to: to || undefined, includeVoided: includeVoided || undefined, page, pageSize: 25 }, !invalid);
  const rows = list.data?.data ?? [];
  const reset = (fn: () => void) => {
    fn();
    setPage(1);
  };

  return (
    <div>
      <PageHeader
        title="Recetas"
        description="Registro de recetas médicas. Una receta registrada no se modifica ni se borra."
        actions={
          can('prescriptions.manage') && (
            <Button onClick={() => setCreating(true)} icon={<FilePlus2 className="size-4" />}>
              Registrar receta
            </Button>
          )
        }
      />
      <AdministrativeNotice className="mb-4" />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-[2fr_1fr_1fr_auto] md:items-end">
        <TextField className="col-span-2 md:col-span-1" label="Buscar" placeholder="Folio, paciente, médico o cédula" icon={<Search className="size-4" />} value={search} onChange={(e) => reset(() => setSearch(e.target.value))} />
        <TextField label="Desde" type="date" value={from} max={to || undefined} onChange={(e) => reset(() => setFrom(e.target.value))} />
        <TextField label="Hasta" type="date" value={to} min={from || undefined} onChange={(e) => reset(() => setTo(e.target.value))} />
        <label className="col-span-2 inline-flex h-11 items-center gap-2 text-sm text-slate-600 md:col-span-1">
          <input type="checkbox" className="size-4 accent-brand-600" checked={includeVoided} onChange={(e) => reset(() => setIncludeVoided(e.target.checked))} />
          Incluir anuladas
        </label>
      </div>
      {invalid && <Alert tone="warning" className="mb-4">La fecha "Desde" debe ser anterior a "Hasta".</Alert>}
      {list.isError && <Alert tone="error">No se pudieron cargar las recetas.</Alert>}
      <Card className="overflow-hidden">
        {list.isPending ? (
          <div className="flex justify-center py-16 text-brand-600">
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={FileText} title="Sin recetas" description="No hay recetas con estos filtros." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => navigate(`/pacientes/recetas/${r.id}`)} className={clsx('flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left hover:bg-slate-50 sm:px-5', r.voided && 'opacity-60')}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">
                      <span className="font-mono">{r.folio}</span> ·{' '}
                      <Link to={`/pacientes/${r.patient.id}`} onClick={(e) => e.stopPropagation()} className="hover:text-brand-700 hover:underline">
                        {r.patient.fullName}
                      </Link>
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatDate(r.issuedAt)} · {r.doctorName}
                      {r.doctorLicense && ` (céd. ${r.doctorLicense})`} · {r.medications.join(', ')}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    {r.sales > 0 && <Badge tone="green">Surtida</Badge>}
                    {r.voided && <Badge>Anulada</Badge>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        {list.data && <Pagination meta={list.data.meta} onPageChange={setPage} />}
      </Card>
      <PrescriptionFormDialog open={creating} patient={null} onClose={() => setCreating(false)} onCreated={(rx) => navigate(`/pacientes/recetas/${rx.id}`)} />
    </div>
  );
}
