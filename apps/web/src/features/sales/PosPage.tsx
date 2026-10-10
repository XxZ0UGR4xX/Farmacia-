import { cashChange, saleLineAmounts, saleTotals, type SalePaymentMethod } from '@farmacia/shared';
import { clsx } from 'clsx';
import { AlertTriangle, Banknote, Camera, CreditCard, Landmark, Minus, Plus, Printer, Receipt, Search, ShoppingCart, Split, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { findProductByBarcode, useCatalogDefaults, useProducts, type Product } from '../../api/catalog';
import { api, ApiError } from '../../api/client';
import { useCreateSale, type CreateSaleInput, type Sale } from '../../api/sales';
import { useAuth } from '../../auth/useAuth';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Checkbox, TextField } from '../../components/ui/FormField';
import { Modal } from '../../components/ui/Modal';
import { useToast } from '../../components/ui/Toast';
import { formatMoney } from '../../lib/format';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { productDetails } from '../products/product-display';
import { BarcodeScannerDialog } from './BarcodeScannerDialog';
import { PrintableTicket } from './Ticket';

interface CartLine {
  productId: string;
  name: string;
  details: string;
  unitPrice: number;
  taxRate: number;
  stock: number;
  quantity: number;
  discount: string;
  requiresPrescription: boolean;
  error?: string;
}

type PayMode = 'CASH' | 'CARD' | 'TRANSFER' | 'MIXED';

const CART_KEY = 'pos-cart-v1';
const toNumber = (v: string) => Number(v.replace(',', '.')) || 0;

function loadCart(): CartLine[] {
  try {
    const raw = sessionStorage.getItem(CART_KEY);
    return raw ? (JSON.parse(raw) as CartLine[]) : [];
  } catch {
    return [];
  }
}

function lineFrom(p: Product): CartLine {
  return {
    productId: p.id,
    name: [p.commercialName, p.concentration && !p.commercialName.includes(p.concentration) ? p.concentration : null].filter(Boolean).join(' '),
    details: productDetails(p),
    unitPrice: p.salePrice,
    taxRate: p.taxRate,
    stock: p.stock,
    quantity: 1,
    discount: '',
    requiresPrescription: p.requiresPrescription || p.isControlled,
  };
}

const PAY_MODES: { mode: PayMode; label: string; icon: typeof Banknote }[] = [
  { mode: 'CASH', label: 'Efectivo', icon: Banknote },
  { mode: 'CARD', label: 'Tarjeta', icon: CreditCard },
  { mode: 'TRANSFER', label: 'Transferencia', icon: Landmark },
  { mode: 'MIXED', label: 'Mixto', icon: Split },
];

