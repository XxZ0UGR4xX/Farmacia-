import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, purchaseLineAmounts, purchaseTotals, type PaymentMethod } from '@farmacia/shared';
import { clsx } from 'clsx';
import { AlertTriangle, ArrowLeft, PackageCheck, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { Product } from '../../api/catalog';
import { ApiError } from '../../api/client';
import { useReceivePurchase, usePurchase, useSavePurchase, useSupplierOptions, type Purchase, type PurchaseInput } from '../../api/purchases';
import { useAuth } from '../../auth/useAuth';
import { Alert } from '../../components/ui/Alert';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { TextField } from '../../components/ui/FormField';
import { SelectField } from '../../components/ui/SelectField';
import { Spinner } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { formatDate, formatMoney } from '../../lib/format';
import { useToday } from '../../lib/useToday';
import { ProductPicker } from '../products/ProductPicker';

interface Line {
  key: string;
  productId: string;
  name: string;
  /** Precio de venta sin IVA (para avisar si el costo lo supera); null si no se conoce */
  netSalePrice: number | null;
  taxRate: number;
  lotNumber: string;
  expiresAt: string;
  quantity: string;
  unitCost: string;
  discount: string;
}

const CRITICAL_DAYS = 30;
let lineSeq = 0;
const newKey = () => `l${++lineSeq}`;

const toNumber = (v: string) => Number(v.replace(',', '.'));
const daysUntil = (iso: string, today: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function lineFromProduct(p: Product): Line {
  return {
    key: newKey(),
    productId: p.id,
    name: [p.commercialName, p.concentration && !p.commercialName.includes(p.concentration) ? p.concentration : null].filter(Boolean).join(' '),
    netSalePrice: p.salePrice / (1 + p.taxRate),
    taxRate: p.taxRate,
    lotNumber: '',
    expiresAt: '',
    quantity: '1',
    unitCost: p.purchasePrice ? p.purchasePrice.toFixed(2) : '',
    discount: '',
  };
}

function linesFromPurchase(p: Purchase): Line[] {
  return p.items.map((i) => ({
    key: newKey(),
    productId: i.product.id,
    name: [i.product.commercialName, i.product.concentration && !i.product.commercialName.includes(i.product.concentration) ? i.product.concentration : null]
      .filter(Boolean)
      .join(' '),
    netSalePrice: null,
    taxRate: i.taxRate,
    lotNumber: i.lotNumber ?? '',
    expiresAt: i.expiresAt ?? '',
    quantity: String(i.quantity),
    unitCost: String(i.unitCost),
    discount: i.discount ? String(i.discount) : '',
  }));
}

export function PurchaseFormPage() {
  const { id } = useParams();
  const existing = usePurchase(id);
  if (id && existing.isPending) {
    return (
      <div className="flex justify-center py-16 text-brand-600">
        <Spinner />
      </div>
    );
  }
  if (id && (existing.isError || !existing.data)) return <Alert tone="error">La compra no existe.</Alert>;
  if (existing.data && existing.data.status !== 'ORDERED' && existing.data.status !== 'DRAFT') {
    return <Alert tone="warning">Esta compra ya no se puede editar ({existing.data.status === 'RECEIVED' ? 'ya se recibió' : 'está cancelada'}).</Alert>;
  }
  return <PurchaseForm purchase={existing.data ?? null} />;
}

function PurchaseForm({ purchase }: { purchase: Purchase | null }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const save = useSavePurchase();
  const receive = useReceivePurchase();
  const suppliers = useSupplierOptions();
  const canReceive = can('purchases.receive');
  const today = useToday();

  const [supplierId, setSupplierId] = useState(purchase?.supplier.id ?? '');
  const [invoiceNumber, setInvoiceNumber] = useState(purchase?.invoiceNumber ?? '');
  // Vacío = hoy en la farmacia (se resuelve cuando responde el servidor)
  const [purchaseDateInput, setPurchaseDate] = useState(purchase?.purchaseDate ?? '');
  const purchaseDate = purchaseDateInput || today;
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(purchase?.paymentMethod ?? 'CASH');
  const [paymentDueDate, setPaymentDueDate] = useState(purchase?.paymentDueDate ?? '');
  const [notes, setNotes] = useState(purchase?.notes ?? '');
  const [lines, setLines] = useState<Line[]>(() => (purchase ? linesFromPurchase(purchase) : []));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const focusKey = useRef<string | null>(null);

  // Al agregar un producto el cursor pasa al lote de su renglón
  useEffect(() => {
    if (!focusKey.current) return;
    document.getElementById(`${focusKey.current}-lot`)?.focus();
    focusKey.current = null;
  }, [lines.length]);

  const supplier = suppliers.data?.find((s) => s.id === supplierId) ?? (purchase ? purchase.supplier : undefined);
  const suggestedDueDate = supplier && purchaseDate ? addDays(purchaseDate, supplier.creditDays) : null;

  const amounts = useMemo(
    () =>
      lines.map((l) =>
        purchaseLineAmounts({ quantity: toNumber(l.quantity) || 0, unitCost: toNumber(l.unitCost) || 0, discount: toNumber(l.discount) || 0, taxRate: l.taxRate }),
      ),
    [lines],
  );
  const totals = useMemo(
    () =>
      purchaseTotals(
        lines.map((l) => ({ quantity: toNumber(l.quantity) || 0, unitCost: toNumber(l.unitCost) || 0, discount: toNumber(l.discount) || 0, taxRate: l.taxRate })),
      ),
    [lines],
  );

  const updateLine = (key: string, field: keyof Line, value: string) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, [field]: value } : l)));

  const addProduct = (p: Product) => {
    const line = lineFromProduct(p);
    focusKey.current = line.key;
    setLines((ls) => [...ls, line]);
  };

  const validate = (receiving: boolean) => {
    const errs: Record<string, string> = {};
    if (!supplierId) errs.supplierId = 'Selecciona un proveedor';
    if (!purchaseDate) errs.purchaseDate = 'Indica la fecha';
    else if (purchaseDate > today) errs.purchaseDate = 'La fecha no puede ser futura';
    if (lines.length === 0) errs.items = 'Agrega al menos un producto';
    lines.forEach((l, i) => {
      const qty = toNumber(l.quantity);
      if (!Number.isInteger(qty) || qty <= 0) errs[`items.${i}.quantity`] = 'Cantidad entera mayor a cero';
      const cost = toNumber(l.unitCost);
      if (!l.unitCost || Number.isNaN(cost) || cost < 0) errs[`items.${i}.unitCost`] = 'Costo inválido';
      if (l.discount && (Number.isNaN(toNumber(l.discount)) || toNumber(l.discount) < 0)) errs[`items.${i}.discount`] = 'Descuento inválido';
      else if (toNumber(l.discount || '0') > qty * cost) errs[`items.${i}.discount`] = 'Mayor que el importe';
      if (receiving || l.lotNumber || l.expiresAt) {
        if (!l.lotNumber.trim()) errs[`items.${i}.lotNumber`] = 'Captura el lote';
        if (!l.expiresAt) errs[`items.${i}.expiresAt`] = 'Captura la caducidad';
        else if (l.expiresAt < today) errs[`items.${i}.expiresAt`] = 'Lote caducado';
      }
    });
    return errs;
  };

  const submit = async (receiving: boolean, e?: FormEvent) => {
    e?.preventDefault();
    setFormError(null);
    const errs = validate(receiving);
    setErrors(errs);
    if (Object.keys(errs).length) {
      setFormError(receiving ? 'Revisa los datos marcados. Para recibir, cada producto necesita lote y caducidad.' : 'Revisa los datos marcados.');
      return;
    }
    const input: PurchaseInput = {
      supplierId,
      invoiceNumber: invoiceNumber.trim() || null,
      purchaseDate,
      paymentMethod,
      paymentDueDate: paymentMethod === 'CREDIT' && paymentDueDate ? paymentDueDate : null,
      notes: notes.trim() || null,
      items: lines.map((l) => ({
        productId: l.productId,
        lotNumber: l.lotNumber.trim() || null,
        expiresAt: l.expiresAt || null,
        quantity: toNumber(l.quantity),
        unitCost: toNumber(l.unitCost),
        discount: toNumber(l.discount || '0'),
        taxRate: l.taxRate,
      })),
    };
    try {
      let saved = await save.mutateAsync({ id: purchase?.id, input, receive: receiving });
      if (purchase && receiving) saved = await receive.mutateAsync(saved.id);
      toast.success(
        receiving
          ? `Compra ${saved.folio} recibida: ${lines.reduce((s, l) => s + toNumber(l.quantity), 0)} unidad(es) ingresadas al inventario`
          : `Compra ${saved.folio} guardada como pendiente de recibir`,
      );
      navigate(`/compras/historial/${saved.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors());
        setFormError(err.message);
      } else setFormError('No se pudo guardar la compra.');
    }
  };

  const busy = save.isPending || receive.isPending;

  return (
    <form onSubmit={(e) => submit(false, e)} noValidate>
      <ButtonLink to={purchase ? `/compras/historial/${purchase.id}` : '/compras/historial'} variant="ghost" size="sm" className="-ml-2 mb-3" icon={<ArrowLeft className="size-4" />}>
        {purchase ? purchase.folio : 'Compras'}
      </ButtonLink>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight text-slate-900">{purchase ? `Editar compra ${purchase.folio}` : 'Nueva compra'}</h1>
      <p className="mb-6 text-sm text-slate-500">
        Captura la factura del proveedor. Si la mercancía ya llegó, recíbela para ingresarla al inventario con sus lotes y caducidades.
      </p>

      {formError && (
        <Alert tone="error" className="mb-4">
          {formError}
        </Alert>
      )}

      <Card className="mb-6 p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SelectField
            label="Proveedor"
            className="sm:col-span-2"
            value={supplierId}
            error={errors.supplierId}
            onChange={(e) => {
              setSupplierId(e.target.value);
              const s = suppliers.data?.find((x) => x.id === e.target.value);
              if (s) setPaymentMethod(s.creditDays > 0 ? 'CREDIT' : 'CASH');
            }}
          >
            <option value="">Selecciona…</option>
            {purchase && !suppliers.data?.some((s) => s.id === purchase.supplier.id) && <option value={purchase.supplier.id}>{purchase.supplier.tradeName}</option>}
            {suppliers.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.tradeName}
              </option>
            ))}
          </SelectField>
          <TextField label="Folio de factura (opcional)" autoComplete="off" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} error={errors.invoiceNumber} />
          <TextField label="Fecha de compra" type="date" max={today} value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} error={errors.purchaseDate} />
          <SelectField label="Forma de pago" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m === 'CREDIT' ? 'Crédito (pago posterior)' : `${PAYMENT_METHOD_LABELS[m]} (contado)`}
              </option>
            ))}
          </SelectField>
          {paymentMethod === 'CREDIT' && (
            <TextField
              label="Vence el (opcional)"
              type="date"
              min={purchaseDate}
              value={paymentDueDate}
              onChange={(e) => setPaymentDueDate(e.target.value)}
              hint={suggestedDueDate ? `Si lo dejas vacío: ${formatDate(suggestedDueDate)} (${supplier?.creditDays} días de crédito)` : undefined}
              error={errors.paymentDueDate}
            />
          )}
          <TextField label="Notas (opcional)" className={paymentMethod === 'CREDIT' ? 'lg:col-span-2' : 'sm:col-span-2 lg:col-span-3'} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </Card>

      <Card className="mb-6">
        <CardHeader title="Productos" description="Escanea el código de barras o busca el producto. El costo es por unidad y sin IVA." />
        <div className="border-b border-slate-100 px-5 pb-5">
          <ProductPicker label="Agregar producto" clearOnSelect onSelect={addProduct} autoFocus={!purchase} />
          {errors.items && <p className="mt-2 text-sm text-red-600">{errors.items}</p>}
        </div>

        {lines.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">Aún no hay productos en esta compra.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {lines.map((l, i) => {
              const a = amounts[i]!;
              const err = (f: string) => errors[`items.${i}.${f}`];
              const days = l.expiresAt ? daysUntil(l.expiresAt, today) : null;
              const costAboveSale = l.netSalePrice !== null && a.netUnitCost > 0 && a.netUnitCost >= l.netSalePrice;
              return (
                <li key={l.key} className="space-y-3 px-5 py-4" data-testid="purchase-line">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium text-slate-900">
                      <span className="mr-2 text-xs text-slate-400">{i + 1}.</span>
                      {l.name}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Quitar ${l.name}`}
                      onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                      icon={<Trash2 className="size-4" />}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-[1.3fr_1.2fr_0.7fr_0.9fr_0.9fr_auto]">
                    <TextField
                      id={`${l.key}-lot`}
                      label="Lote"
                      autoComplete="off"
                      value={l.lotNumber}
                      onChange={(e) => updateLine(l.key, 'lotNumber', e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
                      error={err('lotNumber')}
                    />
                    <TextField label="Caducidad" type="date" min={today} value={l.expiresAt} onChange={(e) => updateLine(l.key, 'expiresAt', e.target.value)} error={err('expiresAt')} />
                    <TextField label="Cantidad" inputMode="numeric" value={l.quantity} onChange={(e) => updateLine(l.key, 'quantity', e.target.value)} error={err('quantity')} />
                    <TextField label="Costo unitario" inputMode="decimal" icon={<span className="text-sm">$</span>} value={l.unitCost} onChange={(e) => updateLine(l.key, 'unitCost', e.target.value)} error={err('unitCost')} />
                    <TextField label="Descuento" inputMode="decimal" icon={<span className="text-sm">$</span>} value={l.discount} placeholder="0.00" onChange={(e) => updateLine(l.key, 'discount', e.target.value)} error={err('discount')} />
                    <div className="col-span-2 flex flex-col justify-end md:col-span-1 md:min-w-28 md:text-right">
                      <p className="text-xs text-slate-500">Importe{l.taxRate > 0 ? ` + IVA ${Math.round(l.taxRate * 100)} %` : ''}</p>
                      <p className="h-11 content-center font-semibold tabular-nums text-slate-900">{formatMoney(a.total)}</p>
                    </div>
                  </div>
                  {(days !== null && days >= 0 && days < CRITICAL_DAYS) || costAboveSale ? (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-amber-700">
                      {days !== null && days >= 0 && days < CRITICAL_DAYS && (
                        <span className="flex items-center gap-1">
                          <AlertTriangle className="size-3.5" /> Caduca en {days} días: revisa si conviene recibirlo
                        </span>
                      )}
                      {costAboveSale && (
                        <span className="flex items-center gap-1">
                          <AlertTriangle className="size-3.5" /> El costo ({formatMoney(a.netUnitCost)}) iguala o supera el precio de venta sin IVA
                        </span>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {lines.length > 0 && (
          <dl className="ml-auto max-w-xs space-y-1 border-t border-slate-100 px-5 py-4 text-sm">
            <div className="flex justify-between text-slate-600">
              <dt>Subtotal</dt>
              <dd className="tabular-nums">{formatMoney(totals.subtotal)}</dd>
            </div>
            {totals.discountTotal > 0 && (
              <div className="flex justify-between text-slate-600">
                <dt>Descuento</dt>
                <dd className="tabular-nums">−{formatMoney(totals.discountTotal)}</dd>
              </div>
            )}
            <div className="flex justify-between text-slate-600">
              <dt>IVA</dt>
              <dd className="tabular-nums">{formatMoney(totals.taxTotal)}</dd>
            </div>
            <div className={clsx('flex justify-between border-t border-slate-200 pt-2 text-base font-semibold text-slate-900')}>
              <dt>Total</dt>
              <dd className="tabular-nums" data-testid="purchase-total">
                {formatMoney(totals.total)}
              </dd>
            </div>
          </dl>
        )}
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="submit" variant="secondary" loading={save.isPending && !receive.isPending} disabled={busy} icon={<Save className="size-4" />}>
          {purchase ? 'Guardar cambios' : 'Guardar como pendiente'}
        </Button>
        {canReceive && (
          <Button onClick={() => submit(true)} loading={busy} icon={<PackageCheck className="size-4" />}>
            Guardar y recibir mercancía
          </Button>
        )}
      </div>
      {canReceive && (
        <p className="mt-2 text-right text-xs text-slate-500">
          Recibir ingresa los lotes al inventario y actualiza el último costo de cada producto. {paymentMethod !== 'CREDIT' && can('purchases.pay') ? 'Al ser de contado, queda pagada.' : ''}
        </p>
      )}
    </form>
  );
}
