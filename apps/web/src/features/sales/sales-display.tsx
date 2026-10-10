import { PAYMENT_METHOD_LABELS, SALE_STATUS_LABELS, type SalePaymentMethod, type SaleStatus } from '@farmacia/shared';
import { Badge, type BadgeTone } from '../../components/ui/Badge';

const TONES: Record<SaleStatus, BadgeTone> = { COMPLETED: 'green', CANCELLED: 'neutral', PARTIALLY_RETURNED: 'amber', RETURNED: 'violet' };

export function SaleStatusBadge({ status }: { status: SaleStatus }) {
  return <Badge tone={TONES[status]}>{SALE_STATUS_LABELS[status]}</Badge>;
}

export const methodLabel = (m: SalePaymentMethod) => PAYMENT_METHOD_LABELS[m];
