import { History, Pencil, Plus, Power, Search, Truck } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useSetSupplierActive, useSuppliers, type Supplier, type SupplierFilters } from '../../api/purchases';
import { useAuth } from '../../auth/useAuth';
import { ActionMenu } from '../../components/ui/ActionMenu';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, PageHeader } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { TextField } from '../../components/ui/FormField';
import { Pagination } from '../../components/ui/Pagination';
import { SelectField } from '../../components/ui/SelectField';
import { Spinner } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { formatDate, formatMoney } from '../../lib/format';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { SupplierFormDialog } from './SupplierFormDialog';

export function SuppliersPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<NonNullable<SupplierFilters['status']>>('active');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [toggling, setToggling] = useState<Supplier | null>(null);
  const q = useDebouncedValue(search.trim());
  const suppliers = useSuppliers({ q, status, page, pageSize: 25 });
  const setActive = useSetSupplierActive();
  const canManage = can('suppliers.manage');
  const canSeePurchases = can('purchases.view');
  const rows = suppliers.data?.data ?? [];

  const openForm = (s: Supplier | null) => {
    setEditing(s);
    setFormOpen(true);
  };

  const confirmToggle = async () => {
    if (!toggling) return;
    try {
      await setActive.mutateAsync({ id: toggling.id, isActive: !toggling.isActive });
      toast.success(toggling.isActive ? `${toggling.tradeName} desactivado` : `${toggling.tradeName} reactivado`);
    } catch {
      toast.error('No se pudo cambiar el estado del proveedor');
    }
    setToggling(null);
  };

  const actions = (s: Supplier) => [
    { label: 'Ver compras', icon: History, onSelect: () => navigate(`/compras/historial?supplierId=${s.id}`), hidden: !canSeePurchases },
    { label: 'Editar', icon: Pencil, onSelect: () => openForm(s), hidden: !canManage },
    { label: s.isActive ? 'Desactivar' : 'Reactivar', icon: Power, onSelect: () => setToggling(s), tone: s.isActive ? ('danger' as const) : undefined, hidden: !canManage },
  ];

  return (
    <div>
      <PageHeader
        title="Proveedores"
        description="Directorio de proveedores, sus condiciones de crédito y saldo pendiente."
        actions={
          canManage && (
            <Button onClick={() => openForm(null)} icon={<Plus className="size-4" />}>
              Nuevo proveedor
            </Button>
          )
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-[2fr_1fr]">
        <TextField
          className="col-span-2 md:col-span-1"
          label="Buscar"
          placeholder="Nombre, razón social, RFC o contacto"
          icon={<Search className="size-4" />}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <SelectField
          className="col-span-2 md:col-span-1"
          label="Mostrar"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as typeof status);
            setPage(1);
          }}
        >
          <option value="active">Activos</option>
          <option value="inactive">Desactivados</option>
          <option value="all">Todos</option>
        </SelectField>
      </div>

      {suppliers.isError && <Alert tone="error">No se pudieron cargar los proveedores.</Alert>}

      <Card className="overflow-hidden">
        {suppliers.isPending ? (
          <div className="flex justify-center py-16 text-brand-600">
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Truck}
            title="Sin proveedores"
            description={canManage ? 'Registra a tus proveedores para capturar sus compras.' : 'No hay proveedores con estos filtros.'}
          />
        ) : (
          <>
            <table className="hidden w-full text-sm md:table">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Proveedor</th>
                  <th className="px-4 py-3">Contacto</th>
                  <th className="px-4 py-3">Crédito</th>
                  <th className="px-4 py-3 text-right">Compras</th>
                  <th className="px-4 py-3 text-right">Saldo por pagar</th>
                  <th className="px-4 py-3">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((s) => (
                  <tr key={s.id} className={s.isActive ? '' : 'opacity-60'}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">
                        {s.tradeName} {!s.isActive && <Badge>Desactivado</Badge>}
                      </p>
                      <p className="text-xs text-slate-500">{[s.rfc, s.legalName].filter(Boolean).join(' · ') || '—'}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <p>{s.contactName ?? '—'}</p>
                      <p className="text-xs text-slate-500">{[s.phone, s.email].filter(Boolean).join(' · ')}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{s.creditDays > 0 ? `${s.creditDays} días` : 'Contado'}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                      <p>{s.stats.purchaseCount}</p>
                      {s.stats.lastPurchaseDate && <p className="text-xs text-slate-400">Última {formatDate(s.stats.lastPurchaseDate)}</p>}
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">
                      {s.stats.balanceDue > 0 ? <span className="text-amber-700">{formatMoney(s.stats.balanceDue)}</span> : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <ActionMenu label={`Acciones de ${s.tradeName}`} items={actions(s)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <ul className="divide-y divide-slate-100 md:hidden">
              {rows.map((s) => (
                <li key={s.id} className={`flex items-start gap-3 p-4 ${s.isActive ? '' : 'opacity-60'}`}>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="font-medium text-slate-900">{s.tradeName}</p>
                    <p className="text-xs text-slate-500">{[s.contactName, s.phone].filter(Boolean).join(' · ') || '—'}</p>
                    <div className="flex flex-wrap gap-1">
                      <Badge>{s.creditDays > 0 ? `Crédito ${s.creditDays} días` : 'Contado'}</Badge>
                      {s.stats.balanceDue > 0 && <Badge tone="amber">Debe {formatMoney(s.stats.balanceDue)}</Badge>}
                      {!s.isActive && <Badge>Desactivado</Badge>}
                    </div>
                  </div>
                  <ActionMenu label={`Acciones de ${s.tradeName}`} items={actions(s)} />
                </li>
              ))}
            </ul>
          </>
        )}
        {suppliers.data && <Pagination meta={suppliers.data.meta} onPageChange={setPage} />}
      </Card>

      <SupplierFormDialog open={formOpen} supplier={editing} onClose={() => setFormOpen(false)} />
      <ConfirmDialog
        open={toggling !== null}
        title={toggling?.isActive ? 'Desactivar proveedor' : 'Reactivar proveedor'}
        confirmLabel={toggling?.isActive ? 'Desactivar' : 'Reactivar'}
        tone={toggling?.isActive ? 'danger' : 'primary'}
        loading={setActive.isPending}
        onConfirm={confirmToggle}
        onCancel={() => setToggling(null)}
      >
        {toggling?.isActive
          ? `${toggling.tradeName} ya no aparecerá al registrar compras. Su historial se conserva y puedes reactivarlo cuando quieras.`
          : `${toggling?.tradeName} volverá a estar disponible para registrar compras.`}
      </ConfirmDialog>
    </div>
  );
}
