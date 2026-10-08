import { EXPIRY_STATUS_LABELS, type ExpiryStatus } from '@farmacia/shared';
import { clsx } from 'clsx';
import { ClipboardList, Search } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useBatches, type BatchFilters } from '../../api/inventory';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Card, PageHeader } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { TextField } from '../../components/ui/FormField';
import { Pagination } from '../../components/ui/Pagination';
import { SelectField } from '../../components/ui/SelectField';
import { Spinner } from '../../components/ui/Spinner';
import { formatDate, formatMoney } from '../../lib/format';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { productDetails } from '../products/product-display';
import { BATCH_STATUS_LABELS, ExpiryCell } from './inventory-display';

const EXPIRY_CHIPS: { value: ExpiryStatus | undefined; label: string }[] = [
  { value: undefined, label: 'Todos' },
  { value: 'EXPIRED', label: EXPIRY_STATUS_LABELS.EXPIRED },
  { value: 'CRITICAL', label: 'Críticos (< 30 días)' },
  { value: 'WARNING', label: 'Próximos (30–90 días)' },
  { value: 'OK', label: 'Normales' },
];

export function BatchesPage() {
  const [search, setSearch] = useState('');
  const [expiry, setExpiry] = useState<ExpiryStatus | undefined>();
  const [status, setStatus] = useState<NonNullable<BatchFilters['status']>>('AVAILABLE');
  const [page, setPage] = useState(1);
  const q = useDebouncedValue(search.trim());
  const batches = useBatches({ q, expiry, status, page, pageSize: 25 });
  const rows = batches.data?.data ?? [];
  const showCosts = rows.some((b) => b.unitCost !== undefined);

  return (
    <div>
      <PageHeader title="Lotes" description="Cada lote se controla por separado, con su cantidad y caducidad." />

      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-[2fr_1fr]">
        <TextField
          className="col-span-2 md:col-span-1"
          label="Buscar"
          placeholder="Producto o número de lote"
          icon={<Search className="size-4" />}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <SelectField
          label="Mostrar"
          className="col-span-2 md:col-span-1"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as NonNullable<BatchFilters['status']>);
            setPage(1);
          }}
        >
          <option value="AVAILABLE">Con existencia</option>
          <option value="QUARANTINE">En cuarentena</option>
          <option value="DEPLETED">Agotados</option>
          <option value="ALL">Todos</option>
        </SelectField>
      </div>

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filtrar por caducidad">
        {EXPIRY_CHIPS.map((chip) => (
          <button
            key={chip.label}
            type="button"
            aria-pressed={expiry === chip.value}
            onClick={() => {
              setExpiry(chip.value);
              setPage(1);
            }}
            className={clsx(
              'rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset transition',
              expiry === chip.value ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50',
            )}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {batches.isError && <Alert tone="error">No se pudieron cargar los lotes.</Alert>}

      <Card className="overflow-hidden">
        {batches.isPending ? (
          <div className="flex justify-center py-16 text-brand-600">
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={ClipboardList} title="Sin lotes" description="No hay lotes con estos filtros." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Producto</th>
                  <th className="px-4 py-3">Lote</th>
                  <th className="px-4 py-3 text-right">Cantidad</th>
                  <th className="px-4 py-3">Caducidad</th>
                  <th className="px-4 py-3">Estado</th>
                  {showCosts && <th className="px-4 py-3 text-right">Valor</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link to={`/inventario/existencias/${b.product.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                        {b.product.commercialName}
                      </Link>
                      <p className="text-xs text-slate-500">
                        {productDetails({ ...b.product, pharmaceuticalForm: null })}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-mono font-medium text-slate-900">{b.lotNumber}</p>
                      <p className="text-xs text-slate-400">Recibido {formatDate(b.receivedAt)}</p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <p className="font-semibold tabular-nums text-slate-900">{b.quantity}</p>
                      <p className="text-xs text-slate-400">de {b.initialQuantity}</p>
                    </td>
                    <td className="px-4 py-3">
                      <ExpiryCell date={b.expiresAt} days={b.daysLeft} status={b.expiryStatus} />
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={b.sellable ? 'green' : b.status === 'QUARANTINE' ? 'amber' : b.expiryStatus === 'EXPIRED' && b.quantity > 0 ? 'red' : 'neutral'}>
                        {b.expiryStatus === 'EXPIRED' && b.quantity > 0 && b.status === 'ACTIVE' ? 'No vendible (caducado)' : BATCH_STATUS_LABELS[b.status]}
                      </Badge>
                    </td>
                    {showCosts && <td className="px-4 py-3 text-right tabular-nums text-slate-600">{formatMoney(b.value)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {batches.data && <Pagination meta={batches.data.meta} onPageChange={setPage} />}
      </Card>
    </div>
  );
}
