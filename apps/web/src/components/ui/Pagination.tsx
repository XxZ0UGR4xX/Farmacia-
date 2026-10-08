import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './Button';

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function Pagination({ meta, onPageChange }: { meta: PageMeta; onPageChange: (page: number) => void }) {
  if (meta.total === 0) return null;
  const from = (meta.page - 1) * meta.pageSize + 1;
  const to = Math.min(meta.page * meta.pageSize, meta.total);
  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
      <p>
        {from}–{to} de {meta.total}
      </p>
      {meta.totalPages > 1 && (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onPageChange(meta.page - 1)}
            disabled={meta.page <= 1}
            aria-label="Página anterior"
            icon={<ChevronLeft className="size-4" />}
          />
          <span className="px-2">
            {meta.page} / {meta.totalPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onPageChange(meta.page + 1)}
            disabled={meta.page >= meta.totalPages}
            aria-label="Página siguiente"
            icon={<ChevronRight className="size-4" />}
          />
        </div>
      )}
    </div>
  );
}
