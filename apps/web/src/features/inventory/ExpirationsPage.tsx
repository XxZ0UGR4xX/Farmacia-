import { clsx } from 'clsx';
import { CalendarCheck, CalendarClock, CalendarX2, Download, PackageMinus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { downloadFile } from '../../api/client';
import { toQuery, useExpirations, type Batch, type ExpiryClass } from '../../api/inventory';
import { useAuth } from '../../auth/useAuth';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, PageHeader } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Spinner } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { formatMoney } from '../../lib/format';
import { productDetails } from '../products/product-display';
import { AdjustDialog } from './AdjustDialog';
import { ExpiryCell } from './inventory-display';

const CLASSES: { cls: ExpiryClass; label: string; hint: (t: { criticalDays: number; warningDays: number }) => string; icon: typeof CalendarX2; tone: string; ring: string }[] = [
  { cls: 'EXPIRED', label: 'Caducados', hint: () => 'No se venden: dar de baja', icon: CalendarX2, tone: 'bg-red-50 text-red-700', ring: 'border-red-400 ring-red-100' },
  { cls: 'CRITICAL', label: 'Críticos', hint: (t) => `Caducan en menos de ${t.criticalDays} días`, icon: CalendarClock, tone: 'bg-amber-50 text-amber-700', ring: 'border-amber-400 ring-amber-100' },
  { cls: 'WARNING', label: 'Próximos', hint: (t) => `De ${t.criticalDays} a ${t.warningDays} días`, icon: CalendarCheck, tone: 'bg-accent-50 text-accent-700', ring: 'border-accent-500 ring-accent-100' },
];

export function ExpirationsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const [cls, setCls] = useState<ExpiryClass | undefined>();
  const [writingOff, setWritingOff] = useState<Batch | null>(null);
  const expirations = useExpirations(cls);
  const data = expirations.data;
  const rows = data?.data ?? [];
  const thresholds = data?.thresholds ?? { criticalDays: 30, warningDays: 90 };
  const canAdjust = can('inventory.adjust');

  const exportCsv = async () => {
    try {
      await downloadFile(`/inventory/expirations/export?${toQuery({ class: cls })}`, 'caducidades.csv');
    } catch {
      toast.error('No se pudo exportar');
    }
  };

  return (
    <div>
      <PageHeader
        title="Caducidades"
        description="Lotes con existencia que ya caducaron o están por caducar. Lo caducado nunca se vende."
        actions={
          <Button variant="secondary" onClick={exportCsv} icon={<Download className="size-4" />}>
            Exportar
          </Button>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {CLASSES.map(({ cls: c, label, hint, icon: Icon, tone, ring }) => {
          const s = data?.summary[c];
          const active = cls === c;
          return (
            <button
              key={c}
              type="button"
              aria-pressed={active}
              onClick={() => setCls(active ? undefined : c)}
              className={clsx('rounded-xl border bg-white p-4 text-left shadow-sm transition hover:border-brand-300', active ? `ring-2 ${ring}` : 'border-slate-200')}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-slate-700">{label}</p>
                  <p className="text-xs text-slate-500">{hint(thresholds)}</p>
                </div>
                <span className={`flex size-8 items-center justify-center rounded-lg ${tone}`}>
                  <Icon className="size-4" />
                </span>
              </div>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900" data-testid={`expiry-${c}`}>
                {s ? s.batches : '—'} <span className="text-sm font-normal text-slate-500">lote(s)</span>
              </p>
              <p className="text-xs text-slate-500">
                {s ? `${s.units} unidad(es) de ${s.products} producto(s)` : ''}
                {s?.value !== undefined && s.value > 0 ? ` · ${formatMoney(s.value)}` : ''}
              </p>
            </button>
          );
        })}
      </div>

      {(data?.summary.EXPIRED.batches ?? 0) > 0 && cls !== 'EXPIRED' && (
        <Alert tone="error" className="mb-4">
          Hay {data!.summary.EXPIRED.units} unidad(es) caducadas en el inventario. Sepáralas del anaquel y dalas de baja para que el inventario cuadre.
        </Alert>
      )}
      {expirations.isError && <Alert tone="error">No se pudieron cargar las caducidades.</Alert>}

      <Card className="overflow-hidden">
        {expirations.isPending ? (
          <div className="flex justify-center py-16 text-brand-600">
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={CalendarCheck} title="Sin lotes por caducar" description="No hay lotes con existencia en esta clasificación." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5" data-testid="expiry-row">
                <div className="min-w-48 flex-1">
                  <Link to={`/inventario/existencias/${b.product.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                    {b.product.commercialName}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {productDetails({ ...b.product, pharmaceuticalForm: null })} · Lote <span className="font-mono">{b.lotNumber}</span>
                    {b.supplier && ` · ${b.supplier.name}`}
                  </p>
                </div>
                <ExpiryCell date={b.expiresAt} days={b.daysLeft} status={b.expiryStatus} />
                <div className="w-24 text-right">
                  <p className="font-semibold tabular-nums text-slate-900">{b.quantity}</p>
                  {b.value !== undefined && <p className="text-xs text-slate-400">{formatMoney(b.value)}</p>}
                </div>
                {b.status === 'QUARANTINE' && <Badge tone="amber">En cuarentena</Badge>}
                {canAdjust && b.expiryStatus === 'EXPIRED' && (
                  <Button size="sm" variant="danger" onClick={() => setWritingOff(b)} icon={<PackageMinus className="size-4" />}>
                    Dar de baja
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <AdjustDialog batch={writingOff} preset={writingOff ? { reason: 'EXPIRED', quantity: writingOff.quantity } : undefined} onClose={() => setWritingOff(null)} />
    </div>
  );
}
