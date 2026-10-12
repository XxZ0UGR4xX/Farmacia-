import type { ExportFormat, ReportGroupBy, ReportKind } from '@farmacia/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, downloadFile } from './client';
import { toQuery } from './inventory';

export interface ReportRange {
  from: string;
  to: string;
  groupBy?: ReportGroupBy;
}

interface RangeEcho {
  from: string;
  to: string;
  days: number;
  groupBy: ReportGroupBy;
}

// --- Dashboard ---------------------------------------------------------------

export interface DaySummary {
  total: number;
  count: number;
  units: number;
  refunds: number;
  averageTicket: number;
  profit?: number;
}

export interface Dashboard {
  today: string;
  salesScope: 'branch' | 'own' | null;
  sales: {
    today: DaySummary;
    yesterday: DaySummary;
    last7: { date: string; total: number; count: number }[];
    top: { productId: string; name: string; units: number; total: number }[];
    recent: { id: string; folio: string; createdAt: string; total: number; status: string; createdBy: string }[];
  } | null;
  inventory: { lowStock: number; outOfStock: number; costValue?: number; retailValue?: number } | null;
  expirations: { criticalDays: number; expiringLots: number; expiringUnits: number; expiredLots: number; expiredUnits: number } | null;
  returns: { pendingReview: number } | null;
  purchases: {
    pendingOrders: number;
    overdue?: { count: number; amount: number };
    dueSoon?: { count: number; amount: number };
  } | null;
}

// --- Reportes ----------------------------------------------------------------

export interface SalesReport {
  range: RangeEcho;
  financial: boolean;
  totals: {
    count: number;
    units: number;
    gross: number;
    discount: number;
    tax: number;
    refunds: number;
    returns: number;
    returnedUnits: number;
    net: number;
    averageTicket: number;
    cancelled: { count: number; total: number };
    revenue?: number;
    cost?: number;
    profit?: number;
    margin?: number | null;
    markup?: number | null;
    marginBasis?: 'COST' | 'PRICE';
  };
  series: { period: string; count: number; units: number; gross: number; refunds: number; net: number; profit?: number }[];
  byMethod: { method: string; count: number; amount: number; refunds: number; net: number }[];
  byCashier: { userId: string; fullName: string; count: number; total: number; averageTicket: number; discount: number; cancelled: number }[];
  byCategory: { categoryId: string; name: string; units: number; total: number; profit?: number }[];
  byHour: { hour: number; count: number; total: number }[];
}

export interface ProductsReport {
  range: RangeEcho;
  financial: boolean;
  productsSold: number;
  top: { productId: string; sku: string; name: string; category: string; units: number; returned: number; sales: number; total: number; profit?: number }[];
  slowCount: number;
  slow: { productId: string; sku: string; name: string; category: string; stock: number; retailValue: number; costValue?: number; lastSale: string | null }[];
}

export interface InventoryReport {
  today: string;
  financial: boolean;
  totals: { products: number; units: number; retailValue: number; costValue?: number; potentialProfit?: number; outOfStock: number; lowStock: number };
  byCategory: { categoryId: string; name: string; products: number; units: number; retailValue: number; costValue?: number }[];
  risk: {
    criticalDays: number;
    expiringSoon: { lots: number; units: number; retailValue: number; costValue?: number };
    expired: { lots: number; units: number; costValue?: number };
    quarantine: { units: number; costValue?: number };
  };
}

export interface ShrinkageRow {
  type: string;
  reason: string | null;
  movements: number;
  units: number;
  cost?: number;
}

export interface ShrinkageReport {
  range: RangeEcho;
  financial: boolean;
  totals: { lossUnits: number; gainUnits: number; lossCost?: number; gainCost?: number; netCost?: number };
  losses: ShrinkageRow[];
  gains: ShrinkageRow[];
  top: { productId: string; sku: string; name: string; units: number; cost?: number }[];
  series: { period: string; units: number; cost?: number }[];
}

export interface PurchasesReport {
  range: RangeEcho;
  financial: true;
  totals: { count: number; subtotal: number; tax: number; total: number; paid: number; payable: number; overdue: number };
  bySupplier: { supplierId: string; name: string; count: number; subtotal: number; tax: number; total: number; paid: number; share: number | null }[];
  payables: { supplierId: string; name: string; count: number; balance: number; overdue: number; nextDue: string | null }[];
  series: { period: string; count: number; total: number }[];
}

export const reportKeys = {
  all: ['reports'] as const,
  dashboard: ['reports', 'dashboard'] as const,
  report: (kind: ReportKind, range: ReportRange | null) => ['reports', kind, range] as const,
};

export function useDashboard() {
  return useQuery({
    queryKey: reportKeys.dashboard,
    queryFn: ({ signal }) => api.get<Dashboard>('/reports/dashboard', { signal }),
    // Se mantiene al día mientras está abierto (ventas del mostrador)
    refetchInterval: 60_000,
  });
}

function useReport<T>(kind: ReportKind, range: ReportRange | null, enabled: boolean) {
  return useQuery({
    queryKey: reportKeys.report(kind, range),
    queryFn: ({ signal }) => api.get<T>(`/reports/${kind}${range ? `?${toQuery(range)}` : ''}`, { signal }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export const useSalesReport = (range: ReportRange, enabled = true) => useReport<SalesReport>('sales', range, enabled);
export const useProductsReport = (range: ReportRange, enabled = true) => useReport<ProductsReport>('products', range, enabled);
export const useInventoryReport = (enabled = true) => useReport<InventoryReport>('inventory', null, enabled);
export const useShrinkageReport = (range: ReportRange, enabled = true) => useReport<ShrinkageReport>('shrinkage', range, enabled);
export const usePurchasesReport = (range: ReportRange, enabled = true) => useReport<PurchasesReport>('purchases', range, enabled);

export function exportReport(kind: ReportKind, format: ExportFormat, range: ReportRange) {
  return downloadFile(`/reports/${kind}/export?${toQuery({ ...range, format })}`, `${kind}.${format}`);
}
