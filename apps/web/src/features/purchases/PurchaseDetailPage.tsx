import { PAYMENT_METHOD_LABELS, SUPPLIER_PAYMENT_METHODS, type PaymentMethod } from '@farmacia/shared';
import { ArrowLeft, Ban, Banknote, PackageCheck, Pencil } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError } from '../../api/client';
import { useAddPayment, useCancelPurchase, usePurchase, useReceivePurchase, type Purchase } from '../../api/purchases';
import { useAuth } from '../../auth/useAuth';
import { Alert } from '../../components/ui/Alert';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { TextAreaField, TextField } from '../../components/ui/FormField';
import { Modal } from '../../components/ui/Modal';
import { SelectField } from '../../components/ui/SelectField';
import { Spinner } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { formatDate, formatDateTime, formatMoney } from '../../lib/format';
import { useToday } from '../../lib/useToday';
import { PaymentStatusBadge, PurchaseStatusBadge } from './purchase-display';

function PaymentDialog({ purchase, open, onClose }: { purchase: Purchase; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const pay = useAddPayment();
  const today = useToday();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<Exclude<PaymentMethod, 'CREDIT'>>('TRANSFER');
  const [reference, setReference] = useState('');
  const [paidAt, setPaidAt] = useState(today);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAmount(purchase.balance.toFixed(2));
    setMethod('TRANSFER');
    setReference('');
    setPaidAt(today);
    setErrors({});
    setFormError(null);
  }, [open, purchase.balance, today]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = Number(amount.replace(',', '.'));
    if (!(value > 0)) return setErrors({ amount: 'Captura un importe mayor a cero' });
    if (value > purchase.balance + 0.005) return setErrors({ amount: `El saldo es ${formatMoney(purchase.balance)}` });
    try {
      await pay.mutateAsync({ id: purchase.id, input: { amount: value, method, reference: reference.trim() || null, paidAt } });
      toast.success(value + 0.005 >= purchase.balance ? `Compra ${purchase.folio} liquidada` : `Pago de ${formatMoney(value)} registrado`);
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        const fields = err.fieldErrors();
        if (Object.keys(fields).length) setErrors(fields);
        else setFormError(err.message);
      } else setFormError('No se pudo registrar el pago.');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={pay.isPending}
      title="Registrar pago al proveedor"
      description={`${purchase.supplier.tradeName} · saldo ${formatMoney(purchase.balance)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pay.isPending}>
            Cancelar
          </Button>
          <Button type="submit" form="payment-form" loading={pay.isPending}>
            Registrar pago
          </Button>
        </>
      }
    >
      <form id="payment-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        {formError && (
          <Alert tone="error" className="sm:col-span-2">
            {formError}
          </Alert>
        )}
        <TextField label="Importe" inputMode="decimal" icon={<span className="text-sm">$</span>} value={amount} onChange={(e) => setAmount(e.target.value)} error={errors.amount} />
        <SelectField label="Forma de pago" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
          {SUPPLIER_PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {PAYMENT_METHOD_LABELS[m]}
            </option>
          ))}
        </SelectField>
        <TextField label="Referencia (opcional)" placeholder="Folio SPEI, cheque…" value={reference} onChange={(e) => setReference(e.target.value)} error={errors.reference} />
        <TextField label="Fecha de pago" type="date" max={today} value={paidAt} onChange={(e) => setPaidAt(e.target.value)} error={errors.paidAt} />
      </form>
    </Modal>
  );
}

function CancelDialog({ purchase, open, onClose }: { purchase: Purchase; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const cancel = useCancelPurchase();
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
      await cancel.mutateAsync({ id: purchase.id, reason: reason.trim() });
      toast.success(`Compra ${purchase.folio} cancelada`);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo cancelar la compra.');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={cancel.isPending}
      size="sm"
      title={`Cancelar compra ${purchase.folio}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={cancel.isPending}>
            Volver
          </Button>
          <Button variant="danger" type="submit" form="cancel-form" loading={cancel.isPending}>
            Cancelar compra
          </Button>
        </>
      }
    >
      <form id="cancel-form" onSubmit={submit} noValidate className="space-y-3 text-sm text-slate-600">
        <p>
          {purchase.status === 'RECEIVED'
            ? 'Se retirarán del inventario las unidades que ingresó esta compra. Sólo es posible si siguen completas en sus lotes.'
            : 'El pedido quedará cancelado; no afecta el inventario.'}
        </p>
        <TextAreaField label="Motivo" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} error={error ?? undefined} />
      </form>
    </Modal>
  );
}

