import { ADJUSTMENT_REASON_LABELS, REASONS_BY_DIRECTION, type AdjustmentDirection, type AdjustmentReason } from '@farmacia/shared';
import { clsx } from 'clsx';
import { ArrowRight, ClipboardCheck, Minus, Plus } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../../api/client';
import { useAdjustBatch, type Batch } from '../../api/inventory';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { TextAreaField, TextField } from '../../components/ui/FormField';
import { Modal } from '../../components/ui/Modal';
import { SelectField } from '../../components/ui/SelectField';
import { useToast } from '../../components/ui/Toast';
import { formatDate } from '../../lib/format';

type Mode = 'OUT' | 'IN' | 'COUNT';

const MODES: { mode: Mode; label: string; icon: typeof Minus; hint: string }[] = [
  { mode: 'OUT', label: 'Salida', icon: Minus, hint: 'Retirar unidades (daño, caducidad, pérdida...)' },
  { mode: 'IN', label: 'Entrada', icon: Plus, hint: 'Sumar unidades a este lote' },
  { mode: 'COUNT', label: 'Conteo físico', icon: ClipboardCheck, hint: 'Captura lo que hay en el anaquel' },
];

export function AdjustDialog({
  batch,
  onClose,
  preset,
}: {
  batch: Batch | null;
  onClose: () => void;
  /** Salida prellenada, p. ej. dar de baja un lote caducado completo */
  preset?: { reason: AdjustmentReason; quantity?: number };
}) {
  const toast = useToast();
  const adjust = useAdjustBatch();
  const [mode, setMode] = useState<Mode>('OUT');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState<AdjustmentReason | ''>('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!batch) return;
    setMode('OUT');
    setQuantity(preset?.quantity ? String(preset.quantity) : '');
    setReason(preset?.reason ?? '');
    setNotes('');
    setErrors({});
    setFormError(null);
    // Sólo al abrir con otro lote: el preset llega junto con él
  }, [batch]);

  if (!batch) return null;

  const n = Number(quantity);
  const valid = quantity !== '' && Number.isInteger(n) && n >= 0;
  // En conteo físico la cantidad es lo contado; la diferencia define el sentido
  const change = !valid ? 0 : mode === 'COUNT' ? n - batch.quantity : mode === 'IN' ? n : -n;
  const direction: AdjustmentDirection = change >= 0 ? 'IN' : 'OUT';
  const after = batch.quantity + change;
  const reasons = mode === 'COUNT' ? [] : REASONS_BY_DIRECTION[mode];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!valid || (mode !== 'COUNT' && n === 0)) errs.quantity = 'Captura una cantidad entera mayor a cero';
    else if (mode === 'COUNT' && change === 0) errs.quantity = 'El conteo coincide con el sistema: no hay nada que ajustar';
    else if (after < 0) errs.quantity = `Sólo hay ${batch.quantity} unidad(es) en este lote`;
    const finalReason: AdjustmentReason | '' = mode === 'COUNT' ? 'INVENTORY_CORRECTION' : reason;
    if (!finalReason) errs.reason = 'Selecciona el motivo';
    if (finalReason === 'OTHER' && !notes.trim()) errs.notes = 'Describe el motivo';
    setErrors(errs);
    if (Object.keys(errs).length || !finalReason) return;

    try {
      const movement = await adjust.mutateAsync({
        batchId: batch.id,
        direction,
        quantity: Math.abs(change),
        reason: finalReason,
        notes: notes.trim() || (mode === 'COUNT' ? `Conteo físico: ${n} unidad(es)` : null),
      });
      toast.success(`Lote ${batch.lotNumber}: ${movement.quantityBefore} → ${movement.quantityAfter} unidades`);
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        const fields = err.fieldErrors();
        if (Object.keys(fields).length) setErrors(fields);
        else setFormError(err.message);
      } else setFormError('No se pudo registrar el ajuste.');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      busy={adjust.isPending}
      title="Ajustar inventario"
      description={`${batch.product.commercialName} · Lote ${batch.lotNumber} · Caduca ${formatDate(batch.expiresAt)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={adjust.isPending}>
            Cancelar
          </Button>
          <Button type="submit" form="adjust-form" loading={adjust.isPending} variant={direction === 'OUT' && change < 0 ? 'danger' : 'primary'}>
            Registrar ajuste
          </Button>
        </>
      }
    >
      <form id="adjust-form" onSubmit={submit} noValidate className="space-y-4">
        {formError && <Alert tone="error">{formError}</Alert>}

        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Tipo de ajuste">
          {MODES.map(({ mode: m, label, icon: Icon }) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => {
                setMode(m);
                setReason('');
                setErrors({});
              }}
              className={clsx(
                'flex flex-col items-center gap-1 rounded-lg px-2 py-3 text-sm font-medium ring-1 ring-inset transition',
                mode === m ? 'bg-brand-50 text-brand-800 ring-brand-500' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50',
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500">{MODES.find((m) => m.mode === mode)!.hint}</p>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={mode === 'COUNT' ? 'Unidades contadas' : 'Cantidad'}
            inputMode="numeric"
            autoFocus
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            error={errors.quantity}
          />
          {mode !== 'COUNT' && (
            <SelectField label="Motivo" value={reason} onChange={(e) => setReason(e.target.value as AdjustmentReason)} error={errors.reason}>
              <option value="">Selecciona…</option>
              {reasons.map((r) => (
                <option key={r} value={r}>
                  {ADJUSTMENT_REASON_LABELS[r]}
                </option>
              ))}
            </SelectField>
          )}
        </div>

        <div className="flex items-center justify-center gap-4 rounded-lg bg-slate-50 py-3 text-sm" aria-live="polite">
          <div className="text-center">
            <p className="text-xs text-slate-500">Ahora</p>
            <p className="text-lg font-semibold tabular-nums text-slate-900">{batch.quantity}</p>
          </div>
          <ArrowRight className="size-4 text-slate-400" />
          <div className="text-center">
            <p className="text-xs text-slate-500">Después</p>
            <p className={clsx('text-lg font-semibold tabular-nums', after < 0 ? 'text-red-600' : 'text-slate-900')}>
              {valid ? after : '—'}
            </p>
          </div>
          {valid && change !== 0 && (
            <span className={clsx('rounded-full px-2 py-0.5 text-xs font-semibold', change > 0 ? 'bg-brand-100 text-brand-800' : 'bg-red-100 text-red-700')}>
              {change > 0 ? `+${change}` : change}
            </span>
          )}
        </div>

        <TextAreaField
          label={reason === 'OTHER' ? 'Observaciones (obligatorio)' : 'Observaciones (opcional)'}
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          error={errors.notes}
        />
        <p className="text-xs text-slate-500">El ajuste queda registrado con tu usuario, la fecha y la hora; no se puede borrar.</p>
      </form>
    </Modal>
  );
}
