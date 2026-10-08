import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Batch, StockRow } from '../../api/inventory';
import { setSession } from '../../api/client';
import { mockApi, renderApp, sessionUser } from '../../test/render';
import { AdjustDialog } from './AdjustDialog';
import { EntryDialog } from './EntryDialog';
import { ProductInventoryPage } from './ProductInventoryPage';
import { StockPage } from './StockPage';

const batch = (extra: Partial<Batch> = {}): Batch => ({
  id: 'b1',
  product: { id: 'p1', sku: 'MED-000001', commercialName: 'Paracetamol 500 mg', concentration: '500 mg', presentation: 'BOX', contentQuantity: '20 tabletas' },
  lotNumber: 'PCT2504A',
  quantity: 10,
  initialQuantity: 15,
  expiresAt: '2030-01-31',
  manufacturedAt: null,
  daysLeft: 400,
  expiryStatus: 'OK',
  status: 'ACTIVE',
  sellable: true,
  supplier: null,
  receivedAt: new Date().toISOString(),
  ...extra,
});

const movement = (extra: Record<string, unknown> = {}) => ({
  id: 'm1',
  createdAt: new Date().toISOString(),
  type: 'DAMAGED',
  reason: 'DAMAGED',
  quantityBefore: 10,
  quantityChange: -3,
  quantityAfter: 7,
  notes: null,
  referenceType: null,
  referenceId: null,
  product: { id: 'p1', sku: 'MED-000001', commercialName: 'Paracetamol 500 mg', concentration: '500 mg' },
  batch: { id: 'b1', lotNumber: 'PCT2504A', expiresAt: '2030-01-31' },
  user: { id: 'u', fullName: 'Doctor Propietario' },
  ...extra,
});

afterEach(() => {
  vi.unstubAllGlobals();
  setSession(null);
});

function postBody(fetchMock: ReturnType<typeof mockApi>) {
  const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
  return call ? JSON.parse(call[1]!.body as string) : undefined;
}

describe('AdjustDialog', () => {
  it('una salida exige motivo y no permite retirar más de lo que hay', async () => {
    const fetchMock = mockApi({ 'POST /inventory/adjustments': { movement: movement() } });
    renderApp(<AdjustDialog batch={batch()} onClose={() => {}} />, { user: sessionUser('OWNER') });

    await userEvent.type(screen.getByLabelText('Cantidad'), '12');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar ajuste' }));
    expect(screen.getByText('Sólo hay 10 unidad(es) en este lote')).toBeInTheDocument();
    expect(screen.getByText('Selecciona el motivo')).toBeInTheDocument();
    expect(postBody(fetchMock)).toBeUndefined();

    await userEvent.clear(screen.getByLabelText('Cantidad'));
    await userEvent.type(screen.getByLabelText('Cantidad'), '3');
    await userEvent.selectOptions(screen.getByLabelText('Motivo'), 'DAMAGED');
    // Vista previa: 10 → 7
    expect(screen.getByText('7')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Registrar ajuste' }));
    await waitFor(() => expect(postBody(fetchMock)).toEqual({ batchId: 'b1', direction: 'OUT', quantity: 3, reason: 'DAMAGED', notes: null }));
  });

  it('conteo físico calcula la diferencia y la registra como corrección de inventario', async () => {
    const fetchMock = mockApi({ 'POST /inventory/adjustments': { movement: movement({ quantityChange: 2, quantityAfter: 12 }) } });
    renderApp(<AdjustDialog batch={batch()} onClose={() => {}} />, { user: sessionUser('OWNER') });

    await userEvent.click(screen.getByRole('radio', { name: /Conteo físico/ }));
    await userEvent.type(screen.getByLabelText('Unidades contadas'), '12');
    expect(screen.getByText('+2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Registrar ajuste' }));
    await waitFor(() =>
      expect(postBody(fetchMock)).toEqual({
        batchId: 'b1',
        direction: 'IN',
        quantity: 2,
        reason: 'INVENTORY_CORRECTION',
        notes: 'Conteo físico: 12 unidad(es)',
      }),
    );
  });

  it('si el conteo coincide no hay nada que ajustar; "Otro" exige observaciones', async () => {
    mockApi({});
    renderApp(<AdjustDialog batch={batch()} onClose={() => {}} />, { user: sessionUser('OWNER') });
    await userEvent.click(screen.getByRole('radio', { name: /Conteo físico/ }));
    await userEvent.type(screen.getByLabelText('Unidades contadas'), '10');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar ajuste' }));
    expect(screen.getByText(/no hay nada que ajustar/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: /Salida/ }));
    await userEvent.type(screen.getByLabelText('Cantidad'), '1');
    await userEvent.selectOptions(screen.getByLabelText('Motivo'), 'OTHER');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar ajuste' }));
    expect(screen.getByText('Describe el motivo')).toBeInTheDocument();
  });

  it('una entrada no ofrece motivos de salida', async () => {
    mockApi({});
    renderApp(<AdjustDialog batch={batch()} onClose={() => {}} />, { user: sessionUser('OWNER') });
    await userEvent.click(screen.getByRole('radio', { name: /Entrada/ }));
    const options = within(screen.getByLabelText('Motivo')).getAllByRole('option').map((o) => o.textContent);
    expect(options).not.toContain('Producto dañado');
    expect(options).toContain('Corrección de inventario (conteo físico)');
  });
});

