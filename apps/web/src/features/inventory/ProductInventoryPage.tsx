import { clsx } from 'clsx';
import { ArrowLeft, History, PackagePlus, Pill, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { useProduct } from '../../api/catalog';
import { useProductInventory, type Batch } from '../../api/inventory';
import { useAuth } from '../../auth/useAuth';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Spinner } from '../../components/ui/Spinner';
import { formatDate, formatDateTime, formatMoney } from '../../lib/format';
import { productDetails, ProductThumb, StockBadge } from '../products/product-display';
import { AdjustDialog } from './AdjustDialog';
import { EntryDialog } from './EntryDialog';
import { BATCH_STATUS_LABELS, ExpiryCell, MovementLabel, QuantityChange } from './inventory-display';

export function ProductInventoryPage() {
  const { productId } = useParams();
  const { can } = useAuth();
  const product = useProduct(productId);
  const inventory = useProductInventory(productId);
  const [entryOpen, setEntryOpen] = useState(false);
  const [adjusting, setAdjusting] = useState<Batch | null>(null);
  const [showDepleted, setShowDepleted] = useState(false);

  if (product.isPending || inventory.isPending) {
    return (
      <div className="flex justify-center py-16 text-brand-600">
        <Spinner />
      </div>
    );
  }
  if (product.isError || !product.data) return <Alert tone="error">El producto no existe o fue eliminado.</Alert>;

  const p = product.data;
  const batches = inventory.data?.batches ?? [];
  const visible = showDepleted ? batches : batches.filter((b) => b.quantity > 0);
  const hiddenCount = batches.length - visible.length;
  // FEFO: el primer lote vendible (los caducados o en cuarentena no cuentan)
  const nextToSell = batches.find((b) => b.sellable)?.id;
  const showCosts = p.purchasePrice !== undefined;
  const canAdjust = can('inventory.adjust');

  return (
    <div>
      <ButtonLink to="/inventario/existencias" variant="ghost" size="sm" className="-ml-2 mb-3" icon={<ArrowLeft className="size-4" />}>
        Existencias
      </ButtonLink>

      <div className="mb-6 flex flex-wrap items-start gap-4">
        <ProductThumb product={p} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{p.commercialName}</h1>
          <p className="mt-1 text-sm text-slate-500">{productDetails(p)}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <StockBadge product={p} />
            <span>
              Mínimo {p.inventory.minStock}
              {p.inventory.maxStock != null && ` · Máximo ${p.inventory.maxStock}`}
            </span>
            {p.inventory.location && <span>· {p.inventory.location}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonLink to={`/inventario/productos/${p.id}`} variant="secondary" icon={<Pill className="size-4" />}>
            Ficha del producto
          </ButtonLink>
          {canAdjust && (
            <Button onClick={() => setEntryOpen(true)} icon={<PackagePlus className="size-4" />}>
              Registrar entrada
            </Button>
          )}
        </div>
      </div>

      <Card className="mb-6 overflow-hidden">
        <CardHeader
          title="Lotes"
          description="Se venden primero los que caducan antes (FEFO). Los caducados y en cuarentena no se venden."
          actions={
            hiddenCount > 0 || showDepleted ? (
              <Button variant="ghost" size="sm" onClick={() => setShowDepleted((v) => !v)}>
                {showDepleted ? 'Ocultar agotados' : `Ver agotados (${hiddenCount})`}
              </Button>
            ) : undefined
          }
        />
        {visible.length === 0 ? (
          <EmptyState
            icon={PackagePlus}
            title="Sin lotes con existencia"
            description={canAdjust ? 'Registra una entrada o recibe una compra para darle existencia.' : undefined}
          />
        ) : (
          <>
          {/* Celular: tarjetas (útil para el conteo físico frente al anaquel) */}
          <ul className="divide-y divide-slate-100 md:hidden">
            {visible.map((b) => (
              <li key={b.id} className={clsx('space-y-2 p-4', b.quantity === 0 && 'opacity-60')}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono font-medium text-slate-900">{b.lotNumber}</p>
                    {b.id === nextToSell && <Badge tone="green">Se vende primero</Badge>}
                  </div>
                  <p className="text-right">
                    <span className="text-xl font-semibold tabular-nums text-slate-900">{b.quantity}</span>
                    <span className="block text-xs text-slate-400">de {b.initialQuantity}</span>
                  </p>
                </div>
                <ExpiryCell date={b.expiresAt} days={b.daysLeft} status={b.expiryStatus} />
                {b.expiryStatus === 'EXPIRED' && b.quantity > 0 && <Badge tone="red">Caducado: dar de baja</Badge>}
                {canAdjust && (
                  <Button variant="secondary" size="sm" fullWidth onClick={() => setAdjusting(b)} icon={<SlidersHorizontal className="size-4" />}>
                    Ajustar o contar
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Lote</th>
                  <th className="px-4 py-3">Caducidad</th>
                  <th className="px-4 py-3 text-right">Existencia</th>
                  {showCosts && <th className="px-4 py-3 text-right">Costo</th>}
                  <th className="px-4 py-3">Estado</th>
                  {canAdjust && (
                    <th className="px-4 py-3">
                      <span className="sr-only">Acciones</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((b) => (
                  <tr key={b.id} className={clsx(b.quantity === 0 && 'opacity-60')}>
                    <td className="px-4 py-3">
                      <p className="font-mono font-medium text-slate-900">{b.lotNumber}</p>
                      {b.id === nextToSell && <Badge tone="green">Se vende primero</Badge>}
                      <p className="text-xs text-slate-400">Recibido {formatDate(b.receivedAt)}</p>
                    </td>
                    <td className="px-4 py-3">
                      <ExpiryCell date={b.expiresAt} days={b.daysLeft} status={b.expiryStatus} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <p className="text-base font-semibold tabular-nums text-slate-900">{b.quantity}</p>
                      <p className="text-xs text-slate-400">de {b.initialQuantity}</p>
                    </td>
                    {showCosts && (
                      <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                        {formatMoney(b.unitCost)}
                        <p className="text-xs text-slate-400">{formatMoney(b.value)}</p>
                      </td>
                    )}
                    <td className="px-4 py-3">
                      {b.expiryStatus === 'EXPIRED' && b.quantity > 0 ? (
                        <Badge tone="red">Caducado: dar de baja</Badge>
                      ) : (
                        <Badge tone={b.status === 'ACTIVE' ? 'green' : b.status === 'QUARANTINE' ? 'amber' : 'neutral'}>
                          {BATCH_STATUS_LABELS[b.status]}
                        </Badge>
                      )}
                    </td>
                    {canAdjust && (
                      <td className="px-4 py-3 text-right">
                        <Button variant="secondary" size="sm" onClick={() => setAdjusting(b)} icon={<SlidersHorizontal className="size-4" />}>
                          Ajustar
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Card>

      <Card className="overflow-hidden">
        <CardHeader
          title="Movimientos recientes"
          actions={
            can('inventory.movements.view') ? (
              <ButtonLink to={`/inventario/movimientos?productId=${p.id}`} variant="ghost" size="sm" icon={<History className="size-4" />}>
                Ver historial completo
              </ButtonLink>
            ) : undefined
          }
        />
        {(inventory.data?.movements.length ?? 0) === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-500">Aún no hay movimientos.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {inventory.data?.movements.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm">
                <div className="min-w-40 flex-1">
                  <MovementLabel movement={m} />
                  {m.notes && <p className="text-xs text-slate-500">{m.notes}</p>}
                </div>
                <span className="font-mono text-xs text-slate-500">Lote {m.batch.lotNumber}</span>
                <span className="tabular-nums text-slate-500">
                  {m.quantityBefore} → {m.quantityAfter}
                </span>
                <QuantityChange value={m.quantityChange} />
                <span className="w-full text-xs text-slate-400 sm:w-auto">
                  {formatDateTime(m.createdAt)} · {m.user.fullName}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <EntryDialog
        open={entryOpen}
        product={{ id: p.id, commercialName: p.commercialName, concentration: p.concentration, purchasePrice: p.purchasePrice }}
        showCosts={showCosts}
        onClose={() => setEntryOpen(false)}
      />
      <AdjustDialog batch={adjusting} onClose={() => setAdjusting(null)} />
    </div>
  );
}
