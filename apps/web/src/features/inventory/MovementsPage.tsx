import { MOVEMENT_TYPE_LABELS, MOVEMENT_TYPES, type MovementType } from '@farmacia/shared';
import { Activity, Download, Lock, Search, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useProduct } from '../../api/catalog';
import { downloadFile } from '../../api/client';
import { toQuery, useMovements } from '../../api/inventory';
import { useAuth } from '../../auth/useAuth';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card, PageHeader } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { TextField } from '../../components/ui/FormField';
import { Pagination } from '../../components/ui/Pagination';
import { SelectField } from '../../components/ui/SelectField';
import { Spinner } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { formatDateTime } from '../../lib/format';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { MovementLabel, QuantityChange } from './inventory-display';

export function MovementsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const productId = params.get('productId') ?? undefined;
  const product = useProduct(productId);
  const [search, setSearch] = useState('');
  const [type, setType] = useState<MovementType | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebouncedValue(search.trim());

  const filters = { q, type: type || undefined, productId, from: from || undefined, to: to || undefined };
  const invalidRange = Boolean(from && to && from > to);
  const movements = useMovements({ ...filters, page, pageSize: 30 }, !invalidRange);
  const rows = movements.data?.data ?? [];

  const exportCsv = async () => {
    try {
      await downloadFile(`/inventory/movements/export?${toQuery(filters)}`, 'movimientos.csv');
    } catch {
      toast.error('No se pudo exportar');
    }
  };

  const reset = (fn: () => void) => {
    fn();
    setPage(1);
  };

  return (
    <div>
      <PageHeader
        title="Movimientos de inventario"
        description="Bitácora de cada entrada, salida y ajuste: quién, cuándo, cuánto y por qué."
        actions={
          <Button variant="secondary" onClick={exportCsv} icon={<Download className="size-4" />}>
            Exportar
          </Button>
        }
      />

      <p className="mb-4 flex items-center gap-2 text-xs text-slate-500">
        <Lock className="size-3.5" /> Los movimientos no se pueden editar ni borrar. Una corrección se registra como un nuevo ajuste.
      </p>

      {productId && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">
          Producto: <strong>{product.data?.commercialName ?? '…'}</strong>
          <button
            type="button"
            className="ml-auto rounded p-1 hover:bg-brand-100"
            aria-label="Quitar filtro de producto"
            onClick={() => {
              params.delete('productId');
              setParams(params);
              setPage(1);
            }}
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-[2fr_1.4fr_1fr_1fr]">
        <TextField
          className="col-span-2 md:col-span-1"
          label="Buscar producto"
          icon={<Search className="size-4" />}
          value={search}
          onChange={(e) => reset(() => setSearch(e.target.value))}
        />
        <SelectField className="col-span-2 md:col-span-1" label="Tipo" value={type} onChange={(e) => reset(() => setType(e.target.value as MovementType | ''))}>
          <option value="">Todos</option>
          {MOVEMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {MOVEMENT_TYPE_LABELS[t]}
            </option>
          ))}
        </SelectField>
        <TextField label="Desde" type="date" value={from} max={to || undefined} onChange={(e) => reset(() => setFrom(e.target.value))} />
        <TextField label="Hasta" type="date" value={to} min={from || undefined} onChange={(e) => reset(() => setTo(e.target.value))} />
      </div>

      {invalidRange && <Alert tone="warning" className="mb-4">La fecha "Desde" debe ser anterior a "Hasta".</Alert>}
      {movements.isError && <Alert tone="error">No se pudieron cargar los movimientos.</Alert>}

      <Card className="overflow-hidden">
        {movements.isPending ? (
          <div className="flex justify-center py-16 text-brand-600">
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Activity} title="Sin movimientos" description="No hay movimientos con estos filtros." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Producto / Lote</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3 text-right">Anterior</th>
                  <th className="px-4 py-3 text-right">Cambio</th>
                  <th className="px-4 py-3 text-right">Nueva</th>
                  <th className="px-4 py-3">Usuario</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDateTime(m.createdAt)}</td>
                    <td className="px-4 py-3">
                      <Link to={`/inventario/existencias/${m.product.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                        {m.product.commercialName}
                      </Link>
                      <p className="font-mono text-xs text-slate-500">Lote {m.batch.lotNumber}</p>
                    </td>
                    <td className="px-4 py-3">
                      <MovementLabel movement={m} />
                      {m.referenceType === 'PURCHASE' && m.referenceId && can('purchases.view') ? (
                        <Link to={`/compras/historial/${m.referenceId}`} className="block max-w-56 truncate text-xs text-brand-700 hover:underline" title={m.notes ?? undefined}>
                          {m.notes ?? 'Ver compra'}
                        </Link>
                      ) : (
                        m.notes && <p className="max-w-56 truncate text-xs text-slate-400" title={m.notes}>{m.notes}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-500">{m.quantityBefore}</td>
                    <td className="px-4 py-3 text-right">
                      <QuantityChange value={m.quantityChange} />
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-slate-900">{m.quantityAfter}</td>
                    <td className="px-4 py-3 text-slate-600">{m.user.fullName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {movements.data && <Pagination meta={movements.data.meta} onPageChange={setPage} />}
      </Card>
    </div>
  );
}
