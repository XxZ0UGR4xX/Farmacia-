import { clsx } from 'clsx';
import { BarChart3, Table2 } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Card } from '../ui/Card';

export interface TableView {
  columns: { label: string; numeric?: boolean }[];
  rows: (string | number)[][];
}

/**
 * Contenedor de una gráfica con su título y su vista de tabla (la versión accesible
 * de la misma información). Al imprimir se muestra la tabla además de la gráfica.
 */
export function ChartCard({
  title,
  description,
  table,
  empty,
  children,
  className,
}: {
  title: string;
  description?: string;
  table?: TableView;
  /** Mensaje cuando no hay datos (reemplaza la gráfica) */
  empty?: string | false;
  children: ReactNode;
  className?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  const titleId = useId();
  return (
    <Card className={clsx('break-inside-avoid p-5', className)}>
      <figure aria-labelledby={titleId}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 id={titleId} className="font-semibold text-slate-900">
              {title}
            </h3>
            {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
          </div>
          {table && !empty && (
            <button
              type="button"
              onClick={() => setAsTable((v) => !v)}
              aria-pressed={asTable}
              className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50 print:hidden"
            >
              {asTable ? <BarChart3 className="size-3.5" /> : <Table2 className="size-3.5" />}
              {asTable ? 'Ver gráfica' : 'Ver tabla'}
            </button>
          )}
        </div>
        {empty ? (
          <p className="py-10 text-center text-sm text-slate-500">{empty}</p>
        ) : asTable && table ? (
          <DataTable table={table} />
        ) : (
          children
        )}
      </figure>
    </Card>
  );
}

export function DataTable({ table, caption }: { table: TableView; caption?: string }) {
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className="w-full text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="text-left text-xs font-medium uppercase tracking-wide text-slate-500">
          <tr className="border-b border-slate-200">
            {table.columns.map((c) => (
              <th key={c.label} scope="col" className={clsx('py-2 pr-4 last:pr-0', c.numeric && 'text-right')}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {table.rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className={clsx('py-2 pr-4 last:pr-0', table.columns[j]?.numeric ? 'text-right tabular-nums text-slate-900' : 'text-slate-700')}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
