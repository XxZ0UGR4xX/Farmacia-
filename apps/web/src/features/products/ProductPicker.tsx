import { Search } from 'lucide-react';
import { useState } from 'react';
import { useProducts, type Product } from '../../api/catalog';
import { TextField } from '../../components/ui/FormField';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { productDetails } from './product-display';

/**
 * Buscador de productos con soporte para lector de código de barras:
 * al escanear (código + Enter) se elige el único resultado.
 */
export function ProductPicker({
  onSelect,
  label = 'Producto',
  clearOnSelect = false,
  autoFocus,
}: {
  onSelect: (p: Product) => void;
  label?: string;
  /** Limpia la búsqueda al elegir (para agregar varios productos seguidos) */
  clearOnSelect?: boolean;
  autoFocus?: boolean;
}) {
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search.trim(), 250);
  const results = useProducts({ q, page: 1, pageSize: 8, status: 'ACTIVE' });
  const choose = (p: Product) => {
    onSelect(p);
    if (clearOnSelect) setSearch('');
  };
  return (
    <div>
      <TextField
        label={label}
        autoFocus={autoFocus}
        placeholder="Busca por nombre o escanea el código"
        icon={<Search className="size-4" />}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => {
          // Con el lector: Enter elige el único resultado
          if (e.key === 'Enter') {
            e.preventDefault();
            const only = results.data?.data.length === 1 ? results.data.data[0] : undefined;
            if (only) choose(only);
          }
        }}
      />
      {q && (
        <ul className="mt-2 max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
          {results.data?.data.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">Sin resultados</li>}
          {results.data?.data.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => choose(p)} className="w-full px-3 py-2 text-left hover:bg-brand-50">
                <span className="block text-sm font-medium text-slate-900">{p.commercialName}</span>
                <span className="block text-xs text-slate-500">{productDetails(p)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
