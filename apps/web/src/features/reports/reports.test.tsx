import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setSession } from '../../api/client';
import type { Dashboard, SalesReport } from '../../api/reports';
import { mockApi, renderApp, sessionUser } from '../../test/render';
import { DashboardPage } from '../dashboard/DashboardPage';
import { ReportsPage } from './ReportsPage';

afterEach(() => {
  vi.unstubAllGlobals();
  setSession(null);
});

const clock = { 'GET /settings/clock': { today: '2026-10-12', timeZone: 'America/Mexico_City' } };
const days = ['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12'];

const dashboard = (extra: Partial<Dashboard> = {}): Dashboard => ({
  today: '2026-10-12',
  salesScope: 'branch',
  sales: {
    today: { total: 500, count: 2, units: 5, refunds: 100, averageTicket: 250, profit: 240 },
    yesterday: { total: 400, count: 3, units: 4, refunds: 0, averageTicket: 133.33, profit: 150 },
    last7: days.map((date, i) => ({ date, total: i * 100, count: i })),
    top: [{ productId: 'p1', name: 'Paracetamol 500 mg', units: 7, total: 245 }],
    recent: [{ id: 's1', folio: 'V-000056', createdAt: '2026-10-12T18:00:00.000Z', total: 89, status: 'COMPLETED', createdBy: 'Sofía Ramírez' }],
  },
  inventory: { lowStock: 3, outOfStock: 1, costValue: 20742, retailValue: 45003 },
  expirations: { criticalDays: 30, expiringLots: 2, expiringUnits: 12, expiredLots: 1, expiredUnits: 6 },
  returns: { pendingReview: 1 },
  purchases: { pendingOrders: 2, overdue: { count: 1, amount: 660 }, dueSoon: { count: 1, amount: 540 } },
  ...extra,
});