describe('EntryDialog', () => {
  it('valida y envía la carga inicial con el costo', async () => {
    const fetchMock = mockApi({ 'POST /inventory/entries': { batch: batch({ lotNumber: 'NUEVO1', quantity: 24 }), createdBatch: true } });
    renderApp(
      <EntryDialog open product={{ id: 'p1', commercialName: 'Paracetamol 500 mg', concentration: '500 mg', purchasePrice: 18 }} showCosts onClose={() => {}} />,
      { user: sessionUser('OWNER') },
    );
    expect(screen.getByLabelText('Costo unitario')).toHaveValue('18.00');

    await userEvent.click(screen.getByRole('button', { name: 'Registrar entrada' }));
    expect(screen.getByText('El número de lote es obligatorio')).toBeInTheDocument();
    expect(screen.getByText('La fecha de caducidad es obligatoria')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Número de lote'), 'nuevo1');
    await userEvent.type(screen.getByLabelText('Cantidad (unidades)'), '24');
    await userEvent.type(screen.getByLabelText('Fecha de caducidad'), '2030-05-31');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar entrada' }));
    await waitFor(() =>
      expect(postBody(fetchMock)).toEqual({
        productId: 'p1',
        lotNumber: 'nuevo1',
        expiresAt: '2030-05-31',
        manufacturedAt: null,
        quantity: 24,
        unitCost: 18,
        type: 'INITIAL_STOCK',
        reason: null,
        notes: null,
      }),
    );
    expect(await screen.findByText('Lote NUEVO1 registrado con 24 unidad(es)')).toBeInTheDocument();
  });

  it('sin permiso para ver costos no pide ni envía el costo', async () => {
    const fetchMock = mockApi({ 'POST /inventory/entries': { batch: batch(), createdBatch: true } });
    renderApp(<EntryDialog open product={{ id: 'p1', commercialName: 'Paracetamol 500 mg', concentration: null }} showCosts={false} onClose={() => {}} />, {
      user: sessionUser('WAREHOUSE'),
    });
    expect(screen.queryByLabelText('Costo unitario')).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Número de lote'), 'A1');
    await userEvent.type(screen.getByLabelText('Cantidad (unidades)'), '5');
    await userEvent.type(screen.getByLabelText('Fecha de caducidad'), '2030-05-31');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar entrada' }));
    await waitFor(() => expect(postBody(fetchMock)).not.toHaveProperty('unitCost'));
  });
});

const stockRow = (extra: Partial<StockRow> = {}): StockRow => ({
  productId: 'p1',
  sku: 'MED-000001',
  barcode: null,
  commercialName: 'Paracetamol 500 mg',
  concentration: '500 mg',
  pharmaceuticalForm: 'Tableta',
  presentation: 'BOX',
  contentQuantity: '20 tabletas',
  category: 'Analgésicos',
  productStatus: 'ACTIVE',
  imageUrl: null,
  available: 75,
  expired: 6,
  quarantine: 0,
  batches: 2,
  nextExpiry: '2030-01-31',
  daysToExpiry: 20,
  expiryStatus: 'CRITICAL',
  minStock: 20,
  maxStock: 120,
  location: 'Anaquel A-1',
  stockStatus: 'OK',
  ...extra,
});

describe('StockPage', () => {
  it('muestra resumen, caducidad crítica y unidades caducadas; filtra al tocar "Agotados"', async () => {
    const fetchMock = mockApi({
      'GET /inventory/stock': {
        data: [stockRow({ value: 1350 })],
        meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
        summary: { activeProducts: 30, withStock: 16, outOfStock: 14, lowStock: 3, expiredUnits: 6, inventoryValue: 11741 },
      },
      'GET /categories': { items: [] },
    });
    renderApp(<StockPage />, { user: sessionUser('OWNER') });

    expect(await screen.findByText('16 / 30')).toBeInTheDocument();
    expect(screen.getByText('$11,741.00')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('+6 caducadas')).toBeInTheDocument();
    expect(within(table).getByText('20 días · Crítico')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Agotados/ }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('stockStatus=OUT'))).toBe(true),
    );
  });

  it('sin acceso a costos no muestra el valor del inventario', async () => {
    mockApi({
      'GET /inventory/stock': {
        data: [stockRow()],
        meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
        summary: { activeProducts: 30, withStock: 16, outOfStock: 14, lowStock: 3, expiredUnits: 6 },
      },
      'GET /categories': { items: [] },
    });
    renderApp(<StockPage />, { user: sessionUser('CASHIER') });
    await screen.findByText('16 / 30');
    expect(screen.queryByText('Valor del inventario')).not.toBeInTheDocument();
    // El cajero no ajusta inventario
    expect(screen.queryByRole('button', { name: 'Registrar entrada' })).not.toBeInTheDocument();
  });
});

