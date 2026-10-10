import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '../../api/catalog';
import { setSession } from '../../api/client';
import type { Purchase, Supplier } from '../../api/purchases';
import { todayInputValue } from '../../lib/format';
import { mockApi, renderApp, sessionUser } from '../../test/render';
import { PurchaseDetailPage } from './PurchaseDetailPage';
import { PurchaseFormPage } from './PurchaseFormPage';
import { SuppliersPage } from './SuppliersPage';

afterEach(() => {
  vi.unstubAllGlobals();
  setSession(null);
});

const product = {
  id: 'p1',
  sku: 'MED-000001',
  barcode: '2000000000017',
  commercialName: 'Paracetamol 500 mg',
  concentration: '500 mg',
  presentation: 'BOX',
  salePrice: 35,
  taxRate: 0,
  purchasePrice: 12,
  status: 'ACTIVE',
  category: { id: 'c1', name: 'Analgésicos' },
} as unknown as Product;

const supplier = (extra: Partial<Supplier> = {}): Supplier => ({
  id: 's1',
  tradeName: 'Distribuidora del Valle',
  legalName: null,
  rfc: null,
  phone: null,
  email: null,
  address: null,
  contactName: null,
  paymentTerms: null,
  creditDays: 30,
  isActive: true,
  notes: null,
  stats: { purchaseCount: 2, totalPurchased: 1000, balanceDue: 250, lastPurchaseDate: '2026-09-01' },
  ...extra,
});

const purchase = (extra: Partial<Purchase> = {}): Purchase => ({
  id: 'pu1',
  number: 7,
  folio: 'C-000007',
  status: 'RECEIVED',
  supplier: { id: 's1', tradeName: 'Distribuidora del Valle', rfc: null, creditDays: 30 },
  invoiceNumber: 'F-100',
  purchaseDate: '2026-09-01',
  paymentMethod: 'CREDIT',
  paymentStatus: 'PENDING',
  paymentDueDate: '2026-10-01',
  overdue: false,
  subtotal: 300,
  discountTotal: 0,
  taxTotal: 0,
  total: 300,
  amountPaid: 0,
  balance: 300,
  notes: null,
  items: [
    {
      id: 'i1',
      product: { id: 'p1', sku: 'MED-000001', commercialName: 'Paracetamol 500 mg', concentration: '500 mg', presentation: 'BOX' },
      batchId: 'b1',
      lotNumber: 'L-1',
      expiresAt: '2028-01-31',
      manufacturedAt: null,
      quantity: 25,
      unitCost: 12,
      discount: 0,
      taxRate: 0,
      taxAmount: 0,
      subtotal: 300,
      total: 300,
    },
  ],
  payments: [],
  createdBy: { id: 'u', fullName: 'Jorge Salinas' },
  receivedBy: { id: 'u', fullName: 'Jorge Salinas' },
  receivedAt: new Date().toISOString(),
  cancelledAt: null,
  createdAt: new Date().toISOString(),
  ...extra,
});

function lastBody(fetchMock: ReturnType<typeof mockApi>, method: string) {
  const calls = fetchMock.mock.calls.filter(([, init]) => init?.method === method);
  const call = calls.at(-1);
  return call ? JSON.parse(call[1]!.body as string) : undefined;
}

const formRoutes = (element: React.ReactElement) => [
  { path: '/compras/nueva', element },
  { path: '/compras/historial/:id', element: <p>Detalle de la compra</p> },
];

