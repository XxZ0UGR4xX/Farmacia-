import type { ReactNode } from 'react';

export interface BarListItem {
  key: string;
  label: ReactNode;
  value: number;
  /** Texto del valor (si no, se usa `format`) */
  display?: string;
  /** Dato secundario en texto tenue (p. ej. "12 ventas · 31 %") */
  detail?: string;
}

/**
 * Barras horizontales de una serie, ordenadas por quien las llama. Cada barra lleva su
 * etiqueta y su valor escritos (en tinta de texto, no en el color de la serie), así que no
 * depende del color ni del cursor para leerse.
 */
export function BarList({ items, format, label }: { items: BarListItem[]; format: (v: number) => string; label: string }) {
  const max = Math.max(0, ...items.map((i) => i.value));
  return (
    <ul className="space-y-3" aria-label={label}>
      {items.map((item) => {
        const pct = max > 0 ? Math.max(0, (item.value / max) * 100) : 0;
        return (
          <li key={item.key}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-slate-700">{item.label}</span>
              <span className="shrink-0 font-medium tabular-nums text-slate-900">{item.display ?? format(item.value)}</span>
            </div>
            <div className="mt-1 h-2.5">
              {pct > 0 && <div className="h-2.5 rounded-r-[4px] bg-chart-1" style={{ width: `${Math.max(pct, 0.75)}%` }} />}
            </div>
            {item.detail && <p className="mt-0.5 text-xs text-slate-500">{item.detail}</p>}
          </li>
        );
      })}
    </ul>
  );
}