describe('ProductInventoryPage', () => {
  it('marca como "se vende primero" el primer lote vendible, no el caducado', async () => {
    mockApi({
      'GET /products/p1': {
        product: {
          id: 'p1', sku: 'MED-000001', barcode: null, commercialName: 'Amoxicilina 500 mg', genericName: null, activeIngredient: null,
          category: { id: 'c', name: 'Antibióticos' }, presentation: 'BOX', concentration: '500 mg', pharmaceuticalForm: 'Cápsula',
          contentQuantity: '12 cápsulas', laboratory: null, manufacturer: null, salePrice: 89, taxRate: 0, purchasePrice: 45,
          requiresPrescription: true, isControlled: true, status: 'ACTIVE', imageUrl: null, description: null, indications: null,
          observations: null, stock: 20, stockStatus: 'OK', inventory: { minStock: 10, maxStock: 50, location: 'R-1' },
          createdAt: '', updatedAt: '',
        },
      },
      'GET /inventory/products/p1': {
        batches: [
          batch({ id: 'old', lotNumber: 'AMX2412', quantity: 6, daysLeft: -10, expiryStatus: 'EXPIRED', sellable: false, expiresAt: '2026-09-28' }),
          batch({ id: 'new', lotNumber: 'AMX2510', quantity: 20 }),
        ],
        movements: [],
      },
    });
    renderApp(<ProductInventoryPage />, {
      user: sessionUser('OWNER'),
      path: '/inventario/existencias/p1',
      routes: [{ path: '/inventario/existencias/:productId', element: <ProductInventoryPage /> }],
    });
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(within(rows[0]!).getByText('Caducado: dar de baja')).toBeInTheDocument();
    expect(within(rows[0]!).queryByText('Se vende primero')).not.toBeInTheDocument();
    expect(within(rows[1]!).getByText('Se vende primero')).toBeInTheDocument();
    expect(within(rows[1]!).getByRole('button', { name: /Ajustar/ })).toBeInTheDocument();
  });
});
