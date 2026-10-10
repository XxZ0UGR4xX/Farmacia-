import { Search, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { usePatients } from '../../api/patients';
import { useAuth } from '../../auth/useAuth';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card, PageHeader } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { TextField } from '../../components/ui/FormField';
import { Pagination } from '../../components/ui/Pagination';
import { Spinner } from '../../components/ui/Spinner';
import { formatDate } from '../../lib/format';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { PatientFormDialog } from './PatientFormDialog';
import { AdministrativeNotice, patientAge } from './patient-display';

export function PatientsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const q = useDebouncedValue(search.trim());
  const patients = usePatients({ q, page, pageSize: 25 });
  const rows = patients.data?.data ?? [];

  return (
    <div>
      <PageHeader
        title="Pacientes"
        description="Información personal protegida. Cada consulta de un expediente queda registrada."
        actions={
          can('patients.manage') && (
            <Button onClick={() => setCreating(true)} icon={<UserPlus className="size-4" />}>
              Nuevo paciente
            </Button>
          )
        }
      />
      <AdministrativeNotice className="mb-4" />
      <TextField
        className="mb-4 max-w-xl"
        label="Buscar"
        placeholder="Nombre, apellido o teléfono"
        icon={<Search className="size-4" />}
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
      />
      {patients.isError && <Alert tone="error">No se pudieron cargar los pacientes.</Alert>}
      <Card className="overflow-hidden">
        {patients.isPending ? (
          <div className="flex justify-center py-16 text-brand-600">
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Users} title="Sin pacientes" description={q ? 'No hay coincidencias con la búsqueda.' : 'Aún no hay pacientes registrados.'} />
        ) : (
          <>
            <table className="hidden w-full text-sm md:table">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Paciente</th>
                  <th className="px-4 py-3">Teléfono</th>
                  <th className="px-4 py-3 text-right">Recetas</th>
                  <th className="px-4 py-3 text-right">Compras</th>
                  <th className="px-4 py-3">Última visita</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((p) => (
                  <tr key={p.id} onClick={() => navigate(`/pacientes/${p.id}`)} className="cursor-pointer hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link to={`/pacientes/${p.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-slate-900 hover:text-brand-700">
                        {p.fullName}
                      </Link>
                      <p className="text-xs text-slate-500">{patientAge(p.age)}</p>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-600">{p.phone ?? '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">{p.prescriptions}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">{p.purchases}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(p.lastVisit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y divide-slate-100 md:hidden">
              {rows.map((p) => (
                <li key={p.id}>
                  <Link to={`/pacientes/${p.id}`} className="block p-4 hover:bg-slate-50">
                    <p className="font-medium text-slate-900">{p.fullName}</p>
                    <p className="text-xs text-slate-500">
                      {patientAge(p.age)} · {p.prescriptions} receta(s) · {p.purchases} compra(s)
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
        {patients.data && <Pagination meta={patients.data.meta} onPageChange={setPage} />}
      </Card>
      <PatientFormDialog open={creating} patient={null} onClose={() => setCreating(false)} onSaved={(p) => navigate(`/pacientes/${p.id}`)} />
    </div>
  );
}
