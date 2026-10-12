import { daysInRange, REPORT_GROUP_BY, REPORT_GROUP_BY_LABELS, REPORT_KIND_LABELS, REPORT_MAX_DAYS, type ExportFormat, type ReportGroupBy, type ReportKind } from '@farmacia/shared';
import { clsx } from 'clsx';
import { BarChart3, FileSpreadsheet, FileText, Printer } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { exportReport, useInventoryReport, useProductsReport, usePurchasesReport, useSalesReport, useShrinkageReport, type ReportRange } from '../../api/reports';
import { useAuth } from '../../auth/useAuth';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card, PageHeader } from '../../components/ui/Card';
import { TextField } from '../../components/ui/FormField';
import { SelectField } from '../../components/ui/SelectField';
import { Spinner } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { formatDateTime } from '../../lib/format';
import { useToday } from '../../lib/useToday';
import { InventoryReportView } from './InventoryReportView';
import { ProductsReportView } from './ProductsReportView';
import { PurchasesReportView } from './PurchasesReportView';
import { rangeLabel, shiftDate } from './report-display';
import { SalesReportView } from './SalesReportView';
import { ShrinkageReportView } from './ShrinkageReportView';

interface Tab {
  id: string;
  kind: ReportKind;
  /** El inventario es una fotografía de hoy: no usa periodo */
  ranged: boolean;
}

const TABS: Tab[] = [
  { id: 'ventas', kind: 'sales', ranged: true },
  { id: 'productos', kind: 'products', ranged: true },
  { id: 'inventario', kind: 'inventory', ranged: false },
  { id: 'mermas', kind: 'shrinkage', ranged: true },
  { id: 'compras', kind: 'purchases', ranged: true },
];

function presets(today: string): { label: string; from: string; to: string }[] {
  const month = today.slice(0, 7);
  const prev = new Date(`${month}-01T00:00:00Z`);
  prev.setUTCMonth(prev.getUTCMonth() - 1);
  const prevMonth = prev.toISOString().slice(0, 7);
  return [
    { label: 'Hoy', from: today, to: today },
    { label: '7 días', from: shiftDate(today, -6), to: today },
    { label: '30 días', from: shiftDate(today, -29), to: today },
    { label: 'Este mes', from: `${month}-01`, to: today },
    { label: 'Mes anterior', from: `${prevMonth}-01`, to: shiftDate(`${month}-01`, -1) },
    { label: 'Este año', from: `${today.slice(0, 4)}-01-01`, to: today },
  ];
}

