import { PackageSearch, ShoppingBag } from 'lucide-react';
import { Link } from 'react-router';
import type { ProductsReport } from '../../api/reports';
import { BarList } from '../../components/charts/BarList';
import { ChartCard, DataTable } from '../../components/charts/ChartCard';
import { StatTile } from '../../components/charts/StatTile';
import { Card, CardHeader } from '../../components/ui/Card';
import { formatDateTime, formatMoney } from '../../lib/format';
import { count, units } from './report-display';

export function ProductsReportView({ report }: { report: ProductsReport }) {
  const fin = report.financial;
  const slowValue = report.slow.reduce((s, p) => s + (fin ? p.costValue ?? 0 : p.retailValue), 0);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <StatTile label="Productos distintos vendidos" value={report.productsSold} icon={ShoppingBag} tone="info" />
        <StatTile
          label="Sin movimiento"
          value={report.slowCount}
          icon={PackageSearch}
          tone={report.slowCount ? 'warning' : 'neutral'}
          hint={report.slowCount ? `Con existencia y sin ventas en el periodo · ${formatMoney(slowValue)} ${fin ? 'a costo' : 'a precio de venta'}${report.slowCount > report.slow.length ? ` (primeros ${report.slow.length})` : ''}` : 'Todo lo que hay en anaquel se vendió'}
        />
      </div>

      <ChartCard
        title="Los más vendidos"
        description="Unidades vendidas en el periodo (las 10 primeras)"
        empty={report.top.length === 0 && 'No hay ventas en este periodo.'}
        table={{
          columns: [
            { label: 'Producto' },
            { label: 'Categoría' },
            { label: 'Unidades', numeric: true },
            { label: 'Devueltas', numeric: true },
            { label: 'Ventas', numeric: true },
            { label: 'Total', numeric: true },
            ...(fin ? [{ label: 'Utilidad bruta', numeric: true }] : []),
          ],
          rows: report.top.map((p) => [p.name, p.category, p.units, p.returned, p.sales, formatMoney(p.total), ...(fin ? [formatMoney(p.profit)] : [])]),
        }}
      >
        <BarList
          label="Productos más vendidos por unidades"
          format={units}
          items={report.top.slice(0, 10).map((p) => ({
            key: p.productId,
            label: p.name,
            value: p.units,
            detail: `${formatMoney(p.total)}${fin ? ` · utilidad ${formatMoney(p.profit)}` : ''}${p.returned ? ` · ${count(p.returned, 'unidad devuelta', 'unidades devueltas')}` : ''}`,
          }))}
        />
      </ChartCard>

      <Card className="break-inside-avoid">
        <CardHeader
          title="Productos sin movimiento"
          description="Tienen existencia vendible pero no se vendieron en el periodo. Ordenados por el dinero detenido en anaquel."
        />
        <div className="p-5">
          {report.slow.length === 0 ? (
            <p className="text-center text-sm text-slate-500">Ninguno: todo lo que tiene existencia se vendió en el periodo.</p>
          ) : (
            <DataTable
              caption="Productos sin movimiento"
              table={{
                columns: [
                  { label: 'Producto' },
                  { label: 'Categoría' },
                  { label: 'Existencia', numeric: true },
                  { label: 'A precio de venta', numeric: true },
                  ...(fin ? [{ label: 'A costo', numeric: true }] : []),
                  { label: 'Última venta' },
                ],
                rows: report.slow.map((p) => [
                  // Texto plano para la tabla; el enlace lleva a la ficha de existencias
                  p.name,
                  p.category,
                  p.stock,
                  formatMoney(p.retailValue),
                  ...(fin ? [formatMoney(p.costValue)] : []),
                  p.lastSale ? formatDateTime(p.lastSale) : 'Nunca',
                ]),
              }}
            />
          )}
          {report.slow.length > 0 && (
            <p className="mt-3 text-xs text-slate-500 print:hidden">
              Revisa sus lotes y caducidades en <Link to="/inventario/existencias" className="font-medium text-brand-700 hover:underline">Existencias</Link>.
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
