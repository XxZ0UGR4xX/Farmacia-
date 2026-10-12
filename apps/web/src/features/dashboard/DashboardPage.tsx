import type { SaleStatus } from '@farmacia/shared';
import {
  AlertTriangle,
  CalendarX2,
  CircleDollarSign,
  Clock,
  PackageCheck,
  PackageX,
  Receipt,
  RotateCcw,
  ShoppingBag,
  TrendingUp,
  Truck,
  Wallet,
  Warehouse,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useDashboard, type Dashboard } from '../../api/reports';
import { useAuth } from '../../auth/useAuth';
import { BarList } from '../../components/charts/BarList';
import { ChartCard } from '../../components/charts/ChartCard';
import { ColumnChart } from '../../components/charts/ColumnChart';
import { StatTile } from '../../components/charts/StatTile';
import { filterNavigation, isSection } from '../../components/layout/navigation';
import { Alert } from '../../components/ui/Alert';
import { Card, CardHeader } from '../../components/ui/Card';
import { Spinner } from '../../components/ui/Spinner';
import { formatDateTime, formatMoney } from '../../lib/format';
import { SaleStatusBadge } from '../sales/sales-display';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const weekday = new Intl.DateTimeFormat('es-MX', { weekday: 'short', timeZone: 'UTC' });
const longDate = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const units = (n: number) => `${n.toLocaleString('es-MX')} ${n === 1 ? 'unidad' : 'unidades'}`;

