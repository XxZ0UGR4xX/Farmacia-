import { REPORT_GROUP_BY_LABELS } from '@farmacia/shared';
import { PackageMinus, PackagePlus, Scale } from 'lucide-react';
import type { ShrinkageReport } from '../../api/reports';
import { BarList } from '../../components/charts/BarList';
import { ChartCard, DataTable } from '../../components/charts/ChartCard';
import { ColumnChart } from '../../components/charts/ColumnChart';
import { StatTile } from '../../components/charts/StatTile';
import { Card, CardHeader } from '../../components/ui/Card';
import { formatMoney } from '../../lib/format';
import { count, lossLabel, periodLabel, units } from './report-display';

export function ShrinkageReportView({ report }: { report: ShrinkageReport }) {
  const { totals, range } = report;
  const fin = report.financial;
  // Con permiso financiero se mide en dinero; sin él, en unidades
  const measure = (x: { units: number; cost?: number }) => (fin ? x.cost ?? 0 : x.units);
  const fmt = fin ? formatMoney : units;
  const per = REPORT_GROUP_BY_LABELS[range.groupBy].toLowerCase();
  const empty = report.losses.length === 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3">
        <StatTile
          label="Bajas y mermas"
          value={fin ? formatMoney(totals.lossCost) : units(totals.lossUnits)}
          icon={PackageMinus}
          tone={totals.lossUnits ? 'warning' : 'neutral'}
          testId="shrinkage-loss"
          hint={fin ? units(totals.lossUnits) : 'Caducidad, daño, robo, ajustes y devoluciones desechadas'}
        />
        <StatTile
          label="Ajustes de entrada"
          value={fin ? formatMoney(totals.gainCost) : units(totals.gainUnits)}
          icon={PackagePlus}
          hint={fin ? `${units(totals.gainUnits)} (sobrantes de conteo y correcciones)` : 'Sobrantes de conteo y correcciones'}
        />
        {fin && <StatTile label="Pérdida neta" value={formatMoney(totals.netCost)} icon={Scale} tone={totals.netCost ? 'critical' : 'neutral'} hint="Bajas menos ajustes de entrada, a costo" />}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Bajas por motivo"
          description={fin ? 'Costo de lo que salió sin venderse' : 'Unidades que salieron sin venderse'}
          empty={empty && 'Sin bajas en el periodo.'}
          table={{
            columns: [{ label: 'Motivo' }, { label: 'Registros', numeric: true }, { label: 'Unidades', numeric: true }, ...(fin ? [{ label: 'Costo', numeric: true }] : [])],
            rows: [...report.losses, ...report.gains.map((g) => ({ ...g, entrada: true }))].map((l) => [
              `${'entrada' in l ? 'Entrada · ' : ''}${lossLabel(l.type, l.reason)}`,
              l.movements,
              l.units,
              ...(fin ? [formatMoney(l.cost)] : []),
            ]),
          }}
        >
          <BarList
            label="Bajas por motivo"
            format={fmt}
            items={[...report.losses]
              .sort((a, b) => measure(b) - measure(a))
              .map((l) => ({ key: `${l.type}:${l.reason}`, label: lossLabel(l.type, l.reason), value: measure(l), detail: `${count(l.movements, 'registro', 'registros')}${fin ? ` · ${units(l.units)}` : ''}` }))}
          />
        </ChartCard>

        <ChartCard
          title={`Bajas ${per}`}
          description={fin ? 'Costo de las bajas registradas' : 'Unidades dadas de baja'}
          empty={empty && 'Sin bajas en el periodo.'}
          table={{
            columns: [{ label: 'Periodo' }, { label: 'Unidades', numeric: true }, ...(fin ? [{ label: 'Costo', numeric: true }] : [])],
            rows: report.series.map((s) => [periodLabel(s.period, range.groupBy, range).title, s.units, ...(fin ? [formatMoney(s.cost)] : [])]),
          }}
        >
          <ColumnChart
            label={`Bajas ${per}`}
            money={fin}
            height={220}
            format={fmt}
            data={report.series.map((s) => {
              const p = periodLabel(s.period, range.groupBy, range);
              return { key: s.period, label: p.axis, title: p.title, value: measure(s), details: fin ? [{ label: 'Unidades', value: String(s.units) }] : [] };
            })}
          />
        </ChartCard>
      </div>

      <Card className="break-inside-avoid">
        <CardHeader title="Productos con más bajas" description="Para revisar compras, rotación o almacenamiento" />
        <div className="p-5">
          {report.top.length === 0 ? (
            <p className="text-center text-sm text-slate-500">Sin bajas en el periodo.</p>
          ) : (
            <DataTable
              caption="Productos con más bajas"
              table={{
                columns: [{ label: 'Producto' }, { label: 'SKU' }, { label: 'Unidades', numeric: true }, ...(fin ? [{ label: 'Costo', numeric: true }] : [])],
                rows: report.top.map((p) => [p.name, p.sku, p.units, ...(fin ? [formatMoney(p.cost)] : [])]),
              }}
            />
          )}
        </div>
      </Card>
    </div>
  );
}