describe('DashboardPage', () => {
  it('indicadores reales, gráfica de 7 días con tooltip y vista de tabla', async () => {
    mockApi({ ...clock, 'GET /reports/dashboard': dashboard() });
    renderApp(<DashboardPage />, { user: sessionUser('OWNER') });

    expect(await screen.findByTestId('kpi-sales-today')).toHaveTextContent('$500.00');
    // 500 contra 400 de ayer
    expect(screen.getByText('+25 %')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-profit')).toHaveTextContent('$240.00');
    expect(screen.getByText('Valor del inventario')).toBeInTheDocument();
    expect(screen.getByText('Pagos vencidos a proveedores')).toBeInTheDocument();
    expect(screen.getByText('V-000056')).toBeInTheDocument();
    expect(screen.queryByText(/en construcción/)).not.toBeInTheDocument();

    const hits = screen.getAllByTestId('column-hit');
    expect(hits).toHaveLength(7);
    fireEvent.pointerEnter(hits[6]!);
    expect(screen.getByRole('status')).toHaveTextContent('Lunes, 12 de octubre');
    expect(screen.getByRole('status')).toHaveTextContent('$600.00');

    await userEvent.click(screen.getAllByRole('button', { name: 'Ver tabla' })[0]!);
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(8);
  });

  it('el farmacéutico ve sus ventas, sin utilidad ni saldos con proveedores', async () => {
    const { profit: _p, ...today } = dashboard().sales!.today;
    mockApi({
      ...clock,
      'GET /reports/dashboard': dashboard({
        salesScope: 'own',
        sales: { ...dashboard().sales!, today, yesterday: { ...today, total: 0 } },
        inventory: { lowStock: 3, outOfStock: 0 },
        purchases: { pendingOrders: 2 },
      }),
    });
    renderApp(<DashboardPage />, { user: sessionUser('PHARMACIST') });
    expect(await screen.findByText('Mis ventas de hoy')).toBeInTheDocument();
    expect(screen.queryByTestId('kpi-profit')).not.toBeInTheDocument();
    expect(screen.queryByText('Valor del inventario')).not.toBeInTheDocument();
    expect(screen.queryByText('Pagos vencidos a proveedores')).not.toBeInTheDocument();
    // Sin ventas ayer no hay base para comparar
    expect(screen.queryByText(/vs\. ayer/)).not.toBeInTheDocument();
  });
});

const salesReport = (financial = true): SalesReport => ({
  range: { from: '2026-09-13', to: '2026-10-12', days: 30, groupBy: 'day' },
  financial,
  totals: {
    count: 2,
    units: 5,
    gross: 500,
    discount: 0,
    tax: 0,
    refunds: 100,
    returns: 1,
    returnedUnits: 1,
    net: 400,
    averageTicket: 250,
    cancelled: { count: 1, total: 100 },
    ...(financial ? { revenue: 400, cost: 160, profit: 240, margin: 0.6, markup: 1.5 } : {}),
  },
  series: [{ period: '2026-10-12', count: 2, units: 5, gross: 500, refunds: 100, net: 400, ...(financial ? { profit: 240 } : {}) }],
  byMethod: [{ method: 'CASH', count: 1, amount: 300, refunds: 100, net: 200 }],
  byCashier: [{ userId: 'u1', fullName: 'Sofía Ramírez', count: 2, total: 500, averageTicket: 250, discount: 0, cancelled: 1 }],
  byCategory: [{ categoryId: 'c1', name: 'Analgésicos', units: 5, total: 500, ...(financial ? { profit: 300 } : {}) }],
  byHour: [{ hour: 10, count: 2, total: 500 }],
});

describe('ReportsPage', () => {
  it('reporte de ventas con utilidad; los periodos rápidos cambian la consulta y se exporta a Excel', async () => {
    const fetchMock = mockApi({
      ...clock,
      'GET /reports/sales': salesReport(),
      'GET /reports/sales/export': () => new Response('xlsx', { status: 200, headers: { 'Content-Disposition': 'attachment; filename="ventas.xlsx"' } }),
    });
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }));
    renderApp(<ReportsPage />, { user: sessionUser('OWNER'), path: '/reportes' });

    expect(await screen.findByTestId('report-net')).toHaveTextContent('$400.00');
    expect(screen.getByTestId('report-profit')).toHaveTextContent('$240.00');
    expect(screen.getByText(/Margen 60 % sobre venta · 150 % sobre costo/)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Compras' })).toBeInTheDocument();
    expect(screen.getByText('Sofía Ramírez')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '7 días' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/reports/sales?from=2026-10-06&to=2026-10-12'))).toBe(true));

    await userEvent.click(screen.getByRole('button', { name: 'Excel' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => /\/reports\/sales\/export\?from=2026-10-06&to=2026-10-12&format=xlsx/.test(String(url)))).toBe(true),
    );
  });

  it('sin permiso financiero: sin utilidad, sin compras y sin exportar si no se tiene el permiso', async () => {
    mockApi({ ...clock, 'GET /reports/sales': salesReport(false) });
    renderApp(<ReportsPage />, { user: sessionUser('CASHIER', { permissions: ['reports.view', 'sales.view'] }), path: '/reportes' });
    expect(await screen.findByTestId('report-net')).toBeInTheDocument();
    expect(screen.queryByTestId('report-profit')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Compras' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Excel' })).not.toBeInTheDocument();
  });

  it('un periodo inválido no consulta y lo explica', async () => {
    const fetchMock = mockApi({ ...clock, 'GET /reports/sales': salesReport() });
    renderApp(<ReportsPage />, { user: sessionUser('OWNER'), path: '/reportes?desde=2026-10-12&hasta=2026-10-01' });
    expect(await screen.findByText('La fecha inicial no puede ser posterior a la final.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/reports/sales'))).toBe(false);
  });

  it('pestaña de inventario: fotografía de hoy, sin periodo', async () => {
    mockApi({
      ...clock,
      'GET /reports/inventory': {
        today: '2026-10-12',
        financial: true,
        totals: { products: 30, units: 826, retailValue: 45003, costValue: 20742, potentialProfit: 24261, outOfStock: 0, lowStock: 12 },
        byCategory: [{ categoryId: 'c1', name: 'Antibióticos', products: 5, units: 58, retailValue: 7181, costValue: 3590 }],
        risk: { criticalDays: 30, expiringSoon: { lots: 1, units: 2, retailValue: 120, costValue: 80 }, expired: { lots: 0, units: 0, costValue: 0 }, quarantine: { units: 0, costValue: 0 } },
      },
    });
    renderApp(<ReportsPage />, { user: sessionUser('OWNER'), path: '/reportes?tab=inventario' });
    expect(await screen.findByTestId('inventory-cost')).toHaveTextContent('$20,742.00');
    expect(screen.getByText(/Fotografía del inventario al día de hoy/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Desde')).not.toBeInTheDocument();
    expect(screen.getByText('Caduca en menos de 30 días')).toBeInTheDocument();
  });
});
