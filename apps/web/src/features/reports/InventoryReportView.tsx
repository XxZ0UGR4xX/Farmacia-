import { AlertTriangle, Boxes, PackageX, TrendingUp, Warehouse } from 'lucide-react';
import type { InventoryReport } from '../../api/reports';
import { BarList } from '../../components/charts/BarList';
import { ChartCard, DataTable } from '../../components/charts/ChartCard';
import { StatTile } from '../../components/charts/StatTile';
import { Card, CardHeader } from '../../components/ui/Card';
import { formatMoney } from '../../lib/format';
import { count, units } from './report-display';

export function InventoryReportView({ report }: { report: InventoryReport }) {
  const { totals, risk } = report;
  const fin = report.financial;
  const value = (c: { costValue?: number; retailValue: number }) => (fin ? c.costValue ?? 0 : c.retailValue);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {fin && (
          <StatTile label="Valor a costo" value={formatMoney(totals.costValue)} icon={Warehouse} tone="info" testId="inventory-cost" hint="Lo que costó la mercancía vendible" />
        )}
        <StatTile label="Valor a precio de venta" value={formatMoney(totals.retailValue)} icon={Boxes} tone="info" hint={`${count(totals.products, 'producto', 'productos')} · ${units(totals.units)}`} />
        {fin && (
          <StatTile label="Utilidad potencial" value={formatMoney(totals.potentialProfit)} icon={TrendingUp} tone="good" hint="Si todo se vendiera a precio de lista" />
        )}
        <StatTile
          label="Stock bajo / agotados"
          value={`${totals.lowStock} / ${totals.outOfStock}`}
          icon={totals.outOfStock ? PackageX : AlertTriangle}
          tone={totals.outOfStock ? 'critical' : totals.lowStock ? 'warning' : 'neutral'}
          hint="Productos en su mínimo o sin existencia"
          to="/inventario/existencias"
        />
      </div>

      <ChartCard
        title={`Valor del inventario por categoría ${fin ? '(a costo)' : '(a precio de venta)'}`}
        description="Sólo mercancía vendible: lotes activos sin caducar"
        empty={report.byCategory.length === 0 && 'No hay existencias.'}
        table={{
          columns: [
            { label: 'Categoría' },
            { label: 'Productos', numeric: true },
            { label: 'Unidades', numeric: true },
            { label: 'A precio de venta', numeric: true },
            ...(fin ? [{ label: 'A costo', numeric: true }] : []),
          ],
          rows: report.byCategory.map((c) => [c.name, c.products, c.units, formatMoney(c.retailValue), ...(fin ? [formatMoney(c.costValue)] : [])]),
        }}
      >
        <BarList
          label="Valor del inventario por categoría"
          format={formatMoney}
          items={[...report.byCategory]
            .sort((a, b) => value(b) - value(a))
            .map((c) => ({ key: c.categoryId, label: c.name, value: value(c), detail: `${count(c.products, 'producto', 'productos')} · ${units(c.units)}` }))}
        />
      </ChartCard>

      <Card className="break-inside-avoid">
        <CardHeader title="Mercancía en riesgo" description="Producto que puede convertirse en pérdida" />
        <div className="p-5">
          <DataTable
            caption="Mercancía en riesgo"
            table={{
              columns: [{ label: 'Concepto' }, { label: 'Lotes', numeric: true }, { label: 'Unidades', numeric: true }, ...(fin ? [{ label: 'Valor a costo', numeric: true }] : [])],
              rows: [
                [`Caduca en menos de ${risk.criticalDays} días`, risk.expiringSoon.lots, risk.expiringSoon.units, ...(fin ? [formatMoney(risk.expiringSoon.costValue)] : [])],
                ['Caducado con existencia (no se puede vender)', risk.expired.lots, risk.expired.units, ...(fin ? [formatMoney(risk.expired.costValue)] : [])],
                ['En cuarentena (devoluciones por revisar)', '—', risk.quarantine.units, ...(fin ? [formatMoney(risk.quarantine.costValue)] : [])],
              ],
            }}
          />
        </div>
      </Card>
    </div>
  );
}