export function PurchaseDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const purchase = usePurchase(id);
  const receive = useReceivePurchase();
  const [receiving, setReceiving] = useState(false);
  const [receiveError, setReceiveError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  if (purchase.isPending) {
    return (
      <div className="flex justify-center py-16 text-brand-600">
        <Spinner />
      </div>
    );
  }
  if (purchase.isError || !purchase.data) return <Alert tone="error">La compra no existe.</Alert>;
  const p = purchase.data;
  const pending = p.status === 'ORDERED' || p.status === 'DRAFT';
  const missingLots = p.items.some((i) => !i.lotNumber || !i.expiresAt);
  const canPay = can('purchases.pay') && p.status !== 'CANCELLED' && p.balance > 0;
  const canCancel = can('purchases.cancel') && p.status !== 'CANCELLED' && p.amountPaid === 0;

  const confirmReceive = async () => {
    setReceiveError(null);
    try {
      await receive.mutateAsync(p.id);
      toast.success(`Compra ${p.folio} recibida e ingresada al inventario`);
    } catch (err) {
      setReceiveError(err instanceof ApiError ? err.message : 'No se pudo recibir la compra.');
    }
    setReceiving(false);
  };

  return (
    <div>
      <ButtonLink to="/compras/historial" variant="ghost" size="sm" className="-ml-2 mb-3" icon={<ArrowLeft className="size-4" />}>
        Compras
      </ButtonLink>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-2xl font-semibold tracking-tight text-slate-900">{p.folio}</h1>
            <PurchaseStatusBadge status={p.status} />
            <PaymentStatusBadge status={p.paymentStatus} overdue={p.overdue} cancelled={p.status === 'CANCELLED'} />
          </div>
          <p className="mt-1 text-slate-700">{p.supplier.tradeName}</p>
          <p className="text-sm text-slate-500">
            {formatDate(p.purchaseDate)}
            {p.invoiceNumber && ` · Factura ${p.invoiceNumber}`} · {PAYMENT_METHOD_LABELS[p.paymentMethod]}
            {p.paymentDueDate && ` · Vence ${formatDate(p.paymentDueDate)}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {pending && can('purchases.create') && (
            <ButtonLink to={`/compras/historial/${p.id}/editar`} variant="secondary" icon={<Pencil className="size-4" />}>
              {missingLots ? 'Capturar lotes' : 'Editar'}
            </ButtonLink>
          )}
          {pending && can('purchases.receive') && (
            <Button onClick={() => setReceiving(true)} disabled={missingLots} icon={<PackageCheck className="size-4" />}>
              Recibir mercancía
            </Button>
          )}
          {canPay && (
            <Button variant={pending ? 'secondary' : 'primary'} onClick={() => setPaying(true)} icon={<Banknote className="size-4" />}>
              Registrar pago
            </Button>
          )}
          {canCancel && (
            <Button variant="ghost" onClick={() => setCancelling(true)} icon={<Ban className="size-4" />}>
              Cancelar
            </Button>
          )}
        </div>
      </div>

      {pending && missingLots && (
        <Alert tone="info" className="mb-4">
          Pedido pendiente: cuando llegue la mercancía, captura el lote y la caducidad de cada producto para poder recibirlo.
        </Alert>
      )}
      {p.overdue && (
        <Alert tone="error" className="mb-4">
          El pago venció el {formatDate(p.paymentDueDate)}. Saldo pendiente: {formatMoney(p.balance)}.
        </Alert>
      )}
      {receiveError && (
        <Alert tone="error" className="mb-4">
          {receiveError}
        </Alert>
      )}

      <Card className="mb-6 overflow-hidden">
        <CardHeader title="Productos" description={`${p.items.length} partida(s) · ${p.items.reduce((s, i) => s + i.quantity, 0)} unidad(es)`} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Producto</th>
                <th className="px-4 py-3">Lote</th>
                <th className="px-4 py-3">Caducidad</th>
                <th className="px-4 py-3 text-right">Cantidad</th>
                <th className="px-4 py-3 text-right">Costo</th>
                <th className="px-4 py-3 text-right">Importe</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {p.items.map((i) => (
                <tr key={i.id}>
                  <td className="px-4 py-3">
                    <Link to={`/inventario/existencias/${i.product.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                      {i.product.commercialName}
                    </Link>
                    <p className="text-xs text-slate-500">{i.product.sku}</p>
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-700">{i.lotNumber ?? <span className="font-sans text-slate-400">Por capturar</span>}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(i.expiresAt)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{i.quantity}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                    {formatMoney(i.unitCost)}
                    {i.discount > 0 && <p className="text-xs text-slate-400">−{formatMoney(i.discount)} desc.</p>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-900">
                    {formatMoney(i.total)}
                    {i.taxRate > 0 && <p className="text-xs text-slate-400">IVA {formatMoney(i.taxAmount)}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="ml-auto max-w-xs space-y-1 border-t border-slate-100 px-5 py-4 text-sm">
          <div className="flex justify-between text-slate-600">
            <dt>Subtotal</dt>
            <dd className="tabular-nums">{formatMoney(p.subtotal)}</dd>
          </div>
          {p.discountTotal > 0 && (
            <div className="flex justify-between text-slate-600">
              <dt>Descuento</dt>
              <dd className="tabular-nums">−{formatMoney(p.discountTotal)}</dd>
            </div>
          )}
          <div className="flex justify-between text-slate-600">
            <dt>IVA</dt>
            <dd className="tabular-nums">{formatMoney(p.taxTotal)}</dd>
          </div>
          <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold text-slate-900">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatMoney(p.total)}</dd>
          </div>
          {p.status !== 'CANCELLED' && (
            <div className="flex justify-between font-medium text-slate-700">
              <dt>Saldo pendiente</dt>
              <dd className="tabular-nums">{formatMoney(p.balance)}</dd>
            </div>
          )}
        </dl>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader title="Pagos" />
          {p.payments.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500">Sin pagos registrados.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {p.payments.map((pay) => (
                <li key={pay.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div>
                    <p className="font-medium text-slate-900">{PAYMENT_METHOD_LABELS[pay.method]}</p>
                    <p className="text-xs text-slate-500">
                      {formatDateTime(pay.paidAt)} · {pay.user.fullName}
                      {pay.reference && ` · ${pay.reference}`}
                    </p>
                  </div>
                  <span className="font-semibold tabular-nums text-slate-900">{formatMoney(pay.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-5 text-sm">
          <h2 className="mb-3 font-semibold text-slate-900">Historial</h2>
          <ul className="space-y-2 text-slate-600">
            <li>
              Capturada por <strong>{p.createdBy.fullName}</strong> el {formatDateTime(p.createdAt)}
            </li>
            {p.receivedAt && (
              <li>
                Recibida por <strong>{p.receivedBy?.fullName}</strong> el {formatDateTime(p.receivedAt)}
              </li>
            )}
            {p.cancelledAt && <li className="text-red-700">Cancelada el {formatDateTime(p.cancelledAt)}</li>}
            {p.notes && <li className="whitespace-pre-line text-slate-500">Notas: {p.notes}</li>}
          </ul>
        </Card>
      </div>

      <ConfirmDialog
        open={receiving}
        title={`Recibir compra ${p.folio}`}
        confirmLabel="Recibir mercancía"
        loading={receive.isPending}
        onConfirm={confirmReceive}
        onCancel={() => setReceiving(false)}
      >
        Se ingresarán {p.items.reduce((s, i) => s + i.quantity, 0)} unidad(es) al inventario con sus lotes y caducidades, y se actualizará el último costo de cada producto.
        {p.paymentMethod !== 'CREDIT' && can('purchases.pay') && ' Como es de contado, la compra quedará pagada.'}
      </ConfirmDialog>
      <PaymentDialog purchase={p} open={paying} onClose={() => setPaying(false)} />
      <CancelDialog purchase={p} open={cancelling} onClose={() => setCancelling(false)} />
    </div>
  );
}