export function ReportsPage() {
  const { can, user } = useAuth();
  const toast = useToast();
  const today = useToday();
  const [params, setParams] = useSearchParams();
  const [exporting, setExporting] = useState<ExportFormat | null>(null);

  const tabs = TABS.filter((t) => t.kind !== 'purchases' || can('reports.financial'));
  const tab = tabs.find((t) => t.id === params.get('tab')) ?? tabs[0]!;
  const from = params.get('desde') || shiftDate(today, -29);
  const to = params.get('hasta') || today;
  const groupParam = params.get('agrupar');
  const groupBy = REPORT_GROUP_BY.includes(groupParam as ReportGroupBy) ? (groupParam as ReportGroupBy) : undefined;
  const range: ReportRange = { from, to, ...(groupBy ? { groupBy } : {}) };
  const invalid = from > to ? 'La fecha inicial no puede ser posterior a la final.' : daysInRange(from, to) > REPORT_MAX_DAYS ? `El periodo máximo es de ${REPORT_MAX_DAYS} días.` : null;
  const ready = !invalid;

  const update = (patch: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v) next.set(k, v);
          else next.delete(k);
        }
        return next;
      },
      { replace: true },
    );

  const sales = useSalesReport(range, ready && tab.kind === 'sales');
  const products = useProductsReport(range, ready && tab.kind === 'products');
  const inventory = useInventoryReport(tab.kind === 'inventory');
  const shrinkage = useShrinkageReport(range, ready && tab.kind === 'shrinkage');
  const purchases = usePurchasesReport(range, ready && tab.kind === 'purchases');
  const query = { sales, products, inventory, shrinkage, purchases }[tab.kind];

  let content: ReactNode = null;
  if (tab.kind === 'sales' && sales.data) content = <SalesReportView report={sales.data} />;
  if (tab.kind === 'products' && products.data) content = <ProductsReportView report={products.data} />;
  if (tab.kind === 'inventory' && inventory.data) content = <InventoryReportView report={inventory.data} />;
  if (tab.kind === 'shrinkage' && shrinkage.data) content = <ShrinkageReportView report={shrinkage.data} />;
  if (tab.kind === 'purchases' && purchases.data) content = <PurchasesReportView report={purchases.data} />;

  const download = async (format: ExportFormat) => {
    setExporting(format);
    try {
      await exportReport(tab.kind, format, range);
    } catch {
      toast.error('No se pudo exportar el reporte');
    } finally {
      setExporting(null);
    }
  };

  const activePreset = presets(today).find((p) => p.from === from && p.to === to)?.label;
  const periodText = tab.ranged ? rangeLabel(from, to) : `Existencias al ${rangeLabel(today, today)}`;

  return (
    <div className="print-page">
      <PageHeader
        title="Reportes"
        description="Indicadores de la sucursal para decidir compras, precios y personal."
        actions={
          can('reports.export') && (
            <div className="flex flex-wrap gap-2 print:hidden">
              <Button variant="secondary" size="sm" icon={<FileSpreadsheet className="size-4" />} loading={exporting === 'xlsx'} disabled={!ready} onClick={() => download('xlsx')}>
                Excel
              </Button>
              <Button variant="secondary" size="sm" icon={<FileText className="size-4" />} loading={exporting === 'csv'} disabled={!ready} onClick={() => download('csv')}>
                CSV
              </Button>
              <Button variant="secondary" size="sm" icon={<Printer className="size-4" />} disabled={!content} onClick={() => window.print()}>
                Imprimir / PDF
              </Button>
            </div>
          )
        }
      />

      {/* Encabezado que sólo aparece en papel / PDF */}
      <div className="mb-4 hidden border-b border-slate-300 pb-2 text-sm print:block">
        <p className="font-semibold">Reporte de {REPORT_KIND_LABELS[tab.kind].toLowerCase()} · {periodText}</p>
        <p className="text-slate-600">
          Generado el {formatDateTime(new Date().toISOString())} por {user?.fullName}
        </p>
      </div>

      <div role="tablist" aria-label="Tipo de reporte" className="-mx-4 mb-4 flex gap-1 overflow-x-auto border-b border-slate-200 px-4 sm:mx-0 sm:px-0 print:hidden">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === tab.id}
            onClick={() => update({ tab: t.id === tabs[0]!.id ? null : t.id })}
            className={clsx(
              '-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
              t.id === tab.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700',
            )}
          >
            {REPORT_KIND_LABELS[t.kind]}
          </button>
        ))}
      </div>

      {/* Filtros: una sola fila arriba de las gráficas */}
      <Card className="mb-6 p-4 print:hidden">
        {tab.ranged ? (
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-wrap gap-1" role="group" aria-label="Periodos rápidos">
              {presets(today).map((p) => (
                <button
                  key={p.label}
                  type="button"
                  aria-pressed={activePreset === p.label}
                  onClick={() => update({ desde: p.from, hasta: p.to === today ? null : p.to })}
                  className={clsx(
                    'h-9 rounded-lg px-3 text-sm font-medium ring-1 ring-inset transition-colors',
                    activePreset === p.label ? 'bg-brand-50 text-brand-800 ring-brand-300' : 'text-slate-600 ring-slate-200 hover:bg-slate-50',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-3 lg:max-w-xl">
              <TextField label="Desde" type="date" value={from} max={to} onChange={(e) => e.target.value && update({ desde: e.target.value })} />
              <TextField label="Hasta" type="date" value={to} min={from} max={today} onChange={(e) => e.target.value && update({ hasta: e.target.value === today ? null : e.target.value })} />
              <SelectField className="col-span-2 sm:col-span-1" label="Agrupar" value={groupBy ?? ''} onChange={(e) => update({ agrupar: e.target.value || null })}>
                <option value="">Automático</option>
                {REPORT_GROUP_BY.map((g) => (
                  <option key={g} value={g}>
                    {REPORT_GROUP_BY_LABELS[g]}
                  </option>
                ))}
              </SelectField>
            </div>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-sm text-slate-600">
            <BarChart3 className="size-4 text-slate-400" />
            Fotografía del inventario al día de hoy ({rangeLabel(today, today)}); no depende del periodo.
          </p>
        )}
      </Card>

      {tab.ranged && invalid && (
        <Alert tone="warning" className="mb-4">
          {invalid}
        </Alert>
      )}
      {query.isError && <Alert tone="error">No se pudo cargar el reporte.</Alert>}
      {!invalid && query.isPending ? (
        <div className="flex justify-center py-16 text-brand-600">
          <Spinner />
        </div>
      ) : (
        <div className={clsx(query.isPlaceholderData && 'opacity-60 transition-opacity')} aria-busy={query.isFetching}>
          {content}
        </div>
      )}
    </div>
  );
}
