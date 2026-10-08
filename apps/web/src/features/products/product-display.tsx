import { PRESENTATION_LABELS, PRODUCT_STATUS_LABELS } from '@farmacia/shared';
import { clsx } from 'clsx';
import { Pill } from 'lucide-react';
import type { Product, StockStatus } from '../../api/catalog';
import { Badge } from '../../components/ui/Badge';

/** "500 mg · Tableta · Caja con 20 tabletas" */
export function productDetails(p: Pick<Product, 'concentration' | 'pharmaceuticalForm' | 'presentation' | 'contentQuantity'>): string {
  const presentation = PRESENTATION_LABELS[p.presentation];
  const pack = p.contentQuantity ? `${presentation} con ${p.contentQuantity}` : presentation;
  return [p.concentration, p.pharmaceuticalForm, pack].filter(Boolean).join(' · ');
}

export function ProductThumb({ product, size = 'md' }: { product: Pick<Product, 'imageUrl' | 'commercialName'>; size?: 'md' | 'lg' }) {
  const box = size === 'lg' ? 'size-24 rounded-xl' : 'size-10 rounded-lg';
  return product.imageUrl ? (
    <img src={product.imageUrl} alt="" className={clsx(box, 'shrink-0 bg-white object-contain ring-1 ring-slate-200')} />
  ) : (
    <span className={clsx(box, 'flex shrink-0 items-center justify-center bg-brand-50 text-brand-600')} aria-hidden>
      <Pill className={size === 'lg' ? 'size-10' : 'size-5'} />
    </span>
  );
}

const stockTone: Record<StockStatus, 'red' | 'amber' | 'green'> = { OUT: 'red', LOW: 'amber', OK: 'green' };
const stockLabel: Record<StockStatus, string> = { OUT: 'Agotado', LOW: 'Stock bajo', OK: 'Disponible' };

export function StockBadge({ product }: { product: Pick<Product, 'stock' | 'stockStatus'> }) {
  return (
    <Badge tone={stockTone[product.stockStatus]}>
      {product.stock} · {stockLabel[product.stockStatus]}
    </Badge>
  );
}

export function ProductBadges({ product }: { product: Pick<Product, 'status' | 'requiresPrescription' | 'isControlled'> }) {
  return (
    <div className="flex flex-wrap gap-1">
      {product.status !== 'ACTIVE' && <Badge>{PRODUCT_STATUS_LABELS[product.status]}</Badge>}
      {product.requiresPrescription && <Badge tone="violet">Receta</Badge>}
      {product.isControlled && <Badge tone="red">Retiene receta</Badge>}
    </div>
  );
}
