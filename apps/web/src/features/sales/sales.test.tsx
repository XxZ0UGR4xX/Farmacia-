import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '../../api/catalog';
import { setSession } from '../../api/client';
import type { ReturnRow, Sale } from '../../api/sales';
import { mockApi, renderApp, sessionUser } from '../../test/render';
import { PosPage } from './PosPage';
import { ReturnsPage } from './ReturnsPage';
import { SaleDetailPage } from './SaleDetailPage';

beforeEach(() => sessionStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  setSession(null);
});

const product = (extra: Partial<Product> = {}) =>
  ({
    id: 'p1',
    sku: 'MED-000001',
    barcode: '2000000010010',
    commercialName: 'Paracetamol 500 mg',
    concentration: '500 mg',
    presentation: 'BOX',
    salePrice: 35,
    taxRate: 0,
    status: 'ACTIVE',
    stock: 10,
    requiresPrescription: false,
    isControlled: false,
    category: { id: 'c1', name: 'Analgésicos' },
    ...extra,
  }) as unknown as Product;

const sale = (extra: Partial<Sale> = {}): Sale => ({
  id: 's1',
  number: 12,
  folio: 'V-000012',
  status: 'COMPLETED',
  branch: { id: 'b1', name: 'Matriz', address: null, phone: null },
  subtotal: 70,
  discountTotal: 0,
  taxTotal: 0,
  total: 70,
  refunded: 0,
  prescriptionChecked: false,
  notes: null,
  items: [
    {
      id: 'si1',
      product: { id: 'p1', sku: 'MED-000001', barcode: null, commercialName: 'Paracetamol 500 mg', concentration: '500 mg', presentation: 'BOX', requiresPrescription: false, isControlled: false },
      quantity: 2,
      returnedQty: 0,
      unitPrice: 35,
      discount: 0,
      taxRate: 0,
      taxAmount: 0,
      subtotal: 70,
      total: 70,
      batches: [{ batchId: 'b1', lotNumber: 'L-1', expiresAt: '2028-01-31', quantity: 2 }],
    },
  ],
  payments: [{ id: 'pay1', method: 'CASH', amount: 70, received: 100, change: 30, reference: null }],
  returns: [],
  createdBy: { id: 'u', fullName: 'Sofía Ramírez' },
  cancelledBy: null,
  cancelledAt: null,
  cancelReason: null,
  createdAt: new Date().toISOString(),
  ...extra,
});

const defaults = { taxes: { defaultRate: 0, pricesIncludeTax: true }, inventory: { defaultMarginPercent: 30, defaultMinStock: 5 }, currency: { code: 'MXN', symbol: '$', locale: 'es-MX' } };

function lastPost(fetchMock: ReturnType<typeof mockApi>) {
  const call = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').at(-1);
  return call ? JSON.parse(call[1]!.body as string) : undefined;
}

