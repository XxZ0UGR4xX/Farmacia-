import { clsx } from 'clsx';
import { AlertTriangle, Boxes, CalendarX2, Download, PackagePlus, PackageX, Search, Warehouse } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useCatalog } from '../../api/catalog';
import { downloadFile } from '../../api/client';
import { toQuery, useStock, type InventoryStockStatus, type StockFilters } from '../../api/inventory';
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
import { formatMoney } from '../../lib/format';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { productDetails, ProductThumb } from '../products/product-display';
import { EntryDialog } from './EntryDialog';
import { ExpiryCell, StockStatusBadge } from './inventory-display';

function SummaryCard({
  label,
  value,
  icon: Icon,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: ReactNode;
  icon: typeof Boxes;
  tone: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-slate-500 sm:text-sm">{label}</p>
        <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${tone}`}>
          <Icon className="size-4" />
        </span>
      </div>
      <p className="mt-2 text-xl font-semibold tabular-nums text-slate-900 sm:text-2xl">{value}</p>
    </>
  );
  const className = clsx(
    'rounded-xl border bg-white p-4 text-left shadow-sm transition',
    active ? 'border-brand-500 ring-2 ring-brand-100' : 'border-slate-200',
    onClick && 'hover:border-brand-300',
  );
  return onClick ? (
    <button type="button" onClick={onClick} aria-pressed={active} className={className}>
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}

export function StockPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Omit<StockFilters, 'q' | 'page'>>({ sort: 'name' });
  const [page, setPage] = useState(1);
  const [entryOpen, setEntryOpen] = useState(false);
  const q = useDebouncedValue(search.trim());

  const stock = useStock({ ...filters, q, page, pageSize: 25 });
  const categories = useCatalog('categories');
  const summary = stock.data?.summary;
  const showValue = summary?.inventoryValue !== undefined;

  const setFilter = <K extends keyof typeof filters>(key: K, value: (typeof filters)[K]) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };
  const toggleStatus = (status: InventoryStockStatus) => setFilter('stockStatus', filters.stockStatus === status ? undefined : status);

  const exportCsv = async () => {
    try {
      await downloadFile(`/inventory/stock/export?${toQuery({ ...filters, q })}`, 'existencias.csv');
    } catch {
      toast.error('No se pudo exportar');
    }
  };

  const rows = stock.data?.data ?? [];

  return (
    <div>
      <PageHeader
        title="Existencias"
        description="Stock disponible por producto, calculado desde sus lotes."
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={exportCsv} icon={<Download className="size-4" />}>
              Exportar
            </Button>
            {can('inventory.adjust') && (
              <Button onClick={() => setEntryOpen(true)} icon={<PackagePlus className="size-4" />}>
                Registrar entrada
              </Button>
            )}
          </div>
        }
      />

      <div className={clsx('mb-6 grid grid-cols-2 gap-3', showValue ? 'lg:grid-cols-5' : 'lg:grid-cols-4')}>
        <SummaryCard label="Con existencia" value={summary ? `${summary.withStock} / ${summary.activeProducts}` : '—'} icon={Boxes} tone="bg-brand-50 text-brand-700" />
        <SummaryCard
          label="Agotados"
          value={summary?.outOfStock ?? '—'}
          icon={PackageX}
          tone="bg-red-50 text-red-700"
          active={filters.stockStatus === 'OUT'}
          onClick={() => toggleStatus('OUT')}
        />
        <SummaryCard
          label="Stock bajo"
          value={summary?.lowStock ?? '—'}
          icon={AlertTriangle}
          tone="bg-amber-50 text-amber-700"
          active={filters.stockStatus === 'LOW'}
          onClick={() => toggleStatus('LOW')}
        />
        <SummaryCard label="Unidades caducadas" value={summary?.expiredUnits ?? '—'} icon={CalendarX2} tone="bg-red-50 text-red-700" />
        {showValue && <SummaryCard label="Valor del inventario" value={formatMoney(summary?.inventoryValue)} icon={Warehouse} tone="bg-accent-50 text-accent-700" />}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-[2fr_1fr_1fr]">
        <TextField
          className="col-span-2 md:col-span-1"
          label="Buscar"
          placeholder="Producto, principio activo o código"
          icon={<Search className="size-4" />}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <SelectField label="Categoría" value={filters.categoryId ?? ''} onChange={(e) => setFilter('categoryId', e.target.value || undefined)}>
          <option value="">Todas</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Ordenar" value={filters.sort} onChange={(e) => setFilter('sort', e.target.value as StockFilters['sort'])}>
          <option value="name">Nombre (A-Z)</option>
          <option value="stock">Menor existencia primero</option>
          <option value="expiry">Caducidad más próxima</option>
        </SelectField>
      </div>

      {filters.stockStatus && (
        <p className="mb-3 text-sm text-slate-600">
          Mostrando sólo: <strong>{filters.stockStatus === 'OUT' ? 'agotados' : filters.stockStatus === 'LOW' ? 'stock bajo' : filters.stockStatus}</strong>{' '}
          <button type="button" className="font-medium text-brand-700 underline" onClick={() => setFilter('stockStatus', undefined)}>
            Quitar filtro
          </button>
        </p>
      )}

      {stock.isError && <Alert tone="error">No se pudieron cargar las existencias.</Alert>}

      <Card className="overflow-hidden">
        {stock.isPending ? (
          <div className="flex justify-center py-16 text-brand-600">
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Boxes} title="Sin resultados" description="Prueba con otra búsqueda o quita los filtros." />
        ) : (
          <>
            <table className="hidden w-full text-sm lg:table">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Producto</th>
                  <th className="px-4 py-3 text-right">Disponible</th>
                  <th className="px-4 py-3 text-right">Mín / Máx</th>
                  <th className="px-4 py-3">Próxima caducidad</th>
                  <th className="px-4 py-3">Estado</th>
                  {showValue && <th className="px-4 py-3 text-right">Valor</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.productId} onClick={() => navigate(`/inventario/existencias/${r.productId}`)} className="cursor-pointer hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <ProductThumb product={r} />
                        <div className="min-w-0">
                          <Link
                            to={`/inventario/existencias/${r.productId}`}
                            onClick={(e) => e.stopPropagation()}
                            className="font-medium text-slate-900 hover:text-brand-700"
                          >
                            {r.commercialName}
                          </Link>
                          <p className="truncate text-xs text-slate-500">{productDetails(r)}</p>
                          <p className="text-xs text-slate-400">
                            {r.category}
                            {r.location ? ` · ${r.location}` : ''}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <p className="text-base font-semibold tabular-nums text-slate-900">{r.available}</p>
                      {r.expired > 0 && <p className="text-xs font-medium text-red-600">+{r.expired} caducadas</p>}
                      {r.quarantine > 0 && <p className="text-xs text-amber-700">{r.quarantine} en cuarentena</p>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                      {r.minStock} / {r.maxStock ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <ExpiryCell date={r.nextExpiry} days={r.daysToExpiry} status={r.expiryStatus} />
                    </td>
                    <td className="px-4 py-3">
                      <StockStatusBadge status={r.stockStatus} />
                      <p className="mt-1 text-xs text-slate-400">{r.batches} lote(s)</p>
                    </td>
                    {showValue && (
                      <td className="px-4 py-3 text-right tabular-nums text-slate-600">{r.value ? formatMoney(r.value) : '—'}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>

            <ul className="divide-y divide-slate-100 lg:hidden">
              {rows.map((r) => (
                <li key={r.productId}>
                  <Link to={`/inventario/existencias/${r.productId}`} className="flex items-start gap-3 p-4 hover:bg-slate-50">
                    <ProductThumb product={r} />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-slate-900">{r.commercialName}</p>
                        <p className="shrink-0 text-lg font-semibold tabular-nums text-slate-900">{r.available}</p>
                      </div>
                      <p className="text-xs text-slate-500">{productDetails(r)}</p>
                      <div className="flex flex-wrap items-center gap-1">
                        <StockStatusBadge status={r.stockStatus} />
                        {r.expired > 0 && <span className="text-xs font-medium text-red-600">+{r.expired} caducadas</span>}
                      </div>
                      {r.nextExpiry && (
                        <div className="pt-1">
                          <ExpiryCell date={r.nextExpiry} days={r.daysToExpiry} status={r.expiryStatus} />
                        </div>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
        {stock.data && <Pagination meta={stock.data.meta} onPageChange={setPage} />}
      </Card>

      <EntryDialog open={entryOpen} product={null} showCosts={showValue} onClose={() => setEntryOpen(false)} />
    </div>
  );
}
