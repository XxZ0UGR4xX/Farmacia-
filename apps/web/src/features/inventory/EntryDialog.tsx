import { ADJUSTMENT_REASON_LABELS, REASONS_BY_DIRECTION, type AdjustmentReason } from '@farmacia/shared';
import { Search } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useProducts, type Product } from '../../api/catalog';
import { ApiError } from '../../api/client';
import { useRegisterEntry } from '../../api/inventory';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { TextAreaField, TextField } from '../../components/ui/FormField';
import { Modal } from '../../components/ui/Modal';
import { SelectField } from '../../components/ui/SelectField';
import { useToast } from '../../components/ui/Toast';
import { todayInputValue } from '../../lib/format';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { productDetails } from '../products/product-display';

export interface EntryProduct {
  id: string;
  commercialName: string;
  concentration: string | null;
  purchasePrice?: number;
}

/** Buscador simple de productos para elegir a cuál se le registra la entrada. */
function ProductPicker({ onSelect }: { onSelect: (p: Product) => void }) {
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search.trim(), 250);
  const results = useProducts({ q, page: 1, pageSize: 8, status: 'ACTIVE' });
  return (
    <div>
      <TextField
        label="Producto"
        placeholder="Busca por nombre o escanea el código"
        icon={<Search className="size-4" />}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => {
          // Con el lector: Enter elige el único resultado
          if (e.key === 'Enter') {
            e.preventDefault();
            const only = results.data?.data.length === 1 ? results.data.data[0] : undefined;
            if (only) onSelect(only);
          }
        }}
      />
      {q && (
        <ul className="mt-2 max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
          {results.data?.data.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">Sin resultados</li>}
          {results.data?.data.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => onSelect(p)} className="w-full px-3 py-2 text-left hover:bg-brand-50">
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

const EMPTY = { lotNumber: '', expiresAt: '', manufacturedAt: '', quantity: '', unitCost: '', type: 'INITIAL_STOCK', reason: '', notes: '' };

export function EntryDialog({
  open,
  product: initialProduct,
  showCosts,
  onClose,
}: {
  open: boolean;
  /** Si se omite, el diálogo pide elegir el producto */
  product: EntryProduct | null;
  showCosts: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const register = useRegisterEntry();
  const [product, setProduct] = useState<EntryProduct | null>(initialProduct);
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setProduct(initialProduct);
    setValues({ ...EMPTY, unitCost: initialProduct?.purchasePrice ? initialProduct.purchasePrice.toFixed(2) : '' });
    setErrors({});
    setFormError(null);
  }, [open, initialProduct]);

  const set = (field: keyof typeof EMPTY) => (value: string) => setValues((v) => ({ ...v, [field]: value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!product) errs.productId = 'Selecciona un producto';
    if (!values.lotNumber.trim()) errs.lotNumber = 'El número de lote es obligatorio';
    if (!values.expiresAt) errs.expiresAt = 'La fecha de caducidad es obligatoria';
    else if (values.expiresAt < todayInputValue()) errs.expiresAt = 'Este lote ya está caducado';
    const qty = Number(values.quantity);
    if (!Number.isInteger(qty) || qty <= 0) errs.quantity = 'Captura una cantidad entera mayor a cero';
    if (values.type === 'ADJUSTMENT_IN' && !values.reason) errs.reason = 'Indica el motivo';
    setErrors(errs);
    if (Object.keys(errs).length || !product) return;

    try {
      const result = await register.mutateAsync({
        productId: product.id,
        lotNumber: values.lotNumber.trim(),
        expiresAt: values.expiresAt,
        manufacturedAt: values.manufacturedAt || null,
        quantity: qty,
        ...(showCosts && values.unitCost ? { unitCost: Number(values.unitCost.replace(',', '.')) } : {}),
        type: values.type as 'INITIAL_STOCK' | 'ADJUSTMENT_IN',
        reason: values.type === 'ADJUSTMENT_IN' ? (values.reason as AdjustmentReason) : null,
        notes: values.notes.trim() || null,
      });
      toast.success(
        result.createdBatch
          ? `Lote ${result.batch.lotNumber} registrado con ${qty} unidad(es)`
          : `Se sumaron ${qty} unidad(es) al lote ${result.batch.lotNumber} (ahora ${result.batch.quantity})`,
      );
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        const fields = err.fieldErrors();
        if (Object.keys(fields).length) setErrors(fields);
        else setFormError(err.message);
      } else setFormError('No se pudo registrar la entrada.');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={register.isPending}
      size="md"
      title="Registrar entrada de inventario"
      description="Carga inicial de existencias o ingreso de mercancía fuera de una compra."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={register.isPending}>
            Cancelar
          </Button>
          <Button type="submit" form="entry-form" loading={register.isPending}>
            Registrar entrada
          </Button>
        </>
      }
    >
      <form id="entry-form" onSubmit={submit} noValidate className="space-y-4">
        {formError && <Alert tone="error">{formError}</Alert>}
        {product ? (
          <div className="flex items-start justify-between gap-3 rounded-lg bg-slate-50 p-3">
            <div>
              <p className="text-xs text-slate-500">Producto</p>
              <p className="font-medium text-slate-900">
                {product.commercialName}
                {product.concentration && !product.commercialName.includes(product.concentration) ? ` ${product.concentration}` : ''}
              </p>
            </div>
            {!initialProduct && (
              <Button variant="ghost" size="sm" onClick={() => setProduct(null)}>
                Cambiar
              </Button>
            )}
          </div>
        ) : (
          <>
            <ProductPicker
              onSelect={(p) => {
                setProduct(p);
                setValues((v) => ({ ...v, unitCost: p.purchasePrice ? p.purchasePrice.toFixed(2) : v.unitCost }));
              }}
            />
            {errors.productId && <p className="text-sm text-red-600">{errors.productId}</p>}
          </>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Número de lote"
            autoComplete="off"
            value={values.lotNumber}
            onChange={(e) => set('lotNumber')(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
            error={errors.lotNumber}
          />
          <TextField
            label="Cantidad (unidades)"
            inputMode="numeric"
            value={values.quantity}
            onChange={(e) => set('quantity')(e.target.value)}
            error={errors.quantity}
          />
          <TextField
            label="Fecha de caducidad"
            type="date"
            min={todayInputValue()}
            value={values.expiresAt}
            onChange={(e) => set('expiresAt')(e.target.value)}
            hint="Si el empaque sólo dice mes y año, usa el último día del mes."
            error={errors.expiresAt}
          />
          <TextField
            label="Fecha de fabricación (opcional)"
            type="date"
            max={values.expiresAt || undefined}
            value={values.manufacturedAt}
            onChange={(e) => set('manufacturedAt')(e.target.value)}
            error={errors.manufacturedAt}
          />
          {showCosts && (
            <TextField
              label="Costo unitario"
              inputMode="decimal"
              icon={<span className="text-sm">$</span>}
              value={values.unitCost}
              onChange={(e) => set('unitCost')(e.target.value)}
              hint="Se usa para valorizar el inventario."
              error={errors.unitCost}
            />
          )}
          <SelectField label="Tipo de entrada" value={values.type} onChange={(e) => set('type')(e.target.value)}>
            <option value="INITIAL_STOCK">Carga inicial de inventario</option>
            <option value="ADJUSTMENT_IN">Ajuste positivo (con motivo)</option>
          </SelectField>
          {values.type === 'ADJUSTMENT_IN' && (
            <SelectField label="Motivo" value={values.reason} onChange={(e) => set('reason')(e.target.value)} error={errors.reason}>
              <option value="">Selecciona…</option>
              {REASONS_BY_DIRECTION.IN.map((r) => (
                <option key={r} value={r}>
                  {ADJUSTMENT_REASON_LABELS[r]}
                </option>
              ))}
            </SelectField>
          )}
        </div>
        <TextAreaField label="Observaciones (opcional)" rows={2} value={values.notes} onChange={(e) => set('notes')(e.target.value)} error={errors.notes} />
      </form>
    </Modal>
  );
}
