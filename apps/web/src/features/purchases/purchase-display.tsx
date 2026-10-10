import { PAYMENT_STATUS_LABELS, PURCHASE_STATUS_LABELS, type PaymentStatus, type PurchaseStatus } from '@farmacia/shared';
import { Badge, type BadgeTone } from '../../components/ui/Badge';

const STATUS_TONES: Record<PurchaseStatus, BadgeTone> = {
  DRAFT: 'neutral',
  ORDERED: 'blue',
  RECEIVED: 'green',
  CANCELLED: 'neutral',
};

export function PurchaseStatusBadge({ status }: { status: PurchaseStatus }) {
  return <Badge tone={STATUS_TONES[status]}>{PURCHASE_STATUS_LABELS[status]}</Badge>;
}

const PAYMENT_TONES: Record<PaymentStatus, BadgeTone> = { PENDING: 'amber', PARTIAL: 'violet', PAID: 'green' };

/** Estado de pago; una compra cancelada no se cobra. */
export function PaymentStatusBadge({ status, overdue, cancelled }: { status: PaymentStatus; overdue?: boolean; cancelled?: boolean }) {
  if (cancelled) return null;
  if (overdue) return <Badge tone="red">Vencida</Badge>;
  return <Badge tone={PAYMENT_TONES[status]}>{PAYMENT_STATUS_LABELS[status]}</Badge>;
}
