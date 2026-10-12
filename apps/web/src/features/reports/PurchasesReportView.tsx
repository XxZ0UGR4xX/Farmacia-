import { REPORT_GROUP_BY_LABELS } from '@farmacia/shared';
import { AlarmClock, HandCoins, Truck, Wallet } from 'lucide-react';
import type { PurchasesReport } from '../../api/reports';
import { BarList } from '../../components/charts/BarList';
import { ChartCard, DataTable } from '../../components/charts/ChartCard';
import { ColumnChart } from '../../components/charts/ColumnChart';
import { StatTile } from '../../components/charts/StatTile';
import { Card, CardHeader } from '../../components/ui/Card';
import { formatDate, formatMoney } from '../../lib/format';
import { count, periodLabel, ratio } from './report-display';

export function PurchasesReportView({ report }: { report: PurchasesReport }) {
  const { totals, range } = report;
  const per = REPORT_GROUP_BY_LABELS[range.groupBy].toLowerCase();
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatTile label="Compras recibidas" value={formatMoney(totals.total)} icon={Truck} tone="info" testId="purchases-total" hint={`${count(totals.count, 'compra', 'compras')} · IVA ${formatMoney(totals.tax)}`} />
        <StatTile label="Pagado de esas compras" value={formatMoney(totals.paid)} icon={HandCoins} hint="Abonos registrados a la fecha" />
        <StatTile label="Saldo por pagar" value={formatMoney(totals.payable)} icon={Wallet} tone={totals.payable ? 'warning' : 'neutral'} hint="Todas las compras recibidas con saldo" to="/compras/historial" />
        <StatTile label="Vencido" value={formatMoney(totals.overdue)} icon={AlarmClock} tone={totals.overdue ? 'critical' : 'neutral'} hint={totals.overdue ? 'Pagos con fecha límite ya pasada' : 'Sin pagos vencidos'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Compras por proveedor"
          description="Total de compras recibidas en el periodo"
          empty={report.bySupplier.length === 0 && 'No hay compras recibidas en este periodo.'}
          table={{
            columns: [
              { label: 'Proveedor' },
              { label: 'Compras', numeric: true },
              { label: 'Subtotal', numeric: true },
              { label: 'IVA', numeric: true },
              { label: 'Total', numeric: true },
              { label: 'Pagado', numeric: true },
              { label: 'Participación', numeric: true },
            ],
            rows: report.bySupplier.map((s) => [s.name, s.count, formatMoney(s.subtotal), formatMoney(s.tax), formatMoney(s.total), formatMoney(s.paid), ratio(s.share)]),
          }}
        >
          <BarList
            label="Compras por proveedor"
            format={formatMoney}
            items={report.bySupplier.slice(0, 8).map((s) => ({ key: s.supplierId, label: s.name, value: s.total, detail: `${count(s.count, 'compra', 'compras')} · ${ratio(s.share)} del total` }))}
          />
        </ChartCard>

        <ChartCard
          title={`Compras ${per}`}
          description="Según la fecha de la factura"
          empty={report.bySupplier.length === 0 && 'No hay compras recibidas en este periodo.'}
          table={{
            columns: [{ label: 'Periodo' }, { label: 'Compras', numeric: true }, { label: 'Total', numeric: true }],
            rows: report.series.map((s) => [periodLabel(s.period, range.groupBy, range).title, s.count, formatMoney(s.total)]),
          }}
        >
          <ColumnChart
            label={`Compras ${per}`}
            money
            format={formatMoney}
            data={report.series.map((s) => {
              const p = periodLabel(s.period, range.groupBy, range);
              return { key: s.period, label: p.axis, title: p.title, value: s.total, details: [{ label: 'Compras', value: String(s.count) }] };
            })}
          />
        </ChartCard>
      </div>

      <Card className="break-inside-avoid">
        <CardHeader title="Cuentas por pagar" description="Saldo pendiente con cada proveedor (sin importar el periodo)" />
        <div className="p-5">
          {report.payables.length === 0 ? (
            <p className="text-center text-sm text-slate-500">No hay saldos pendientes con proveedores.</p>
          ) : (
            <DataTable
              caption="Cuentas por pagar"
              table={{
                columns: [{ label: 'Proveedor' }, { label: 'Compras con saldo', numeric: true }, { label: 'Saldo', numeric: true }, { label: 'Vencido', numeric: true }, { label: 'Próximo vencimiento' }],
                rows: report.payables.map((p) => [p.name, p.count, formatMoney(p.balance), formatMoney(p.overdue), p.nextDue ? formatDate(p.nextDue) : '—']),
              }}
            />
          )}
        </div>
      </Card>
    </div>
  );
}
