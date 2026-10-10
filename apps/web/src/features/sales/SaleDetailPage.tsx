import { RETURN_DISPOSITION_LABELS, SALE_PAYMENT_METHODS, type ReturnDisposition, type SalePaymentMethod } from '@farmacia/shared';
import { ArrowLeft, Ban, Printer, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError } from '../../api/client';
import { useCancelSale, useCreateReturn, useSale, type Sale } from '../../api/sales';
import { useAuth } from '../../auth/useAuth';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { TextAreaField, TextField } from '../../components/ui/FormField';
import { Modal } from '../../components/ui/Modal';
import { SelectField } from '../../components/ui/SelectField';
import { Spinner } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { formatDate, formatDateTime, formatMoney } from '../../lib/format';
import { methodLabel, SaleStatusBadge } from './sales-display';
import { PrintableTicket } from './Ticket';

const r2 = (n: number) => Math.round(n * 100) / 100;

function CancelSaleDialog({ sale, open, onClose }: { sale: Sale; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const cancel = useCancelSale();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setReason('');
      setError(null);
    }
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 5) return setError('Explica el motivo (mínimo 5 caracteres)');
    try {
      await cancel.mutateAsync({ id: sale.id, reason: reason.trim() });
      toast.success(`Venta ${sale.folio} cancelada; las unidades regresaron al inventario`);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo cancelar la venta.');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={cancel.isPending}
      size="sm"
      title={`Cancelar venta ${sale.folio}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={cancel.isPending}>
            Volver
          </Button>
          <Button variant="danger" type="submit" form="cancel-sale-form" loading={cancel.isPending}>
            Cancelar venta
          </Button>
        </>
      }
    >
      <form id="cancel-sale-form" onSubmit={submit} noValidate className="space-y-3 text-sm text-slate-600">
        <p>
          Se devolverá al cliente {formatMoney(sale.total)} y las {sale.items.reduce((s, i) => s + i.quantity, 0)} pieza(s) regresarán a los mismos lotes de los
          que salieron. Para devolver sólo una parte usa "Devolución".
        </p>
        <TextAreaField label="Motivo" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} error={error ?? undefined} />
      </form>
    </Modal>
  );
}

function ReturnDialog({ sale, open, onClose }: { sale: Sale; open: boolean; onClose: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const create = useCreateReturn();
  const canRestock = can('inventory.adjust');
  const returnable = sale.items.filter((i) => i.quantity > i.returnedQty);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [dispositions, setDispositions] = useState<Record<string, ReturnDisposition>>({});
  const [reason, setReason] = useState('');
  const [refundMethod, setRefundMethod] = useState<SalePaymentMethod>('CASH');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuantities({});
    setDispositions({});
    setReason('');
    setRefundMethod(sale.payments[0]?.method ?? 'CASH');
    setErrors({});
    setFormError(null);
  }, [open, sale.payments]);

  const selected = returnable
    .map((i) => ({ item: i, quantity: Number(quantities[i.id] || 0) }))
    .filter((x) => x.quantity > 0);
  const refund = useMemo(
    () => r2(selected.reduce((s, { item, quantity }) => s + (quantity === item.quantity - item.returnedQty ? item.total - (item.total / item.quantity) * item.returnedQty : (item.total / item.quantity) * quantity), 0)),
    [selected],
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    returnable.forEach((i) => {
      const q = Number(quantities[i.id] || 0);
      if (!Number.isInteger(q) || q < 0 || q > i.quantity - i.returnedQty) errs[i.id] = `De 0 a ${i.quantity - i.returnedQty}`;
    });
    if (selected.length === 0) errs.items = 'Indica cuántas piezas se devuelven';
    if (reason.trim().length < 3) errs.reason = 'Indica el motivo';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    try {
      const updated = await create.mutateAsync({
        saleId: sale.id,
        input: {
          reason: reason.trim(),
          refundMethod,
          items: selected.map(({ item, quantity }) => ({ saleItemId: item.id, quantity, disposition: dispositions[item.id] ?? 'QUARANTINE' })),
        },
      });
      // El importe exacto lo calcula el servidor
      const amount = updated.returns.at(-1)?.refundTotal ?? refund;
      toast.success(`Devolución registrada: reembolsar ${formatMoney(amount)} en ${methodLabel(refundMethod).toLowerCase()}`);
      onClose();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'No se pudo registrar la devolución.');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={create.isPending}
      size="lg"
      title={`Devolución de la venta ${sale.folio}`}
      description="Lo devuelto queda en revisión antes de volver a venderse, salvo que lo regreses directo al inventario."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
            Cancelar
          </Button>
          <Button type="submit" form="return-form" loading={create.isPending}>
            Registrar devolución {refund > 0 ? `(${formatMoney(refund)})` : ''}
          </Button>
        </>
      }
    >
      <form id="return-form" onSubmit={submit} noValidate className="space-y-4">
        {formError && <Alert tone="error">{formError}</Alert>}
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {returnable.map((i) => (
            <li key={i.id} className="grid gap-3 p-3 sm:grid-cols-[1fr_7rem_12rem] sm:items-end">
              <div>
                <p className="font-medium text-slate-900">{i.product.commercialName}</p>
                <p className="text-xs text-slate-500">
                  Vendidas {i.quantity}
                  {i.returnedQty > 0 && ` · ya devueltas ${i.returnedQty}`} · {formatMoney(i.total / i.quantity)} c/u
                </p>
              </div>
              <TextField
                label="Devuelve"
                inputMode="numeric"
                placeholder="0"
                value={quantities[i.id] ?? ''}
                onChange={(e) => setQuantities((q) => ({ ...q, [i.id]: e.target.value }))}
                error={errors[i.id]}
              />
              <SelectField label="Destino" value={dispositions[i.id] ?? 'QUARANTINE'} onChange={(e) => setDispositions((d) => ({ ...d, [i.id]: e.target.value as ReturnDisposition }))}>
                <option value="QUARANTINE">En revisión</option>
                {canRestock && <option value="RESTOCKED">Regresa al inventario</option>}
                <option value="DISCARDED">Desechar</option>
              </SelectField>
            </li>
          ))}
        </ul>
        {errors.items && <p className="text-sm text-red-600">{errors.items}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} error={errors.reason} placeholder="Ej. el cliente compró de más" />
          <SelectField label="Reembolso en" value={refundMethod} onChange={(e) => setRefundMethod(e.target.value as SalePaymentMethod)}>
            {SALE_PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {methodLabel(m)}
              </option>
            ))}
          </SelectField>
        </div>
      </form>
    </Modal>
  );
}

export function SaleDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const sale = useSale(id);
  const [cancelling, setCancelling] = useState(false);
  const [returning, setReturning] = useState(false);
  const [printing, setPrinting] = useState<Sale | null>(null);

  if (sale.isPending) {
    return (
      <div className="flex justify-center py-16 text-brand-600">
        <Spinner />
      </div>
    );
  }
  if (sale.isError || !sale.data) return <Alert tone="error">La venta no existe.</Alert>;
  const s = sale.data;
  const canReturn = can('returns.create') && (s.status === 'COMPLETED' || s.status === 'PARTIALLY_RETURNED');
  const canCancel = can('sales.cancel') && s.status === 'COMPLETED';
  const change = s.payments.reduce((sum, p) => sum + (p.change ?? 0), 0);

  return (
    <div>
      <ButtonLink to="/ventas/historial" variant="ghost" size="sm" className="-ml-2 mb-3" icon={<ArrowLeft className="size-4" />}>
        Ventas
      </ButtonLink>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-2xl font-semibold tracking-tight text-slate-900">{s.folio}</h1>
            <SaleStatusBadge status={s.status} />
            {s.prescriptionChecked && <Badge tone="amber">Receta revisada</Badge>}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {formatDateTime(s.createdAt)} · Atendió {s.createdBy.fullName}
          </p>
          {(s.patient || s.prescription || s.hasPatient) && (
            <p className="mt-1 text-sm text-slate-600">
              {s.patient ? (
                <>
                  Paciente:{' '}
                  <Link to={`/pacientes/${s.patient.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                    {s.patient.fullName}
                  </Link>
                </>
              ) : (
                s.hasPatient && 'Venta ligada a un paciente'
              )}
              {s.prescription && (
                <>
                  {' · Receta '}
                  <Link to={`/pacientes/recetas/${s.prescription.id}`} className="font-mono font-medium text-slate-900 hover:text-brand-700">
                    {s.prescription.folio}
                  </Link>{' '}
                  ({s.prescription.doctorName})
                </>
              )}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setPrinting(s);
              setTimeout(() => window.print(), 50);
            }}
            icon={<Printer className="size-4" />}
          >
            Imprimir ticket
          </Button>
          {canReturn && (
            <Button variant="secondary" onClick={() => setReturning(true)} icon={<Undo2 className="size-4" />}>
              Devolución
            </Button>
          )}
          {canCancel && (
            <Button variant="ghost" onClick={() => setCancelling(true)} icon={<Ban className="size-4" />}>
              Cancelar venta
            </Button>
          )}
        </div>
      </div>

      {s.status === 'CANCELLED' && (
        <Alert tone="warning" className="mb-4">
          Cancelada el {formatDateTime(s.cancelledAt)} por {s.cancelledBy?.fullName}: {s.cancelReason}
        </Alert>
      )}

      <Card className="mb-6 overflow-hidden">
        <CardHeader title="Productos" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Producto</th>
                <th className="px-4 py-3">Lote(s)</th>
                <th className="px-4 py-3 text-right">Cantidad</th>
                <th className="px-4 py-3 text-right">Precio</th>
                <th className="px-4 py-3 text-right">Importe</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {s.items.map((i) => (
                <tr key={i.id}>
                  <td className="px-4 py-3">
                    <Link to={`/inventario/existencias/${i.product.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                      {i.product.commercialName}
                    </Link>
                    {i.returnedQty > 0 && <p className="text-xs text-amber-700">{i.returnedQty} devuelta(s)</p>}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {i.batches.map((b) => (
                      <p key={b.batchId}>
                        <span className="font-mono">{b.lotNumber}</span> × {b.quantity} · cad. {formatDate(b.expiresAt)}
                      </p>
                    ))}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{i.quantity}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                    {formatMoney(i.unitPrice)}
                    {i.discount > 0 && <p className="text-xs text-slate-400">−{formatMoney(i.discount)} desc.</p>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-900">{formatMoney(i.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="ml-auto max-w-xs space-y-1 border-t border-slate-100 px-5 py-4 text-sm">
          <div className="flex justify-between text-slate-600">
            <dt>Subtotal</dt>
            <dd className="tabular-nums">{formatMoney(s.subtotal)}</dd>
          </div>
          <div className="flex justify-between text-slate-600">
            <dt>IVA</dt>
            <dd className="tabular-nums">{formatMoney(s.taxTotal)}</dd>
          </div>
          <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold text-slate-900">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatMoney(s.total)}</dd>
          </div>
          {s.refunded > 0 && (
            <div className="flex justify-between text-amber-700">
              <dt>Reembolsado</dt>
              <dd className="tabular-nums">−{formatMoney(s.refunded)}</dd>
            </div>
          )}
          {s.profit !== undefined && (
            <div className="flex justify-between pt-1 text-xs text-slate-500">
              <dt>Costo / utilidad</dt>
              <dd className="tabular-nums">
                {formatMoney(s.costTotal)} / {formatMoney(s.profit)}
              </dd>
            </div>
          )}
        </dl>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader title="Pagos" />
          <ul className="divide-y divide-slate-100">
            {s.payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <div>
                  <p className="font-medium text-slate-900">{methodLabel(p.method)}</p>
                  <p className="text-xs text-slate-500">
                    {p.method === 'CASH' && p.received !== null ? `Recibido ${formatMoney(p.received)} · cambio ${formatMoney(p.change)}` : (p.reference ?? '')}
                  </p>
                </div>
                <span className="font-semibold tabular-nums text-slate-900">{formatMoney(p.amount)}</span>
              </li>
            ))}
          </ul>
          {change > 0 && <p className="border-t border-slate-100 px-5 py-2 text-xs text-slate-500">Cambio entregado: {formatMoney(change)}</p>}
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title="Devoluciones" />
          {s.returns.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500">Sin devoluciones.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {s.returns.map((r) => (
                <li key={r.id} className="space-y-1 px-5 py-3 text-sm">
                  <div className="flex justify-between gap-3">
                    <p className="font-mono font-medium text-slate-900">{r.folio}</p>
                    <span className="font-semibold tabular-nums text-amber-700">−{formatMoney(r.refundTotal)}</span>
                  </div>
                  <p className="text-xs text-slate-500">
                    {formatDateTime(r.createdAt)} · {r.user.fullName} · {r.reason}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {r.items.map((ri, idx) => (
                      <Badge key={idx} tone={ri.disposition === 'QUARANTINE' ? 'amber' : ri.disposition === 'RESTOCKED' ? 'green' : 'neutral'}>
                        {ri.quantity} × lote {ri.lotNumber}: {RETURN_DISPOSITION_LABELS[ri.disposition]}
                      </Badge>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <CancelSaleDialog sale={s} open={cancelling} onClose={() => setCancelling(false)} />
      <ReturnDialog sale={s} open={returning} onClose={() => setReturning(false)} />
      <PrintableTicket sale={printing} />
    </div>
  );
}