describe('PosPage', () => {
  it('escanear, cobrar en efectivo y mostrar el cambio', async () => {
    const fetchMock = mockApi({
      'GET /settings/defaults': defaults,
      'GET /products/barcode/2000000010010': { product: product() },
      'POST /sales': { sale: sale() },
    });
    renderApp(<PosPage />, { user: sessionUser('CASHIER') });
    const search = screen.getByLabelText('Producto');
    // Lector USB: código + Enter, dos veces → 2 piezas
    await userEvent.type(search, '2000000010010{Enter}');
    await screen.findByTestId('cart-line');
    await userEvent.type(search, '2000000010010{Enter}');
    await waitFor(() => expect(screen.getByLabelText('Cantidad de Paracetamol 500 mg')).toHaveValue('2'));
    expect(screen.getByTestId('pos-total')).toHaveTextContent('70.00');
    // El cajero no aplica descuentos
    expect(screen.queryByLabelText('Descuento')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '$100.00' }));
    expect(screen.getByTestId('pos-change')).toHaveTextContent('30.00');
    await userEvent.click(screen.getByRole('button', { name: /^Cobrar/ }));

    expect(await screen.findByTestId('sale-change')).toHaveTextContent('30.00');
    const body = lastPost(fetchMock);
    expect(body).toMatchObject({
      items: [{ productId: 'p1', quantity: 2, discount: 0 }],
      payments: [{ method: 'CASH', amount: 70, received: 100 }],
      expectedTotal: 70,
      prescriptionChecked: false,
    });
    expect(body.clientRequestId).toMatch(/^[0-9a-f-]{36}$/);
    // Tras cobrar, la venta queda vacía
    expect(screen.queryByTestId('cart-line')).not.toBeInTheDocument();
  });

  it('no agrega productos sin existencia y exige confirmar la receta', async () => {
    mockApi({
      'GET /settings/defaults': defaults,
      'GET /products/barcode/111111': { product: product({ id: 'p2', commercialName: 'Agotado', stock: 0 }) },
      'GET /products/barcode/222222': { product: product({ id: 'p3', commercialName: 'Amoxicilina 500 mg', requiresPrescription: true, isControlled: true }) },
    });
    renderApp(<PosPage />, { user: sessionUser('CASHIER') });
    const search = screen.getByLabelText('Producto');
    await userEvent.type(search, '111111{Enter}');
    expect(await screen.findByText(/Agotado: sin existencia/)).toBeInTheDocument();
    expect(screen.queryByTestId('cart-line')).not.toBeInTheDocument();

    await userEvent.type(search, '222222{Enter}');
    await screen.findByTestId('cart-line');
    await userEvent.click(screen.getByRole('radio', { name: /Tarjeta/ }));
    const charge = screen.getByRole('button', { name: /^Cobrar/ });
    expect(charge).toBeDisabled();
    await userEvent.click(screen.getByLabelText('Revisé la receta médica del paciente'));
    expect(charge).toBeEnabled();
  });

  it('si los precios cambiaron actualiza el carrito y pide revisar antes de cobrar', async () => {
    let attempts = 0;
    const fetchMock = mockApi({
      'GET /settings/defaults': defaults,
      'GET /products/barcode/2000000010010': { product: product() },
      'GET /products/p1': { product: product({ salePrice: 40 }) },
      'POST /sales': () => {
        attempts++;
        return new Response(JSON.stringify({ error: { code: 'CONFLICT', message: 'Los precios cambiaron', details: { expectedTotal: 35, total: 40 } } }), { status: 409 });
      },
    });
    renderApp(<PosPage />, { user: sessionUser('CASHIER') });
    await userEvent.type(screen.getByLabelText('Producto'), '2000000010010{Enter}');
    await screen.findByTestId('cart-line');
    await userEvent.click(screen.getByRole('radio', { name: /Tarjeta/ }));
    await userEvent.click(screen.getByRole('button', { name: /^Cobrar/ }));
    expect(await screen.findByText(/Ya se actualizó el carrito/)).toBeInTheDocument();
    expect(screen.getByTestId('pos-total')).toHaveTextContent('40.00');
    const firstId = lastPost(fetchMock).clientRequestId;
    await userEvent.click(screen.getByRole('button', { name: /^Cobrar/ }));
    await waitFor(() => expect(attempts).toBe(2));
    expect(lastPost(fetchMock).clientRequestId).not.toBe(firstId);
  });

  it('el farmacéutico puede aplicar descuento y el pago mixto reparte el total', async () => {
    const fetchMock = mockApi({
      'GET /settings/defaults': defaults,
      'GET /products/barcode/2000000010010': { product: product() },
      'POST /sales': { sale: sale() },
    });
    renderApp(<PosPage />, { user: sessionUser('PHARMACIST') });
    await userEvent.type(screen.getByLabelText('Producto'), '2000000010010{Enter}');
    await screen.findByTestId('cart-line');
    await userEvent.type(screen.getByLabelText('Descuento'), '5');
    expect(screen.getByTestId('pos-total')).toHaveTextContent('30.00');
    await userEvent.click(screen.getByRole('radio', { name: /Mixto/ }));
    await userEvent.type(screen.getByLabelText('Con tarjeta'), '20');
    await userEvent.type(screen.getByLabelText('Efectivo recibido'), '20');
    await userEvent.click(screen.getByRole('button', { name: /^Cobrar/ }));
    await waitFor(() =>
      expect(lastPost(fetchMock)).toMatchObject({
        items: [{ discount: 5 }],
        payments: [
          { method: 'CARD', amount: 20 },
          { method: 'CASH', amount: 10, received: 20 },
        ],
      }),
    );
  });
});

