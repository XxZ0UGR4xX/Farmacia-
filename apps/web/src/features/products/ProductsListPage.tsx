import { PRODUCT_STATUS_LABELS, type ProductStatus } from '@farmacia/shared';
import { clsx } from 'clsx';
import { PackageSearch, Plus, ScanBarcode, Search } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { findProductByBarcode, useCatalog, useProducts, type ProductFilters } from '../../api/catalog';
import { ApiError } from '../../api/client';
import { useAuth } from '../../auth/useAuth';
import { Alert } from '../../components/ui/Alert';
import { ButtonLink } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { TextField } from '../../components/ui/FormField';
import { Pagination } from '../../components/ui/Pagination';
import { SelectField } from '../../components/ui/SelectField';
import { Spinner } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { formatMoney, formatPercent } from '../../lib/format';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { productDetails, ProductBadges, ProductThumb, StockBadge } from './product-display';

/** Un lector USB "teclea" el código y Enter: si parece código de barras, se busca exacto. */
const looksLikeBarcode = (v: string) => /^[0-9]{6,14}$/.test(v);

export function ProductsListPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Omit<ProductFilters, 'q' | 'page'>>({ sort: 'name' });
  const [page, setPage] = useState(1);
  const q = useDebouncedValue(search.trim());

  const products = useProducts({ ...filters, q, page, pageSize: 25 });
  const categories = useCatalog('categories');
  const laboratories = useCatalog('laboratories');
  const showCosts = products.data?.data.some((p) => p.margin !== undefined) ?? false;

  const setFilter = <K extends keyof typeof filters>(key: K, value: (typeof filters)[K]) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };

  const onSearchKey = async (e: KeyboardEvent<HTMLInputElement>) => {
    const value = search.trim();
    if (e.key !== 'Enter' || !looksLikeBarcode(value)) return;
    e.preventDefault();
    try {
      const product = await findProductByBarcode(value);
      navigate(`/inventario/productos/${product.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        toast.error(`No hay ningún producto con el código ${value}`);
      }
    }
  };

  const list = products.data?.data ?? [];
  const hasFilters = Boolean(q || filters.categoryId || filters.laboratoryId || filters.status || filters.requiresPrescription !== undefined);

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-end">
        <div className="grid flex-1 grid-cols-2 gap-3 md:grid-cols-[2fr_1fr_1fr_1fr]">
          <TextField
            className="col-span-2 md:col-span-1"
            label="Buscar"
            placeholder="Nombre, genérico, principio activo o código"
            icon={<Search className="size-4" />}
            trailing={<ScanBarcode className="mr-2 size-4 text-slate-400" aria-hidden />}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            onKeyDown={onSearchKey}
            hint="Puedes escanear el código de barras aquí."
          />
          <SelectField label="Categoría" value={filters.categoryId ?? ''} onChange={(e) => setFilter('categoryId', e.target.value || undefined)}>
            <option value="">Todas</option>
            {categories.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectField>
          <SelectField label="Laboratorio" value={filters.laboratoryId ?? ''} onChange={(e) => setFilter('laboratoryId', e.target.value || undefined)}>
            <option value="">Todos</option>
            {laboratories.data?.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Estado"
            value={filters.status ?? ''}
            onChange={(e) => setFilter('status', (e.target.value || undefined) as ProductStatus | undefined)}
          >
            <option value="">Todos</option>
            {Object.entries(PRODUCT_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectField>
        </div>
        {can('products.create') && (
          <ButtonLink to="/inventario/productos/nuevo" icon={<Plus className="size-4" />} className="h-11 xl:mb-6">
            Nuevo producto
          </ButtonLink>
        )}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-500">Mostrar:</span>
        {[
          { label: 'Todos', value: undefined },
          { label: 'Con receta', value: true },
          { label: 'Sin receta', value: false },
        ].map((opt) => (
          <button
            key={opt.label}
            type="button"
            onClick={() => setFilter('requiresPrescription', opt.value)}
            aria-pressed={filters.requiresPrescription === opt.value}
            className={clsx(
              'rounded-full px-3 py-1 font-medium ring-1 ring-inset transition',
              filters.requiresPrescription === opt.value
                ? 'bg-brand-600 text-white ring-brand-600'
                : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50',
            )}
          >
            {opt.label}
          </button>
        ))}
        <span className="ml-auto" />
        <SelectField
          label="Ordenar"
          hideLabel
          className="w-48"
          value={filters.sort}
          onChange={(e) => setFilter('sort', e.target.value as ProductFilters['sort'])}
        >
          <option value="name">Nombre (A-Z)</option>
          <option value="price_asc">Precio: menor a mayor</option>
          <option value="price_desc">Precio: mayor a menor</option>
          <option value="recent">Más recientes</option>
        </SelectField>
      </div>

      {products.isError && <Alert tone="error">No se pudieron cargar los productos.</Alert>}

      <Card className="overflow-hidden">
        {products.isPending ? (
          <div className="flex justify-center py-16 text-brand-600">
            <Spinner />
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            icon={PackageSearch}
            title={hasFilters ? 'Sin resultados' : 'Aún no hay productos'}
            description={hasFilters ? 'Prueba con otra búsqueda o quita los filtros.' : 'Registra tu primer medicamento.'}
          />
        ) : (
          <>
            <table className="hidden w-full text-sm lg:table">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Producto</th>
                  <th className="px-4 py-3">Categoría / Laboratorio</th>
                  <th className="px-4 py-3 text-right">Precio</th>
                  {showCosts && <th className="px-4 py-3 text-right">Margen</th>}
                  <th className="px-4 py-3">Existencias</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => navigate(`/inventario/productos/${p.id}`)}
                    className={clsx('cursor-pointer hover:bg-slate-50', p.status !== 'ACTIVE' && 'opacity-60')}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <ProductThumb product={p} />
                        <div className="min-w-0">
                          {/* Enlace real (teclado, abrir en otra pestaña); la fila completa también es clicable */}
                          <Link
                            to={`/inventario/productos/${p.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="font-medium text-slate-900 hover:text-brand-700"
                          >
                            {p.commercialName}
                          </Link>
                          <p className="truncate text-xs text-slate-500">{productDetails(p)}</p>
                          {p.genericName && p.genericName !== p.commercialName && (
                            <p className="truncate text-xs text-slate-400">{p.genericName}</p>
                          )}
                          <div className="mt-1">
                            <ProductBadges product={p} />
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <p>{p.category.name}</p>
                      <p className="text-xs text-slate-400">{p.laboratory?.name ?? '—'}</p>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-slate-900 tabular-nums">
                      {formatMoney(p.salePrice)}
                      {p.taxRate > 0 && <p className="text-xs font-normal text-slate-400">IVA {p.taxRate * 100} %</p>}
                    </td>
                    {showCosts && (
                      <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                        {formatPercent(p.margin?.markupPercent ?? null)}
                        <p className="text-xs text-slate-400">{formatMoney(p.margin?.profit)} c/u</p>
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <StockBadge product={p} />
                      {p.inventory.location && <p className="mt-1 text-xs text-slate-400">{p.inventory.location}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <ul className="divide-y divide-slate-100 lg:hidden">
              {list.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/inventario/productos/${p.id}`)}
                    className={clsx('flex w-full items-start gap-3 p-4 text-left hover:bg-slate-50', p.status !== 'ACTIVE' && 'opacity-60')}
                  >
                    <ProductThumb product={p} />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-slate-900">{p.commercialName}</p>
                        <p className="shrink-0 font-semibold tabular-nums text-slate-900">{formatMoney(p.salePrice)}</p>
                      </div>
                      <p className="text-xs text-slate-500">{productDetails(p)}</p>
                      <div className="flex flex-wrap items-center gap-1">
                        <StockBadge product={p} />
                        <ProductBadges product={p} />
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {products.data && <Pagination meta={products.data.meta} onPageChange={setPage} />}
      </Card>
    </>
  );
}
