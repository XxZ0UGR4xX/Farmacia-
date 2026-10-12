import { PAYMENT_METHOD_LABELS, REPORT_GROUP_BY_LABELS, type PaymentMethod } from '@farmacia/shared';
import { Ban, CircleDollarSign, Percent, ShoppingBag, TrendingUp, Undo2 } from 'lucide-react';
import type { SalesReport } from '../../api/reports';
import { BarList } from '../../components/charts/BarList';
import { ChartCard, DataTable } from '../../components/charts/ChartCard';
import { ColumnChart } from '../../components/charts/ColumnChart';
import { StatTile } from '../../components/charts/StatTile';
import { Card, CardHeader } from '../../components/ui/Card';
import { formatMoney } from '../../lib/format';
import { count, periodLabel, ratio, units } from './report-display';

const methodLabel = (m: string) => PAYMENT_METHOD_LABELS[m as PaymentMethod] ?? m;
const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

export function SalesReportView({ report }: { report: SalesReport }) {
  const { totals, range } = report;
  const fin = report.financial;
  const per = REPORT_GROUP_BY_LABELS[range.groupBy].toLowerCase();
  const series = report.series.map((s) => ({ ...s, ...periodLabel(s.period, range.groupBy, range) }));
  // Horario corrido entre la primera y la última hora con ventas (mínimo 8:00 a 21:00)
  const hours = report.byHour.length
    ? Array.from({ length: 24 }, (_, h) => h).filter(
        (h) => h >= Math.min(8, ...report.byHour.map((x) => x.hour)) && h <= Math.max(21, ...report.byHour.map((x) => x.hour)),
      )
    : [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatTile
          label="Ventas netas"
          value={formatMoney(totals.net)}
          icon={CircleDollarSign}
          tone="good"
          testId="report-net"
          hint={`Brutas ${formatMoney(totals.gross)} − devoluciones ${formatMoney(totals.refunds)}`}
        />
        <StatTile
          label="Ventas"
          value={totals.count.toLocaleString('es-MX')}
          icon={ShoppingBag}
          tone="info"
          hint={`Ticket promedio ${formatMoney(totals.averageTicket)} · ${units(totals.units)}`}
        />
        {fin ? (
          <StatTile
            label="Utilidad bruta"
            value={formatMoney(totals.profit)}
            icon={TrendingUp}
            tone="good"
            testId="report-profit"
            hint={`Margen ${ratio(totals.margin)} sobre venta · ${ratio(totals.markup)} sobre costo`}
          />
        ) : (
          <StatTile label="Descuentos" value={formatMoney(totals.discount)} icon={Percent} hint="Otorgados en el periodo" />
        )}
        <StatTile
          label="Devoluciones y cancelaciones"
          value={formatMoney(totals.refunds)}
          icon={totals.cancelled.count ? Ban : Undo2}
          tone={totals.refunds || totals.cancelled.count ? 'warning' : 'neutral'}
          hint={`${count(totals.returns, 'devolución', 'devoluciones')} · ${count(totals.cancelled.count, 'venta cancelada', 'ventas canceladas')} (${formatMoney(totals.cancelled.total)})`}
        />
      </div>

      <ChartCard
        title={`Ventas netas ${per}`}
        description="Ventas cobradas menos devoluciones; las canceladas no cuentan."
        empty={totals.count === 0 && totals.refunds === 0 && 'No hay ventas en este periodo.'}
        table={{
          columns: [
            { label: 'Periodo' },
            { label: 'Ventas', numeric: true },
            { label: 'Brutas', numeric: true },
            { label: 'Devoluciones', numeric: true },
            { label: 'Netas', numeric: true },
            ...(fin ? [{ label: 'Utilidad bruta', numeric: true }] : []),
          ],
          rows: series.map((s) => [s.title, s.count, formatMoney(s.gross), formatMoney(s.refunds), formatMoney(s.net), ...(fin ? [formatMoney(s.profit)] : [])]),
        }}
      >
        <ColumnChart
          label={`Ventas netas ${per} del periodo. Total ${formatMoney(totals.net)}.`}
          money
          height={240}
          format={formatMoney}
          data={series.map((s) => ({
            key: s.period,
            label: s.axis,
            title: s.title,
            value: s.net,
            details: [
              { label: 'Ventas', value: String(s.count) },
              { label: 'Brutas', value: formatMoney(s.gross) },
              ...(s.refunds ? [{ label: 'Devoluciones', value: formatMoney(s.refunds) }] : []),
              ...(fin ? [{ label: 'Utilidad bruta', value: formatMoney(s.profit) }] : []),
            ],
          }))}
        />
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <ChartCard
          title="Formas de pago"
          description="Cobrado menos reembolsos de cada forma de pago"
          empty={report.byMethod.length === 0 && 'Sin cobros en el periodo.'}
          table={{
            columns: [{ label: 'Forma de pago' }, { label: 'Ventas', numeric: true }, { label: 'Cobrado', numeric: true }, { label: 'Reembolsado', numeric: true }, { label: 'Neto', numeric: true }],
            rows: report.byMethod.map((m) => [methodLabel(m.method), m.count, formatMoney(m.amount), formatMoney(m.refunds), formatMoney(m.net)]),
          }}
        >
          <BarList
            label="Neto por forma de pago"
            format={formatMoney}
            items={report.byMethod.map((m) => ({
              key: m.method,
              label: methodLabel(m.method),
              value: m.net,
              detail: `${count(m.count, 'venta', 'ventas')}${m.refunds ? ` · reembolsos ${formatMoney(m.refunds)}` : ''}`,
            }))}
          />
        </ChartCard>

        <ChartCard
          title="Ventas por categoría"
          description="Total cobrado por categoría de producto"
          empty={report.byCategory.length === 0 && 'Sin ventas en el periodo.'}
          table={{
            columns: [{ label: 'Categoría' }, { label: 'Unidades', numeric: true }, { label: 'Total', numeric: true }, ...(fin ? [{ label: 'Utilidad bruta', numeric: true }] : [])],
            rows: report.byCategory.map((c) => [c.name, c.units, formatMoney(c.total), ...(fin ? [formatMoney(c.profit)] : [])]),
          }}
        >
          <BarList
            label="Total por categoría"
            format={formatMoney}
            items={report.byCategory.slice(0, 8).map((c) => ({
              key: c.categoryId,
              label: c.name,
              value: c.total,
              detail: `${units(c.units)}${fin ? ` · utilidad ${formatMoney(c.profit)}` : ''}`,
            }))}
          />
          {report.byCategory.length > 8 && <p className="mt-3 text-xs text-slate-500 print:hidden">Se muestran 8 de {report.byCategory.length} categorías; usa "Ver tabla" para verlas todas.</p>}
        </ChartCard>
      </div>

      <ChartCard
        title="Ventas por hora del día"
        description="Total cobrado según la hora de la venta (útil para organizar turnos)"
        empty={hours.length === 0 && 'Sin ventas en el periodo.'}
        table={{
          columns: [{ label: 'Hora' }, { label: 'Ventas', numeric: true }, { label: 'Total', numeric: true }],
          rows: report.byHour.map((h) => [hourLabel(h.hour), h.count, formatMoney(h.total)]),
        }}
      >
        <ColumnChart
          label="Total vendido por hora del día"
          money
          height={200}
          format={formatMoney}
          data={hours.map((h) => {
            const x = report.byHour.find((b) => b.hour === h);
            return {
              key: String(h),
              label: String(h),
              title: `De ${hourLabel(h)} a ${hourLabel((h + 1) % 24)}`,
              value: x?.total ?? 0,
              details: [{ label: 'Ventas', value: String(x?.count ?? 0) }],
            };
          })}
        />
      </ChartCard>

      <Card className="break-inside-avoid">
        <CardHeader title="Ventas por usuario" description="Quién cobró, cuánto y cuántas de sus ventas se cancelaron" />
        <div className="p-5">
          {report.byCashier.length === 0 ? (
            <p className="text-center text-sm text-slate-500">Sin ventas en el periodo.</p>
          ) : (
            <DataTable
              caption="Ventas por usuario"
              table={{
                columns: [
                  { label: 'Usuario' },
                  { label: 'Ventas', numeric: true },
                  { label: 'Total', numeric: true },
                  { label: 'Ticket promedio', numeric: true },
                  { label: 'Descuentos', numeric: true },
                  { label: 'Canceladas', numeric: true },
                ],
                rows: report.byCashier.map((c) => [c.fullName, c.count, formatMoney(c.total), formatMoney(c.averageTicket), formatMoney(c.discount), c.cancelled]),
              }}
            />
          )}
        </div>
      </Card>
    </div>
  );
}