export function PosPage() {
  const { can } = useAuth();
  const toast = useToast();
  const createSale = useCreateSale();
  const defaults = useCatalogDefaults();
  const pricesIncludeTax = defaults.data?.taxes.pricesIncludeTax ?? true;
  const canDiscount = can('sales.discount');

  const [cart, setCart] = useState<CartLine[]>(loadCart);
  const [search, setSearch] = useState('');
  const [payMode, setPayMode] = useState<PayMode>('CASH');
  const [cashReceived, setCashReceived] = useState('');
  const [cardAmount, setCardAmount] = useState('');
  const [reference, setReference] = useState('');
  const [prescriptionChecked, setPrescriptionChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [completed, setCompleted] = useState<Sale | null>(null);
  const [printing, setPrinting] = useState<Sale | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const requestId = useRef<string>(crypto.randomUUID());
  const q = useDebouncedValue(search.trim(), 200);
  const results = useProducts({ q, page: 1, pageSize: 8, status: 'ACTIVE' });
  const showResults = q.length > 0 && !/^\d{6,}$/.test(q);

  // El carrito sobrevive a una recarga accidental de la página
  useEffect(() => {
    try {
      sessionStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch {
      /* almacenamiento no disponible */
    }
  }, [cart]);

  const totals = useMemo(
    () => saleTotals(cart.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discount: toNumber(l.discount), taxRate: l.taxRate })), pricesIncludeTax),
    [cart, pricesIncludeTax],
  );
  const needsPrescription = cart.some((l) => l.requiresPrescription);

  // Pagos según la forma elegida
  const received = toNumber(cashReceived);
  const card = Math.min(toNumber(cardAmount), totals.total);
  const cashPart = payMode === 'MIXED' ? Math.round((totals.total - card) * 100) / 100 : totals.total;
  const cashOk = payMode === 'CARD' || payMode === 'TRANSFER' || cashPart === 0 || received + 0.005 >= cashPart;
  const change = payMode === 'CASH' || payMode === 'MIXED' ? cashChange(received, cashPart) : 0;
  const lineErrors = cart.some((l) => toNumber(l.discount) > l.quantity * l.unitPrice);
  const canCharge = cart.length > 0 && totals.total > 0 && cashOk && !lineErrors && (!needsPrescription || prescriptionChecked) && !createSale.isPending;

  const focusSearch = () => searchRef.current?.focus();

  const addProduct = useCallback(
    (p: Product) => {
      setError(null);
      // Siempre se limpia el buscador: el siguiente escaneo no debe pegarse al anterior
      setSearch('');
      focusSearch();
      if (p.stock <= 0) {
        toast.error(`${p.commercialName}: sin existencia disponible`);
        return;
      }
      setCart((lines) => {
        const existing = lines.find((l) => l.productId === p.id);
        if (!existing) return [...lines, lineFrom(p)];
        if (existing.quantity >= p.stock) {
          toast.error(`Sólo hay ${p.stock} unidad(es) de ${p.commercialName}`);
          return lines;
        }
        return lines.map((l) => (l.productId === p.id ? { ...l, quantity: l.quantity + 1, stock: p.stock, error: undefined } : l));
      });
    },
    [toast],
  );

  const addByBarcode = useCallback(
    async (code: string) => {
      try {
        addProduct(await findProductByBarcode(code));
      } catch {
        toast.error(`No hay ningún producto con el código ${code}`);
        setSearch('');
      }
    },
    [addProduct, toast],
  );

  const updateLine = (productId: string, patch: Partial<CartLine>) =>
    setCart((lines) => lines.map((l) => (l.productId === productId ? { ...l, ...patch, error: undefined } : l)));

  const setQuantity = (line: CartLine, value: number) => {
    if (!Number.isFinite(value) || value < 1) return updateLine(line.productId, { quantity: 1 });
    if (value > line.stock) {
      toast.error(`Sólo hay ${line.stock} unidad(es) de ${line.name}`);
      return updateLine(line.productId, { quantity: line.stock });
    }
    updateLine(line.productId, { quantity: Math.floor(value) });
  };

  const resetSale = () => {
    setCart([]);
    setPayMode('CASH');
    setCashReceived('');
    setCardAmount('');
    setReference('');
    setPrescriptionChecked(false);
    setError(null);
    requestId.current = crypto.randomUUID();
  };

  /** Si cambió un precio o la existencia, se actualiza el carrito con lo vigente. */
  const refreshCart = async () => {
    const fresh = await Promise.all(cart.map((l) => api.get<{ product: Product }>(`/products/${l.productId}`).then((r) => r.product).catch(() => null)));
    setCart((lines) =>
      lines.map((l, i) => {
        const p = fresh[i];
        return p ? { ...l, unitPrice: p.salePrice, taxRate: p.taxRate, stock: p.stock, quantity: Math.min(l.quantity, Math.max(1, p.stock)) } : l;
      }),
    );
  };

  const charge = async () => {
    if (!canCharge) return;
    setError(null);
    const payments: CreateSaleInput['payments'] =
      payMode === 'CASH'
        ? [{ method: 'CASH', amount: totals.total, received: received || totals.total }]
        : payMode === 'MIXED'
          ? [
              ...(card > 0 ? [{ method: 'CARD' as SalePaymentMethod, amount: card, reference: reference.trim() || null }] : []),
              ...(cashPart > 0 ? [{ method: 'CASH' as SalePaymentMethod, amount: cashPart, received: received || cashPart }] : []),
            ]
          : [{ method: payMode, amount: totals.total, reference: reference.trim() || null }];
    try {
      const sale = await createSale.mutateAsync({
        clientRequestId: requestId.current,
        items: cart.map((l) => ({ productId: l.productId, quantity: l.quantity, discount: toNumber(l.discount) })),
        payments,
        prescriptionChecked,
        expectedTotal: totals.total,
      });
      resetSale();
      setCompleted(sale);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          await refreshCart();
          setError('Los precios cambiaron mientras se capturaba la venta. Ya se actualizó el carrito: revisa el total y cobra de nuevo.');
          requestId.current = crypto.randomUUID();
          return;
        }
        const fields = err.fieldErrors();
        const indexed = Object.entries(fields).filter(([k]) => k.startsWith('items.'));
        if (indexed.length) {
          setCart((lines) => lines.map((l, i) => ({ ...l, error: fields[`items.${i}.quantity`] ?? fields[`items.${i}.productId`] ?? fields[`items.${i}.discount`] })));
          await refreshCart();
        }
        setError(err.message);
      } else setError('No se pudo registrar la venta. Revisa la conexión e intenta de nuevo: no se cobrará dos veces.');
    }
  };

  const printTicket = (sale: Sale) => {
    setPrinting(sale);
    // Espera a que el ticket se monte antes de abrir el diálogo de impresión
    setTimeout(() => window.print(), 50);
  };

  // Atajos: F2 buscar, F9 cobrar
  const chargeRef = useRef(charge);
  chargeRef.current = charge;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        focusSearch();
      } else if (e.key === 'F9') {
        e.preventDefault();
        void chargeRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const quickBills = [...new Set([cashPart, 50, 100, 200, 500, 1000].filter((b) => b >= cashPart && b > 0))].slice(0, 5);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Punto de venta</h1>
          <p className="text-sm text-slate-500">
            Escanea o busca los productos. <kbd className="rounded border border-slate-300 px-1 text-xs">F2</kbd> buscar ·{' '}
            <kbd className="rounded border border-slate-300 px-1 text-xs">F9</kbd> cobrar
          </p>
        </div>
        {cart.length > 0 && (
          <Button variant="ghost" size="sm" onClick={resetSale} icon={<Trash2 className="size-4" />}>
            Vaciar venta
          </Button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex gap-2">
              <TextField
                ref={searchRef}
                className="flex-1"
                label="Producto"
                placeholder="Escanea el código o escribe el nombre"
                autoFocus
                autoComplete="off"
                icon={<Search className="size-4" />}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  const code = search.trim();
                  if (/^\d{6,}$/.test(code)) void addByBarcode(code);
                  else if (results.data?.data.length === 1 && q === code) addProduct(results.data.data[0]!);
                }}
              />
              <Button variant="secondary" className="mt-6 shrink-0" aria-label="Escanear con la cámara" onClick={() => setScanning(true)} icon={<Camera className="size-5" />} />
            </div>
            {showResults && (
              <ul className="mt-2 max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                {results.data?.data.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">Sin resultados</li>}
                {results.data?.data.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => addProduct(p)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-brand-50">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-slate-900">{p.commercialName}</span>
                        <span className="block text-xs text-slate-500">{productDetails(p)}</span>
                      </span>
                      <span className="text-right">
                        <span className="block text-sm font-semibold tabular-nums text-slate-900">{formatMoney(p.salePrice)}</span>
                        <span className={clsx('block text-xs', p.stock > 0 ? 'text-slate-500' : 'font-medium text-red-600')}>
                          {p.stock > 0 ? `${p.stock} disp.` : 'Sin existencia'}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="overflow-hidden">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-slate-400">
                <ShoppingCart className="size-10" />
                <p className="text-sm">La venta está vacía. Escanea un producto para empezar.</p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {cart.map((l) => {
                  const a = saleLineAmounts({ quantity: l.quantity, unitPrice: l.unitPrice, discount: toNumber(l.discount), taxRate: l.taxRate }, pricesIncludeTax);
                  const discountTooHigh = toNumber(l.discount) > l.quantity * l.unitPrice;
                  return (
                    <li key={l.productId} className="space-y-2 p-4" data-testid="cart-line">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900">{l.name}</p>
                          <p className="text-xs text-slate-500">
                            {formatMoney(l.unitPrice)} c/u · {l.stock} disponible(s)
                          </p>
                          {l.requiresPrescription && (
                            <Badge tone="amber" className="mt-1">
                              Requiere receta
                            </Badge>
                          )}
                        </div>
                        <p className="shrink-0 text-lg font-semibold tabular-nums text-slate-900">{formatMoney(a.total)}</p>
                      </div>
                      <div className="flex flex-wrap items-end gap-3">
                        <div className="flex items-center rounded-lg border border-slate-300">
                          <button type="button" className="p-2.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40" aria-label={`Quitar una unidad de ${l.name}`} disabled={l.quantity <= 1} onClick={() => setQuantity(l, l.quantity - 1)}>
                            <Minus className="size-4" />
                          </button>
                          <input
                            aria-label={`Cantidad de ${l.name}`}
                            inputMode="numeric"
                            className="w-14 border-x border-slate-300 py-2 text-center text-sm tabular-nums focus:outline-none"
                            value={l.quantity}
                            onChange={(e) => setQuantity(l, Number(e.target.value))}
                          />
                          <button type="button" className="p-2.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40" aria-label={`Agregar una unidad de ${l.name}`} disabled={l.quantity >= l.stock} onClick={() => setQuantity(l, l.quantity + 1)}>
                            <Plus className="size-4" />
                          </button>
                        </div>
                        {canDiscount && (
                          <TextField
                            className="w-32"
                            label="Descuento"
                            inputMode="decimal"
                            placeholder="0.00"
                            icon={<span className="text-sm">$</span>}
                            value={l.discount}
                            onChange={(e) => updateLine(l.productId, { discount: e.target.value })}
                            error={discountTooHigh ? 'Mayor al importe' : undefined}
                          />
                        )}
                        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setCart((ls) => ls.filter((x) => x.productId !== l.productId))} icon={<Trash2 className="size-4" />}>
                          Quitar
                        </Button>
                      </div>
                      {l.error && <p className="text-sm font-medium text-red-600">{l.error}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <Card className="h-fit space-y-4 p-4 lg:sticky lg:top-20">
          <dl className="space-y-1 text-sm">
            {totals.discountTotal > 0 && (
              <>
                <div className="flex justify-between text-slate-600">
                  <dt>Importe</dt>
                  <dd className="tabular-nums">{formatMoney(totals.gross)}</dd>
                </div>
                <div className="flex justify-between text-slate-600">
                  <dt>Descuento</dt>
                  <dd className="tabular-nums">−{formatMoney(totals.discountTotal)}</dd>
                </div>
              </>
            )}
            <div className="flex justify-between text-slate-600">
              <dt>Subtotal</dt>
              <dd className="tabular-nums">{formatMoney(totals.subtotal)}</dd>
            </div>
            <div className="flex justify-between text-slate-600">
              <dt>IVA{pricesIncludeTax ? ' (incluido)' : ''}</dt>
              <dd className="tabular-nums">{formatMoney(totals.taxTotal)}</dd>
            </div>
            <div className="flex items-baseline justify-between border-t border-slate-200 pt-2">
              <dt className="font-semibold text-slate-900">Total</dt>
              <dd className="text-3xl font-bold tabular-nums text-slate-900" data-testid="pos-total">
                {formatMoney(totals.total)}
              </dd>
            </div>
          </dl>

          <div className="grid grid-cols-4 gap-1" role="radiogroup" aria-label="Forma de pago">
            {PAY_MODES.map(({ mode, label, icon: Icon }) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={payMode === mode}
                onClick={() => setPayMode(mode)}
                className={clsx(
                  'flex flex-col items-center gap-1 rounded-lg border px-1 py-2 text-xs font-medium transition',
                  payMode === mode ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                )}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </div>

          {payMode === 'MIXED' && (
            <TextField label="Con tarjeta" inputMode="decimal" icon={<span className="text-sm">$</span>} value={cardAmount} onChange={(e) => setCardAmount(e.target.value)} hint={`En efectivo: ${formatMoney(cashPart)}`} />
          )}
          {(payMode === 'CARD' || payMode === 'TRANSFER' || (payMode === 'MIXED' && card > 0)) && (
            <TextField
              label={payMode === 'TRANSFER' ? 'Folio de transferencia (opcional)' : 'Autorización o últimos 4 dígitos (opcional)'}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          )}
          {(payMode === 'CASH' || (payMode === 'MIXED' && cashPart > 0)) && (
            <div className="space-y-2">
              <TextField label="Efectivo recibido" inputMode="decimal" icon={<span className="text-sm">$</span>} value={cashReceived} onChange={(e) => setCashReceived(e.target.value)} />
              {cashPart > 0 && (
                <div className="flex flex-wrap gap-1">
                  {quickBills.map((b) => (
                    <button key={b} type="button" onClick={() => setCashReceived(String(b))} className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
                      {b === cashPart ? 'Exacto' : formatMoney(b)}
                    </button>
                  ))}
                </div>
              )}
              {received > 0 && (
                <p className={clsx('flex justify-between rounded-lg px-3 py-2 text-lg font-semibold', cashOk ? 'bg-brand-50 text-brand-800' : 'bg-red-50 text-red-700')}>
                  <span>{cashOk ? 'Cambio' : 'Falta'}</span>
                  <span className="tabular-nums" data-testid="pos-change">
                    {formatMoney(cashOk ? change : cashPart - received)}
                  </span>
                </p>
              )}
            </div>
          )}

          {needsPrescription && (
            <div className="rounded-lg bg-amber-50 p-3 ring-1 ring-amber-200">
              <p className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-900">
                <AlertTriangle className="size-4" /> Esta venta incluye productos con receta médica
              </p>
              <Checkbox label="Revisé la receta médica del paciente" checked={prescriptionChecked} onChange={(e) => setPrescriptionChecked(e.target.checked)} />
            </div>
          )}

          {error && <Alert tone="error">{error}</Alert>}

          <Button fullWidth size="lg" onClick={charge} disabled={!canCharge} loading={createSale.isPending} icon={<Receipt className="size-5" />}>
            Cobrar {totals.total > 0 ? formatMoney(totals.total) : ''}
          </Button>
        </Card>
      </div>

      <BarcodeScannerDialog
        open={scanning}
        onClose={() => setScanning(false)}
        onDetected={(code) => {
          setScanning(false);
          void addByBarcode(code);
        }}
      />

      <Modal
        open={completed !== null}
        onClose={() => {
          setCompleted(null);
          focusSearch();
        }}
        size="sm"
        title={`Venta ${completed?.folio ?? ''} registrada`}
        footer={
          <>
            <Button variant="secondary" onClick={() => completed && printTicket(completed)} icon={<Printer className="size-4" />}>
              Imprimir ticket
            </Button>
            <Button
              data-autofocus
              onClick={() => {
                setCompleted(null);
                focusSearch();
              }}
            >
              Nueva venta
            </Button>
          </>
        }
      >
        {completed && (
          <div className="space-y-2 text-center">
            <p className="text-sm text-slate-500">Total cobrado</p>
            <p className="text-3xl font-bold tabular-nums text-slate-900">{formatMoney(completed.total)}</p>
            {completed.payments.some((p) => (p.change ?? 0) > 0) && (
              <p className="rounded-lg bg-brand-50 py-3 text-xl font-semibold text-brand-800" data-testid="sale-change">
                Cambio: {formatMoney(completed.payments.reduce((s, p) => s + (p.change ?? 0), 0))}
              </p>
            )}
          </div>
        )}
      </Modal>
      <PrintableTicket sale={printing} />
    </div>
  );
}