function greeting(date: Date): string {
  const h = date.getHours();
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

/** Cambio relativo contra ayer (null si ayer no hubo ventas: no hay base para comparar). */
const change = (today: number, yesterday: number) => (yesterday > 0 ? (today - yesterday) / yesterday : null);

export function DashboardPage() {
  const { user, can } = useAuth();
  const dashboard = useDashboard();
  const d = dashboard.data;
  const now = new Date();
  const todayLabel = capitalize(now.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
  // Se antepone la sección para distinguir accesos homónimos (Historial de ventas / de compras)
  const shortcuts = filterNavigation(can).flatMap((entry) =>
    isSection(entry)
      ? entry.items.map((item) => ({ ...item, label: `${entry.label} · ${item.label}` }))
      : entry.to === '/'
        ? []
        : [entry],
  );

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-500">{todayLabel}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
          {greeting(now)}, {user?.firstName}
        </h1>
        <p className="mt-1 text-slate-500">¿Cómo está tu farmacia hoy?</p>
      </div>

      {dashboard.isError && <Alert tone="error">No se pudieron cargar los indicadores. Se reintentará en un momento.</Alert>}
      {dashboard.isPending ? (
        <div className="flex justify-center py-16 text-brand-600">
          <Spinner />
        </div>
      ) : (
        d && (
          <>
            <Indicators d={d} />
            {d.sales && <SalesSection d={d} sales={d.sales} />}
          </>
        )
      )}

      <Card>
        <CardHeader title="Accesos rápidos" description="Módulos disponibles para tu rol." />
        <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
          {shortcuts.map(({ to, label, icon: Icon, description }) => (
            <Link
              key={to}
              to={to}
              className="group flex gap-3 rounded-lg border border-slate-200 p-4 transition hover:border-brand-300 hover:bg-brand-50/40"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 group-hover:bg-brand-100 group-hover:text-brand-700">
                <Icon className="size-5" />
              </span>
              <span>
                <span className="block text-sm font-medium text-slate-900">{label}</span>
                <span className="mt-0.5 line-clamp-2 block text-xs text-slate-500">{description}</span>
              </span>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Indicators({ d }: { d: Dashboard }) {
  const { can } = useAuth();
  const tiles: ReactNode[] = [];
  const own = d.salesScope === 'own';

  if (d.sales) {
    const { today, yesterday } = d.sales;
    tiles.push(
      <StatTile
        key="sales"
        label={own ? 'Mis ventas de hoy' : 'Ventas de hoy'}
        value={formatMoney(today.total)}
        icon={CircleDollarSign}
        tone="good"
        testId="kpi-sales-today"
        delta={{ ratio: change(today.total, yesterday.total), against: 'vs. ayer' }}
        hint={`${today.count} ${today.count === 1 ? 'venta' : 'ventas'}${today.count ? ` · ticket promedio ${formatMoney(today.averageTicket)}` : ''}${today.refunds ? ` · devoluciones ${formatMoney(today.refunds)}` : ''}`}
        to={can('sales.view') ? '/ventas/historial' : undefined}
      />,
      <StatTile key="units" label="Productos vendidos" value={today.units.toLocaleString('es-MX')} icon={ShoppingBag} tone="info" hint={`Ayer: ${units(yesterday.units)}`} />,
    );
    if (today.profit !== undefined) {
      tiles.push(
        <StatTile
          key="profit"
          label="Utilidad bruta de hoy"
          value={formatMoney(today.profit)}
          icon={TrendingUp}
          tone="good"
          testId="kpi-profit"
          hint={today.total ? 'Venta sin IVA menos costo de lo vendido' : 'Sin ventas todavía'}
        />,
      );
    }
  }
  if (d.inventory) {
    if (d.inventory.costValue !== undefined) {
      tiles.push(
        <StatTile
          key="value"
          label="Valor del inventario"
          value={formatMoney(d.inventory.costValue)}
          icon={Warehouse}
          tone="info"
          hint={`A costo · ${formatMoney(d.inventory.retailValue)} a precio de venta`}
          to={can('reports.view') ? '/reportes?tab=inventario' : undefined}
        />,
      );
    }
    tiles.push(
      <StatTile
        key="low"
        label="Stock bajo"
        value={d.inventory.lowStock}
        icon={AlertTriangle}
        tone={d.inventory.lowStock ? 'warning' : 'neutral'}
        hint="Productos en su mínimo o debajo"
        to="/inventario/existencias"
        testId="kpi-low-stock"
      />,
      <StatTile
        key="out"
        label="Agotados"
        value={d.inventory.outOfStock}
        icon={PackageX}
        tone={d.inventory.outOfStock ? 'critical' : 'neutral'}
        hint="Sin existencia vendible"
        to="/inventario/existencias"
      />,
    );
  }
  if (d.expirations) {
    tiles.push(
      <StatTile
        key="expiring"
        label="Próximos a caducar"
        value={d.expirations.expiringLots}
        icon={Clock}
        tone={d.expirations.expiringLots ? 'warning' : 'neutral'}
        hint={`Lotes en menos de ${d.expirations.criticalDays} días · ${units(d.expirations.expiringUnits)}`}
        to="/inventario/caducidades"
      />,
      <StatTile
        key="expired"
        label="Caducados en anaquel"
        value={d.expirations.expiredLots}
        icon={CalendarX2}
        tone={d.expirations.expiredLots ? 'critical' : 'neutral'}
        hint={d.expirations.expiredLots ? `${units(d.expirations.expiredUnits)} por dar de baja` : 'Ninguno: todo en orden'}
        to="/inventario/caducidades"
      />,
    );
  }
  if (d.returns) {
    tiles.push(
      <StatTile
        key="returns"
        label="Devoluciones por revisar"
        value={d.returns.pendingReview}
        icon={RotateCcw}
        tone={d.returns.pendingReview ? 'warning' : 'neutral'}
        hint="Producto en cuarentena"
        to="/ventas/devoluciones"
      />,
    );
  }
  if (d.purchases) {
    if (d.purchases.overdue) {
      tiles.push(
        <StatTile
          key="payables"
          label="Pagos vencidos a proveedores"
          value={formatMoney(d.purchases.overdue.amount)}
          icon={Wallet}
          tone={d.purchases.overdue.count ? 'critical' : 'neutral'}
          hint={
            d.purchases.dueSoon?.count
              ? `${formatMoney(d.purchases.dueSoon.amount)} vencen en los próximos 7 días`
              : `${d.purchases.overdue.count} ${d.purchases.overdue.count === 1 ? 'compra' : 'compras'} con pago vencido`
          }
          to="/compras/historial"
        />,
      );
    }
    tiles.push(
      <StatTile
        key="orders"
        label="Pedidos por recibir"
        value={d.purchases.pendingOrders}
        icon={d.purchases.pendingOrders ? Truck : PackageCheck}
        tone="neutral"
        hint="Borradores y pedidos a proveedor"
        to="/compras/historial"
      />,
    );
  }

  if (!tiles.length) return null;
  return <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">{tiles}</div>;
}

function SalesSection({ d, sales }: { d: Dashboard; sales: NonNullable<Dashboard['sales']> }) {
  const own = d.salesScope === 'own';
  const week = sales.last7.reduce((s, x) => s + x.total, 0);
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <ChartCard
        className="lg:col-span-2"
        title={own ? 'Mis ventas de los últimos 7 días' : 'Ventas de los últimos 7 días'}
        description={`Total de la semana: ${formatMoney(week)}`}
        table={{
          columns: [{ label: 'Día' }, { label: 'Ventas', numeric: true }, { label: 'Total', numeric: true }],
          rows: sales.last7.map((x) => [capitalize(longDate.format(new Date(`${x.date}T00:00:00Z`))), x.count, formatMoney(x.total)]),
        }}
      >
        <ColumnChart
          label={`Ventas por día de los últimos 7 días. Total ${formatMoney(week)}.`}
          money
          format={formatMoney}
          highlightKey={d.today}
          data={sales.last7.map((x) => ({
            key: x.date,
            label: x.date === d.today ? 'Hoy' : capitalize(weekday.format(new Date(`${x.date}T00:00:00Z`)).replace('.', '')),
            title: capitalize(longDate.format(new Date(`${x.date}T00:00:00Z`))),
            value: x.total,
            details: [{ label: 'Ventas', value: String(x.count) }],
          }))}
        />
      </ChartCard>

      <ChartCard title="Más vendidos" description="Unidades en los últimos 7 días" empty={sales.top.length === 0 && 'Aún no hay ventas esta semana.'}>
        <BarList
          label="Productos más vendidos"
          format={(v) => units(v)}
          items={sales.top.map((p) => ({ key: p.productId, label: p.name, value: p.units, detail: formatMoney(p.total) }))}
        />
      </ChartCard>

      <Card className="lg:col-span-3">
        <CardHeader
          title={own ? 'Mis últimas ventas' : 'Últimas ventas'}
          actions={
            <Link to="/ventas/historial" className="text-sm font-medium text-brand-700 hover:underline">
              Ver historial
            </Link>
          }
        />
        {sales.recent.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">Todavía no hay ventas registradas.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {sales.recent.map((s) => (
              <li key={s.id}>
                <Link to={`/ventas/historial/${s.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm hover:bg-slate-50">
                  <span className="flex items-center gap-3 sm:w-64">
                    <Receipt className="size-4 text-slate-400" />
                    <span className="font-mono font-medium text-slate-900">{s.folio}</span>
                    <SaleStatusBadge status={s.status as SaleStatus} />
                  </span>
                  <span className="order-last w-full text-slate-500 sm:order-none sm:w-auto sm:flex-1">
                    {formatDateTime(s.createdAt)}
                    {!own && ` · ${s.createdBy}`}
                  </span>
                  <span className="ml-auto font-medium tabular-nums text-slate-900">{formatMoney(s.total)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
