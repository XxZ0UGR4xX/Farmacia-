import { ADJUSTMENT_REASON_LABELS, EXPIRY_STATUS_LABELS, MOVEMENT_TYPE_LABELS, type ExpiryStatus } from '@farmacia/shared';
import { clsx } from 'clsx';
import type { InventoryStockStatus, Movement } from '../../api/inventory';
import { Badge, type BadgeTone } from '../../components/ui/Badge';
import { formatDate, formatDaysLeft } from '../../lib/format';

const expiryTone: Record<ExpiryStatus, BadgeTone> = { EXPIRED: 'red', CRITICAL: 'red', WARNING: 'amber', OK: 'green' };

/** Fecha de caducidad con días restantes y semáforo. */
export function ExpiryCell({ date, days, status }: { date: string | null; days: number | null; status: ExpiryStatus | null }) {
  if (!date || status === null) return <span className="text-slate-400">—</span>;
  return (
    <div className="space-y-1">
      <p className="whitespace-nowrap text-slate-700">{formatDate(date)}</p>
      <Badge tone={expiryTone[status]}>
        {status === 'EXPIRED' ? EXPIRY_STATUS_LABELS.EXPIRED : `${formatDaysLeft(days)} · ${EXPIRY_STATUS_LABELS[status]}`}
      </Badge>
    </div>
  );
}

const stockTone: Record<InventoryStockStatus, BadgeTone> = { OUT: 'red', LOW: 'amber', OK: 'green', OVER: 'blue' };
export const STOCK_STATUS_LABELS: Record<InventoryStockStatus, string> = {
  OUT: 'Agotado',
  LOW: 'Stock bajo',
  OK: 'Disponible',
  OVER: 'Exceso',
};

export function StockStatusBadge({ status }: { status: InventoryStockStatus }) {
  return <Badge tone={stockTone[status]}>{STOCK_STATUS_LABELS[status]}</Badge>;
}

/** Cantidad con signo: verde si entra, rojo si sale. */
export function QuantityChange({ value }: { value: number }) {
  return (
    <span className={clsx('font-semibold tabular-nums', value > 0 ? 'text-brand-700' : 'text-red-600')}>
      {value > 0 ? `+${value}` : value}
    </span>
  );
}

export function MovementLabel({ movement }: { movement: Pick<Movement, 'type' | 'reason'> }) {
  // En "dañado", "caducado" o "merma" el tipo ya dice el motivo; sólo los ajustes genéricos lo detallan
  const showReason = movement.reason && (movement.type === 'ADJUSTMENT_IN' || movement.type === 'ADJUSTMENT_OUT');
  return (
    <div>
      <p className="font-medium text-slate-800">{MOVEMENT_TYPE_LABELS[movement.type]}</p>
      {showReason && <p className="text-xs text-slate-500">{ADJUSTMENT_REASON_LABELS[movement.reason!]}</p>}
    </div>
  );
}

export const BATCH_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Disponible',
  QUARANTINE: 'En cuarentena',
  DEPLETED: 'Agotado',
  DISCARDED: 'Dado de baja',
};
