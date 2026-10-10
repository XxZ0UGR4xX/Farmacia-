import { SALE_PAYMENT_METHODS, SALE_STATUS_LABELS, SALE_STATUSES, type SalePaymentMethod, type SaleStatus } from '@farmacia/shared';
import { clsx } from 'clsx';
import { Receipt, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useSales } from '../../api/sales';
import { useAuth } from '../../auth/useAuth';
import { Alert } from '../../components/ui/Alert';
import { ButtonLink } from '../../components/ui/Button';
import { Card, PageHeader } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { TextField } from '../../components/ui/FormField';
import { Pagination } from '../../components/ui/Pagination';
import { SelectField } from '../../components/ui/SelectField';
import { Spinner } from '../../components/ui/Spinner';
import { formatDateTime, formatMoney } from '../../lib/format';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { useToday } from '../../lib/useToday';
import { methodLabel, SaleStatusBadge } from './sales-display';

export function SalesHistoryPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const today = useToday();
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState<SaleStatus | ''>('');
  const [method, setMethod] = useState<SalePaymentMethod | ''>('');
  const [page, setPage] = useState(1);
  const q = useDebouncedValue(search.trim());
  // Por omisión: el corte de hoy
  const range = { from: from || today, to: to || today };
  const invalidRange = range.from > range.to;
  const sales = useSales({ q, ...range, status: status || undefined, paymentMethod: method || undefined, page, pageSize: 30 }, !invalidRange);
  const summary = sales.data?.summary;
  const rows = sales.data?.data ?? [];
  const isToday = range.from === today && range.to === today;
  const reset = (fn: () => void) => {
    fn();
    setPage(1);
  };
  const refunds = summary ? Object.values(summary.refunds).reduce((s, v) => s + (v ?? 0), 0) : 0;
  const cashIn = summary ? (summary.byMethod.CASH ?? 0) - (summary.refunds.CASH ?? 0) : 0;

  return (
    <div>
      <PageHeader
        title="Ventas"
        description={sales.data?.scope === 'own' ? 'Tus ventas y tu corte de caja.' : 'Ventas de la sucursal y corte por forma de pago.'}
        actions={
          can('sales.create') && (
            <ButtonLink to="/ventas/punto-de-venta" icon={<Receipt className="size-4" />}>
              Ir al punto de venta
            </ButtonLink>
          )
        }
      />

      <Card className="mb-6 p-5">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold text-slate-900">{isToday ? 'Corte de hoy' : 'Resumen del periodo'}</h2>
          {summary && summary.cancelled > 0 && <p className="text-xs text-slate-500">{summary.cancelled} venta(s) cancelada(s) no se suman</p>}
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-xs text-slate-500">Ventas</p>
            <p className="text-2xl font-semibold tabular-nums text-slate-900">{summary?.count ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Total vendido</p>
            <p className="text-2xl font-semibold tabular-nums text-slate-900" data-testid="sales-total">
              {formatMoney(summary?.total)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Ticket promedio</p>
            <p className="text-2xl font-semibold tabular-nums text-slate-900">{formatMoney(summary?.averageTicket)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Devoluciones</p>
            <p className="text-2xl font-semibold tabular-nums text-slate-900">{formatMoney(refunds)}</p>
          </div>
        </div>
        <div className="mt-4 grid gap-2 border-t border-slate-100 pt-4 text-sm sm:grid-cols-4">
          {SALE_PAYMENT_METHODS.map((m) => (
            <p key={m} className="flex justify-between gap-2 sm:block">
              <span className="text-slate-500">{methodLabel(m)}</span>{' '}
              <span className="font-medium tabular-nums text-slate-900">{formatMoney(summary?.byMethod[m] ?? 0)}</span>
            </p>
          ))}
        </div>
        {summary && (summary.byMethod.CASH ?? 0) > 0 && (
          <p className="mt-3 text-sm text-slate-600">
            Efectivo que debe haber en caja (ventas menos reembolsos en efectivo): <strong className="tabular-nums">{formatMoney(cashIn)}</strong>
          </p>
        )}
      </Card>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-[1.6fr_1fr_1fr_1fr_1fr]">
        <TextField className="col-span-2 md:col-span-1" label="Buscar" placeholder="Folio (V-000123) o producto" icon={<Search className="size-4" />} value={search} onChange={(e) => reset(() => setSearch(e.target.value))} />
        <TextField label="Desde" type="date" value={range.from} max={range.to} onChange={(e) => reset(() => setFrom(e.target.value))} />
        <TextField label="Hasta" type="date" value={range.to} min={range.from} onChange={(e) => reset(() => setTo(e.target.value))} />
        <SelectField label="Estado" value={status} onChange={(e) => reset(() => setStatus(e.target.value as SaleStatus | ''))}>
          <option value="">Todos</option>
          {SALE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {SALE_STATUS_LABELS[s]}
            </option>
          ))}
        </SelectField>
        <SelectField label="Forma de pago" value={method} onChange={(e) => reset(() => setMethod(e.target.value as SalePaymentMethod | ''))}>
          <option value="">Todas</option>
          {SALE_PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {methodLabel(m)}
            </option>
          ))}
        </SelectField>
      </div>

      {invalidRange && <Alert tone="warning" className="mb-4">La fecha "Desde" debe ser anterior a "Hasta".</Alert>}
      {sales.isError && <Alert tone="error">No se pudieron cargar las ventas.</Alert>}

      <Card className="overflow-hidden">
        {sales.isPending ? (
          <div className="flex justify-center py-16 text-brand-600">
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Receipt} title="Sin ventas" description="No hay ventas con estos filtros." />
        ) : (
          <>
            <table className="hidden w-full text-sm md:table">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Folio</th>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Atendió</th>
                  <th className="px-4 py-3">Pago</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((s) => (
                  <tr key={s.id} onClick={() => navigate(`/ventas/historial/${s.id}`)} className={clsx('cursor-pointer hover:bg-slate-50', s.status === 'CANCELLED' && 'opacity-60')}>
                    <td className="px-4 py-3">
                      <Link to={`/ventas/historial/${s.id}`} onClick={(e) => e.stopPropagation()} className="font-mono font-medium text-slate-900 hover:text-brand-700">
                        {s.folio}
                      </Link>
                      <p className="text-xs text-slate-500">{s.units} pieza(s)</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatDateTime(s.createdAt)}</td>
                    <td className="px-4 py-3 text-slate-600">{s.createdBy.fullName}</td>
                    <td className="px-4 py-3 text-slate-600">{s.paymentMethods.map(methodLabel).join(' + ')}</td>
                    <td className="px-4 py-3">
                      <SaleStatusBadge status={s.status} />
                    </td>
                    <td className={clsx('px-4 py-3 text-right font-medium tabular-nums', s.status === 'CANCELLED' ? 'text-slate-400 line-through' : 'text-slate-900')}>{formatMoney(s.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y divide-slate-100 md:hidden">
              {rows.map((s) => (
                <li key={s.id}>
                  <Link to={`/ventas/historial/${s.id}`} className={clsx('flex items-start justify-between gap-3 p-4', s.status === 'CANCELLED' && 'opacity-60')}>
                    <div className="space-y-1">
                      <p className="font-mono font-medium text-slate-900">{s.folio}</p>
                      <p className="text-xs text-slate-500">
                        {formatDateTime(s.createdAt)} · {s.paymentMethods.map(methodLabel).join(' + ')}
                      </p>
                      <SaleStatusBadge status={s.status} />
                    </div>
                    <p className="font-semibold tabular-nums text-slate-900">{formatMoney(s.total)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
        {sales.data && <Pagination meta={sales.data.meta} onPageChange={setPage} />}
      </Card>
    </div>
  );
}