describe('PurchaseFormPage', () => {
  it('captura la factura, calcula el total y la recibe con sus lotes', async () => {
    const fetchMock = mockApi({
      'GET /suppliers/options': { items: [{ id: 's1', tradeName: 'Distribuidora del Valle', creditDays: 30 }] },
      'GET /products': { data: [product], meta: { page: 1, pageSize: 8, total: 1, totalPages: 1 } },
      'POST /purchases': { purchase: purchase() },
    });
    const { router } = renderApp(<PurchaseFormPage />, { user: sessionUser('OWNER'), path: '/compras/nueva', routes: formRoutes(<PurchaseFormPage />) });

    await screen.findByRole('option', { name: 'Distribuidora del Valle' });
    await userEvent.selectOptions(screen.getByLabelText('Proveedor'), 's1');
    // Proveedor con crédito: la forma de pago cambia sola a crédito
    expect(screen.getByLabelText('Forma de pago')).toHaveValue('CREDIT');

    await userEvent.type(screen.getByLabelText('Agregar producto'), 'para');
    await userEvent.click(await screen.findByRole('button', { name: /Paracetamol 500 mg/ }));
    const line = screen.getByTestId('purchase-line');
    // El cursor pasa al lote del renglón nuevo
    await waitFor(() => expect(within(line).getByLabelText('Lote')).toHaveFocus());

    // Sin lote no se puede recibir
    await userEvent.click(screen.getByRole('button', { name: 'Guardar y recibir mercancía' }));
    expect(within(line).getByText('Captura el lote')).toBeInTheDocument();
    expect(lastBody(fetchMock, 'POST')).toBeUndefined();

    await userEvent.type(within(line).getByLabelText('Lote'), 'l-1');
    await userEvent.type(within(line).getByLabelText('Caducidad'), '2028-01-31');
    await userEvent.clear(within(line).getByLabelText('Cantidad'));
    await userEvent.type(within(line).getByLabelText('Cantidad'), '25');
    await userEvent.type(within(line).getByLabelText('Descuento'), '10');
    expect(screen.getByTestId('purchase-total')).toHaveTextContent('290.00');

    await userEvent.click(screen.getByRole('button', { name: 'Guardar y recibir mercancía' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/compras/historial/pu1'));
    expect(lastBody(fetchMock, 'POST')).toMatchObject({
      supplierId: 's1',
      purchaseDate: todayInputValue(),
      paymentMethod: 'CREDIT',
      receive: true,
      items: [{ productId: 'p1', lotNumber: 'l-1', expiresAt: '2028-01-31', quantity: 25, unitCost: 12, discount: 10, taxRate: 0 }],
    });
  });

  it('un pedido se guarda sin lotes y muestra los errores del servidor en su renglón', async () => {
    const fetchMock = mockApi({
      'GET /suppliers/options': { items: [{ id: 's1', tradeName: 'Distribuidora del Valle', creditDays: 0 }] },
      'GET /products': { data: [product], meta: { page: 1, pageSize: 8, total: 1, totalPages: 1 } },
      'POST /purchases': () =>
        new Response(
          JSON.stringify({ error: { code: 'CONFLICT', message: 'Esta factura ya está registrada en la compra C-000003', details: [{ path: 'invoiceNumber', message: 'Factura ya registrada para este proveedor' }] } }),
          { status: 409 },
        ),
    });
    renderApp(<PurchaseFormPage />, { user: sessionUser('WAREHOUSE'), path: '/compras/nueva', routes: formRoutes(<PurchaseFormPage />) });

    await screen.findByRole('option', { name: 'Distribuidora del Valle' });
    await userEvent.selectOptions(screen.getByLabelText('Proveedor'), 's1');
    expect(screen.getByLabelText('Forma de pago')).toHaveValue('CASH');
    await userEvent.type(screen.getByLabelText('Folio de factura (opcional)'), 'F-1');
    await userEvent.type(screen.getByLabelText('Agregar producto'), 'para');
    await userEvent.click(await screen.findByRole('button', { name: /Paracetamol 500 mg/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar como pendiente' }));

    expect(await screen.findByText('Factura ya registrada para este proveedor')).toBeInTheDocument();
    expect(lastBody(fetchMock, 'POST')).toMatchObject({ receive: false, items: [{ lotNumber: null, expiresAt: null }] });
  });
});

describe('PurchaseDetailPage', () => {
  const routes = [{ path: '/compras/historial/:id', element: <PurchaseDetailPage /> }];

  it('un pedido sin lotes no se puede recibir hasta capturarlos', async () => {
    mockApi({
      'GET /purchases/pu1': {
        purchase: purchase({ status: 'ORDERED', receivedAt: null, receivedBy: null, items: [{ ...purchase().items[0]!, lotNumber: null, expiresAt: null, batchId: null }] }),
      },
    });
    renderApp(<PurchaseDetailPage />, { user: sessionUser('OWNER'), path: '/compras/historial/pu1', routes });
    expect(await screen.findByRole('button', { name: 'Recibir mercancía' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Capturar lotes' })).toHaveAttribute('href', '/compras/historial/pu1/editar');
    expect(screen.getByText('Por capturar')).toBeInTheDocument();
  });

  it('registra un pago con el saldo propuesto y no permite exceder el saldo', async () => {
    const fetchMock = mockApi({
      'GET /purchases/pu1': { purchase: purchase() },
      'POST /purchases/pu1/payments': { purchase: purchase({ amountPaid: 100, balance: 200, paymentStatus: 'PARTIAL' }) },
    });
    renderApp(<PurchaseDetailPage />, { user: sessionUser('OWNER'), path: '/compras/historial/pu1', routes });
    await userEvent.click(await screen.findByRole('button', { name: 'Registrar pago' }));
    const dialog = screen.getByRole('dialog');
    const amount = within(dialog).getByLabelText('Importe');
    expect(amount).toHaveValue('300.00');
    await userEvent.clear(amount);
    await userEvent.type(amount, '350');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Registrar pago' }));
    expect(within(dialog).getByText(/El saldo es/)).toBeInTheDocument();

    await userEvent.clear(amount);
    await userEvent.type(amount, '100');
    await userEvent.type(within(dialog).getByLabelText('Referencia (opcional)'), 'SPEI 9');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Registrar pago' }));
    await waitFor(() => expect(lastBody(fetchMock, 'POST')).toMatchObject({ amount: 100, method: 'TRANSFER', reference: 'SPEI 9' }));
  });

  it('el almacenista no ve pagos ni cancelación', async () => {
    mockApi({ 'GET /purchases/pu1': { purchase: purchase() } });
    renderApp(<PurchaseDetailPage />, { user: sessionUser('WAREHOUSE'), path: '/compras/historial/pu1', routes });
    expect(await screen.findByText('C-000007')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Registrar pago' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
  });
});

describe('SuppliersPage', () => {
  it('valida el RFC antes de enviar y el farmacéutico sólo consulta', async () => {
    const fetchMock = mockApi({
      'GET /suppliers': { data: [supplier()], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } },
      'POST /suppliers': { supplier: supplier({ id: 's2', tradeName: 'Nuevo' }) },
    });
    const { unmount } = renderApp(<SuppliersPage />, { user: sessionUser('OWNER') });
    expect((await screen.findAllByText('Distribuidora del Valle')).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 'Nuevo proveedor' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Nombre comercial'), 'Nuevo');
    await userEvent.type(within(dialog).getByLabelText('RFC (opcional)'), '123');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Registrar proveedor' }));
    expect(within(dialog).getByText(/RFC inválido/)).toBeInTheDocument();
    expect(lastBody(fetchMock, 'POST')).toBeUndefined();
    unmount();
    setSession(null);

    renderApp(<SuppliersPage />, { user: sessionUser('PHARMACIST') });
    expect((await screen.findAllByText('Distribuidora del Valle')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Nuevo proveedor' })).not.toBeInTheDocument();
  });
});
