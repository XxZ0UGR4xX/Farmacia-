import { RETURN_DISPOSITION_LABELS } from '@farmacia/shared';
import { clsx } from 'clsx';
import { PackageCheck, Search, Trash2, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../../api/client';
import { useReturns, useReviewReturnItem, type ReturnRow } from '../../api/sales';
import { useAuth } from '../../auth/useAuth';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, PageHeader } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { TextField } from '../../components/ui/FormField';
import { Modal } from '../../components/ui/Modal';
import { Pagination } from '../../components/ui/Pagination';
import { Spinner } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { formatDate, formatDateTime, formatMoney } from '../../lib/format';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { methodLabel } from './sales-display';

type Reviewing = { ret: ReturnRow; item: ReturnRow['items'][number]; decision: 'RESTOCK' | 'DISCARD' };

export function ReturnsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState(false);
  const [page, setPage] = useState(1);
  const [reviewing, setReviewing] = useState<Reviewing | null>(null);
  const [notes, setNotes] = useState('');
  const [reviewError, setReviewError] = useState<string | null>(null);
  const q = useDebouncedValue(search.trim());
  const returns = useReturns({ q, pending: pending || undefined, page, pageSize: 20 });
  const review = useReviewReturnItem();
  const canReview = can('inventory.adjust');
  const rows = returns.data?.data ?? [];
  const pendingItems = returns.data?.summary.pendingItems ?? 0;

  const openReview = (r: Reviewing) => {
    setReviewing(r);
    setNotes('');
    setReviewError(null);
  };

  const confirmReview = async () => {
    if (!reviewing) return;
    try {
      await review.mutateAsync({ returnId: reviewing.ret.id, itemId: reviewing.item.id, decision: reviewing.decision, notes: notes.trim() || null });
      toast.success(
        reviewing.decision === 'RESTOCK'
          ? `${reviewing.item.quantity} pieza(s) regresaron al lote ${reviewing.item.lotNumber}`
          : `${reviewing.item.quantity} pieza(s) desechadas`,
      );
      setReviewing(null);
    } catch (err) {
      setReviewError(err instanceof ApiError ? err.message : 'No se pudo registrar la revisión.');
    }
  };

  return (
    <div>
      <PageHeader title="Devoluciones" description="Lo que regresan los clientes se revisa antes de volver a la venta." />

      {pendingItems > 0 && (
        <Alert tone="warning" className="mb-4">
          Hay {pendingItems} producto(s) devueltos esperando revisión ({returns.data?.summary.pendingUnits} pieza(s)).{' '}
          {!pending && (
            <button type="button" className="font-medium underline" onClick={() => setPending(true)}>
              Ver sólo pendientes
            </button>
          )}
        </Alert>
      )}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <TextField
          className="min-w-64 flex-1"
          label="Buscar"
          placeholder="Folio de devolución o de venta, o motivo"
          icon={<Search className="size-4" />}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <Button
          variant={pending ? 'primary' : 'secondary'}
          aria-pressed={pending}
          onClick={() => {
            setPending((v) => !v);
            setPage(1);
          }}
        >
          Pendientes de revisión
        </Button>
      </div>

      {returns.isError && <Alert tone="error">No se pudieron cargar las devoluciones.</Alert>}

      <Card className="overflow-hidden">
        {returns.isPending ? (
          <div className="flex justify-center py-16 text-brand-600">
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Undo2} title="Sin devoluciones" description={pending ? 'No hay productos pendientes de revisión.' : 'Aún no hay devoluciones registradas.'} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => (
              <li key={r.id} className="space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-mono font-medium text-slate-900">
                      {r.folio}{' '}
                      <span className="font-sans text-sm font-normal text-slate-500">
                        de la venta{' '}
                        <Link to={`/ventas/historial/${r.sale.id}`} className="font-mono text-brand-700 hover:underline">
                          {r.sale.folio}
                        </Link>
                      </span>
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatDateTime(r.createdAt)} · {r.user.fullName} · {r.reason}
                    </p>
                  </div>
                  <p className="text-right text-sm">
                    <span className="font-semibold tabular-nums text-slate-900">{formatMoney(r.refundTotal)}</span>
                    <span className="block text-xs text-slate-500">Reembolso en {methodLabel(r.refundMethod).toLowerCase()}</span>
                  </p>
                </div>
                <ul className="space-y-2">
                  {r.items.map((i) => (
                    <li key={i.id} className={clsx('flex flex-wrap items-center gap-3 rounded-lg p-3 text-sm', i.pendingReview ? 'bg-amber-50 ring-1 ring-amber-200' : 'bg-slate-50')}>
                      <div className="min-w-48 flex-1">
                        <p className="font-medium text-slate-900">
                          {i.quantity} × {i.product.commercialName}
                        </p>
                        <p className="text-xs text-slate-500">
                          Lote <span className="font-mono">{i.lotNumber}</span> · caduca {formatDate(i.expiresAt)}
                          {i.expired && <span className="font-medium text-red-600"> (caducado)</span>}
                        </p>
                        {i.reviewedAt && (
                          <p className="text-xs text-slate-500">
                            Revisado por {i.reviewedBy} el {formatDateTime(i.reviewedAt)}
                            {i.reviewNotes && ` · ${i.reviewNotes}`}
                          </p>
                        )}
                      </div>
                      <Badge tone={i.pendingReview ? 'amber' : i.disposition === 'RESTOCKED' ? 'green' : 'neutral'}>{RETURN_DISPOSITION_LABELS[i.disposition]}</Badge>
                      {i.pendingReview && canReview && (
                        <div className="flex gap-2">
                          <Button size="sm" disabled={i.expired} onClick={() => openReview({ ret: r, item: i, decision: 'RESTOCK' })} icon={<PackageCheck className="size-4" />}>
                            Regresar al inventario
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => openReview({ ret: r, item: i, decision: 'DISCARD' })} icon={<Trash2 className="size-4" />}>
                            Desechar
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {returns.data && <Pagination meta={returns.data.meta} onPageChange={setPage} />}
      </Card>

      <Modal
        open={reviewing !== null}
        onClose={() => setReviewing(null)}
        busy={review.isPending}
        size="sm"
        title={reviewing?.decision === 'RESTOCK' ? 'Regresar al inventario' : 'Desechar producto devuelto'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setReviewing(null)} disabled={review.isPending}>
              Cancelar
            </Button>
            <Button variant={reviewing?.decision === 'DISCARD' ? 'danger' : 'primary'} onClick={confirmReview} loading={review.isPending} data-autofocus>
              {reviewing?.decision === 'RESTOCK' ? 'Regresar al inventario' : 'Desechar'}
            </Button>
          </>
        }
      >
        {reviewing && (
          <div className="space-y-3 text-sm text-slate-600">
            <p>
              {reviewing.decision === 'RESTOCK'
                ? `Confirma que revisaste el producto (empaque íntegro, sin manipular). ${reviewing.item.quantity} pieza(s) volverán al lote ${reviewing.item.lotNumber} y se podrán vender.`
                : `${reviewing.item.quantity} pieza(s) de ${reviewing.item.product.commercialName} no regresarán al inventario.`}
            </p>
            <TextField label="Observaciones (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej. empaque sellado" />
            {reviewError && <Alert tone="error">{reviewError}</Alert>}
          </div>
        )}
      </Modal>
    </div>
  );
}
