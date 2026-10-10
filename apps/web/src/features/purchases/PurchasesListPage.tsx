import { PAYMENT_STATUS_LABELS, PAYMENT_STATUSES, PURCHASE_STATUS_LABELS, type PaymentStatus, type PurchaseStatus } from '@farmacia/shared';
import { clsx } from 'clsx';
import { AlertTriangle, CalendarClock, PackageCheck, Plus, Receipt, Search, Wallet, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { usePurchases, useSuppliers } from '../../api/purchases';
import { useAuth } from '../../auth/useAuth';
import { Alert } from '../../components/ui/Alert';
import { ButtonLink } from '../../components/ui/Button';
import { Card, PageHeader } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { TextField } from '../../components/ui/FormField';
import { Pagination } from '../../components/ui/Pagination';
import { SelectField } from '../../components/ui/SelectField';
import { Spinner } from '../../components/ui/Spinner';
import { formatDate, formatMoney } from '../../lib/format';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { PaymentStatusBadge, PurchaseStatusBadge } from './purchase-display';

function SummaryCard({
  label,
  value,
  hint,
  icon: Icon,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon: typeof Receipt;
  tone: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-slate-500 sm:text-sm">{label}</p>
        <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${tone}`}>
          <Icon className="size-4" />
        </span>
      </div>
      <p className="mt-2 text-xl font-semibold tabular-nums text-slate-900 sm:text-2xl">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </>
  );
  const className = clsx(
    'rounded-xl border bg-white p-4 text-left shadow-sm transition',
    active ? 'border-brand-500 ring-2 ring-brand-100' : 'border-slate-200',
    onClick && 'hover:border-brand-300',
  );
  return onClick ? (
    <button type="button" className={className} onClick={onClick} aria-pressed={active}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}

export function PurchasesListPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const supplierId = params.get('supplierId') ?? undefined;
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<PurchaseStatus | ''>('');
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | ''>('');
  const [overdue, setOverdue] = useState(false);
  const [page, setPage] = useState(1);
  const q = useDebouncedValue(search.trim());

  const purchases = usePurchases({
    q,
    supplierId,
    status: status || undefined,
    paymentStatus: paymentStatus || undefined,
    overdue: overdue || undefined,
    page,
    pageSize: 25,
  });
  // Nombre del proveedor filtrado (desde Proveedores → "Ver compras")
  const supplierName = purchases.data?.data[0]?.supplier.id === supplierId ? purchases.data?.data[0]?.supplier.tradeName : undefined;
  const suppliers = useSuppliers({ status: 'all', page: 1, pageSize: 100 }, Boolean(supplierId && !supplierName && can('suppliers.view')));
  const filteredSupplier = supplierName ?? suppliers.data?.data.find((s) => s.id === supplierId)?.tradeName;
  const summary = purchases.data?.summary;
  const rows = purchases.data?.data ?? [];

  const reset = (fn: () => void) => {
    fn();
    setPage(1);
  };

  return (
    <div>
      <PageHeader
        title="Compras"
        description="Facturas de proveedores, recepción de mercancía y cuentas por pagar."
        actions={
          can('purchases.create') && (
            <ButtonLink to="/compras/nueva" icon={<Plus className="size-4" />}>
              Nueva compra
            </ButtonLink>
          )
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard
          label="Por recibir"
          value={summary?.pendingReception ?? '—'}
          hint="Pedidos sin ingresar"
          icon={PackageCheck}
          tone="bg-accent-50 text-accent-700"
          active={status === 'ORDERED'}
          onClick={() => reset(() => setStatus(status === 'ORDERED' ? '' : 'ORDERED'))}
        />
        <SummaryCard label="Saldo por pagar" value={formatMoney(summary?.balanceDue)} icon={Wallet} tone="bg-amber-50 text-amber-700" />
        <SummaryCard
          label="Vencidas"
          value={summary ? `${summary.overdueCount}` : '—'}
          hint={summary && summary.overdueCount > 0 ? formatMoney(summary.overdueAmount) : 'Sin pagos atrasados'}
          icon={AlertTriangle}
          tone="bg-red-50 text-red-700"
          active={overdue}
          onClick={() => reset(() => setOverdue((v) => !v))}
        />
        <SummaryCard label="Recibido este mes" value={formatMoney(summary?.receivedThisMonth)} icon={CalendarClock} tone="bg-brand-50 text-brand-700" />
      </div>

      {supplierId && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">
          Proveedor: <strong>{filteredSupplier ?? '…'}</strong>
          <button
            type="button"
            className="ml-auto rounded p-1 hover:bg-brand-100"
            aria-label="Quitar filtro de proveedor"
            onClick={() => {
              params.delete('supplierId');
              setParams(params);
              setPage(1);
            }}
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-[2fr_1fr_1fr]">
        <TextField
          className="col-span-2 md:col-span-1"
          label="Buscar"
          placeholder="Folio, factura o proveedor"
          icon={<Search className="size-4" />}
          value={search}
          onChange={(e) => reset(() => setSearch(e.target.value))}
        />
        <SelectField label="Estado" value={status} onChange={(e) => reset(() => setStatus(e.target.value as PurchaseStatus | ''))}>
          <option value="">Todos</option>
          {(['ORDERED', 'RECEIVED', 'CANCELLED'] as const).map((s) => (
            <option key={s} value={s}>
              {PURCHASE_STATUS_LABELS[s]}
            </option>
          ))}
        </SelectField>
        <SelectField label="Pago" value={paymentStatus} onChange={(e) => reset(() => setPaymentStatus(e.target.value as PaymentStatus | ''))}>
          <option value="">Todos</option>
          {PAYMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {PAYMENT_STATUS_LABELS[s]}
            </option>
          ))}
        </SelectField>
      </div>

      {overdue && (
        <p className="mb-3 text-sm text-slate-600">
          Mostrando sólo: <strong>compras vencidas</strong>{' '}
          <button type="button" className="font-medium text-brand-700 underline" onClick={() => reset(() => setOverdue(false))}>
            Quitar filtro
          </button>
        </p>
      )}

      {purchases.isError && <Alert tone="error">No se pudieron cargar las compras.</Alert>}

      <Card className="overflow-hidden">
        {purchases.isPending ? (
          <div className="flex justify-center py-16 text-brand-600">
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Receipt} title="Sin compras" description="No hay compras con estos filtros." />
        ) : (
          <>
            <table className="hidden w-full text-sm md:table">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Folio</th>
                  <th className="px-4 py-3">Proveedor</th>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">Saldo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((p) => (
                  <tr key={p.id} onClick={() => navigate(`/compras/historial/${p.id}`)} className={clsx('cursor-pointer hover:bg-slate-50', p.status === 'CANCELLED' && 'opacity-60')}>
                    <td className="px-4 py-3">
                      <Link to={`/compras/historial/${p.id}`} onClick={(e) => e.stopPropagation()} className="font-mono font-medium text-slate-900 hover:text-brand-700">
                        {p.folio}
                      </Link>
                      {p.invoiceNumber && <p className="text-xs text-slate-500">Factura {p.invoiceNumber}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-slate-900">{p.supplier.tradeName}</p>
                      <p className="text-xs text-slate-500">{p.itemCount} producto(s)</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatDate(p.purchaseDate)}
                      {p.paymentDueDate && p.status === 'RECEIVED' && p.paymentStatus !== 'PAID' && (
                        <p className={clsx('text-xs', p.overdue ? 'font-medium text-red-600' : 'text-slate-400')}>Vence {formatDate(p.paymentDueDate)}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        <PurchaseStatusBadge status={p.status} />
                        <PaymentStatusBadge status={p.paymentStatus} overdue={p.overdue} cancelled={p.status === 'CANCELLED'} />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-slate-900">{formatMoney(p.total)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                      {p.status !== 'CANCELLED' && p.balance > 0 ? formatMoney(p.balance) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <ul className="divide-y divide-slate-100 md:hidden">
              {rows.map((p) => (
                <li key={p.id}>
                  <Link to={`/compras/historial/${p.id}`} className={clsx('block space-y-1 p-4 hover:bg-slate-50', p.status === 'CANCELLED' && 'opacity-60')}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-mono font-medium text-slate-900">{p.folio}</p>
                        <p className="text-sm text-slate-700">{p.supplier.tradeName}</p>
                      </div>
                      <p className="text-right font-semibold tabular-nums text-slate-900">{formatMoney(p.total)}</p>
                    </div>
                    <p className="text-xs text-slate-500">
                      {formatDate(p.purchaseDate)} · {p.itemCount} producto(s)
                    </p>
                    <div className="flex flex-wrap gap-1">
                      <PurchaseStatusBadge status={p.status} />
                      <PaymentStatusBadge status={p.paymentStatus} overdue={p.overdue} cancelled={p.status === 'CANCELLED'} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
        {purchases.data && <Pagination meta={purchases.data.meta} onPageChange={setPage} />}
      </Card>
    </div>
  );
}