describe('SaleDetailPage', () => {
  const routes = [{ path: '/ventas/historial/:id', element: <SaleDetailPage /> }];

  it('registra una devolución en revisión por omisión', async () => {
    const fetchMock = mockApi({
      'GET /sales/s1': { sale: sale() },
      'POST /sales/s1/returns': { sale: sale({ status: 'PARTIALLY_RETURNED', returns: [{ id: 'r1', folio: 'D-000001', reason: 'x', refundTotal: 35, refundMethod: 'CASH', createdAt: '', user: { id: 'u', fullName: 'x' }, items: [] }] }) },
    });
    renderApp(<SaleDetailPage />, { user: sessionUser('PHARMACIST'), path: '/ventas/historial/s1', routes });
    await userEvent.click(await screen.findByRole('button', { name: 'Devolución' }));
    const dialog = screen.getByRole('dialog');
    // El farmacéutico puede regresar directo al inventario
    expect(within(dialog).getByRole('option', { name: 'Regresa al inventario' })).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Devuelve'), '3');
    await userEvent.type(within(dialog).getByLabelText('Motivo'), 'Compró de más');
    await userEvent.click(within(dialog).getByRole('button', { name: /Registrar devolución/ }));
    expect(within(dialog).getByText('De 0 a 2')).toBeInTheDocument();

    await userEvent.clear(within(dialog).getByLabelText('Devuelve'));
    await userEvent.type(within(dialog).getByLabelText('Devuelve'), '1');
    await userEvent.click(within(dialog).getByRole('button', { name: /Registrar devolución/ }));
    await waitFor(() =>
      expect(lastPost(fetchMock)).toEqual({ reason: 'Compró de más', refundMethod: 'CASH', items: [{ saleItemId: 'si1', quantity: 1, disposition: 'QUARANTINE' }] }),
    );
  });

  it('el cajero no cancela ni hace devoluciones', async () => {
    mockApi({ 'GET /sales/s1': { sale: sale() } });
    renderApp(<SaleDetailPage />, { user: sessionUser('CASHIER'), path: '/ventas/historial/s1', routes });
    expect(await screen.findByRole('button', { name: 'Imprimir ticket' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Devolución' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancelar venta' })).not.toBeInTheDocument();
  });
});

describe('ReturnsPage', () => {
  const ret = (expired: boolean): ReturnRow => ({
    id: 'r1',
    folio: 'D-000001',
    sale: { id: 's1', folio: 'V-000012' },
    reason: 'Empaque dañado',
    refundTotal: 35,
    refundMethod: 'CASH',
    notes: null,
    createdAt: new Date().toISOString(),
    user: { id: 'u', fullName: 'Carlos Ortega' },
    items: [
      {
        id: 'ri1',
        product: { id: 'p1', commercialName: 'Paracetamol 500 mg', concentration: '500 mg' },
        lotNumber: 'L-1',
        expiresAt: expired ? '2020-01-01' : '2028-01-31',
        expired,
        quantity: 1,
        refundAmount: 35,
        disposition: 'QUARANTINE',
        pendingReview: true,
        reviewedAt: null,
        reviewedBy: null,
        reviewNotes: null,
      },
    ],
  });

  it('revisa un producto devuelto y no permite regresar un lote caducado', async () => {
    const fetchMock = mockApi({
      'GET /returns': { data: [ret(false)], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 }, summary: { pendingItems: 1, pendingUnits: 1 } },
      'POST /returns/r1/items/ri1/review': new Response(null, { status: 204 }),
    });
    const { unmount } = renderApp(<ReturnsPage />, { user: sessionUser('PHARMACIST') });
    expect(await screen.findByText(/esperando revisión/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Regresar al inventario' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Regresar al inventario' }));
    await waitFor(() => expect(lastPost(fetchMock)).toEqual({ decision: 'RESTOCK', notes: null }));
    unmount();
    setSession(null);

    mockApi({ 'GET /returns': { data: [ret(true)], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 }, summary: { pendingItems: 1, pendingUnits: 1 } } });
    renderApp(<ReturnsPage />, { user: sessionUser('PHARMACIST') });
    expect(await screen.findByRole('button', { name: 'Regresar al inventario' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Desechar' })).toBeEnabled();
  });
});
