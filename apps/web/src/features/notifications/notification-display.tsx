import type { NotificationSeverity, NotificationType } from '@farmacia/shared';
import { clsx } from 'clsx';
import { AlertTriangle, CalendarClock, CalendarX2, Info, PackageX, Truck, Undo2, Wallet } from 'lucide-react';

const ICONS: Record<NotificationType, typeof Info> = {
  OUT_OF_STOCK: PackageX,
  LOW_STOCK: AlertTriangle,
  EXPIRING_SOON: CalendarClock,
  EXPIRED: CalendarX2,
  PURCHASE_PENDING: Truck,
  SUPPLIER_PAYMENT_DUE: Wallet,
  INVENTORY_ANOMALY: Undo2,
  SYSTEM: Info,
};

const TONES: Record<NotificationSeverity, string> = {
  CRITICAL: 'bg-red-50 text-red-600',
  WARNING: 'bg-amber-50 text-amber-600',
  INFO: 'bg-accent-50 text-accent-600',
};

export function NotificationIcon({ type, severity, className }: { type: NotificationType; severity: NotificationSeverity; className?: string }) {
  const Icon = ICONS[type];
  return (
    <span className={clsx('flex size-9 shrink-0 items-center justify-center rounded-lg', TONES[severity], className)}>
      <Icon className="size-4" />
    </span>
  );
}
