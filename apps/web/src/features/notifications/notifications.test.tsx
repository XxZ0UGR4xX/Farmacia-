import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Batch } from '../../api/inventory';
import type { AppNotification } from '../../api/notifications';
import { setSession } from '../../api/client';
import { mockApi, renderApp, sessionUser } from '../../test/render';
import { ExpirationsPage } from '../inventory/ExpirationsPage';
import { NotificationBell } from './NotificationBell';
import { NotificationsPage } from './NotificationsPage';

afterEach(() => {
  vi.unstubAllGlobals();
  setSession(null);
});

const notification = (extra: Partial<AppNotification> = {}): AppNotification => ({
  id: 'n1',
  type: 'EXPIRED',
  severity: 'CRITICAL',
  title: 'Lote caducado: Amoxicilina 500 mg',
  message: 'El lote AMX2412 caducó y tiene 6 unidad(es).',
  link: '/inventario/existencias/p9',
  read: false,
  createdAt: new Date().toISOString(),
  ...extra,
});

const summary = { unread: 2, total: 3, critical: 1 };

describe('NotificationBell', () => {
  it('muestra el contador y al abrir una alerta la marca como leída y lleva a su pantalla', async () => {
    const fetchMock = mockApi({
      'GET /notifications/summary': summary,
      'GET /notifications': { data: [notification(), notification({ id: 'n2', type: 'LOW_STOCK', severity: 'WARNING', title: 'Stock bajo: Metamizol', link: '/inventario/existencias/p3', read: true })], summary },
      'POST /notifications/n1/read': new Response(null, { status: 204 }),
    });
    const { router } = renderApp(<NotificationBell />, {
      user: sessionUser('OWNER'),
      routes: [
        { path: '/', element: <NotificationBell /> },
        { path: '/inventario/existencias/:id', element: <p>Ficha</p> },
      ],
    });
    expect(await screen.findByTestId('notification-count')).toHaveTextContent('2');
    await userEvent.click(screen.getByRole('button', { name: /Notificaciones: 2 sin leer/ }));
    const panel = screen.getByRole('dialog', { name: 'Notificaciones' });
    await userEvent.click(await within(panel).findByText('Lote caducado: Amoxicilina 500 mg'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/inventario/existencias/p9'));
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/notifications/n1/read') && init?.method === 'POST')).toBe(true);
  });
});

describe('NotificationsPage', () => {
  it('sólo ofrece filtros de las alertas que el usuario puede ver y marca todo como leído', async () => {
    const fetchMock = mockApi({
      'GET /notifications': { data: [notification({ type: 'OUT_OF_STOCK', title: 'Paracetamol agotado' })], summary },
      'POST /notifications/read-all': { marked: 2 },
    });
    renderApp(<NotificationsPage />, { user: sessionUser('CASHIER') });
    expect(await screen.findByText('Paracetamol agotado')).toBeInTheDocument();
    const filters = screen.getByRole('group', { name: 'Filtrar por tipo' });
    expect(within(filters).getAllByRole('button').map((b) => b.textContent)).toEqual(['Todas', 'Agotado', 'Stock bajo']);
    await userEvent.click(screen.getByRole('button', { name: 'Marcar todo como leído' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/notifications/read-all') && init?.method === 'POST')).toBe(true));
  });
});

describe('ExpirationsPage', () => {
  const expiredBatch: Batch = {
    id: 'b9',
    product: { id: 'p9', sku: 'MED-000009', commercialName: 'Amoxicilina 500 mg', concentration: '500 mg', presentation: 'BOX', contentQuantity: '12 cápsulas' },
    lotNumber: 'AMX2412',
    quantity: 6,
    initialQuantity: 6,
    expiresAt: '2026-09-28',
    manufacturedAt: null,
    daysLeft: -10,
    expiryStatus: 'EXPIRED',
    status: 'ACTIVE',
    sellable: false,
    supplier: null,
    receivedAt: new Date().toISOString(),
  };
  const response = {
    summary: { EXPIRED: { batches: 1, products: 1, units: 6, value: 120 }, CRITICAL: { batches: 2, products: 2, units: 18 }, WARNING: { batches: 4, products: 3, units: 60 } },
    thresholds: { criticalDays: 30, warningDays: 90 },
    data: [expiredBatch],
  };

  it('resume por clasificación y da de baja el lote caducado completo con motivo caducidad', async () => {
    const fetchMock = mockApi({
      'GET /inventory/expirations': response,
      'POST /inventory/adjustments': { movement: { id: 'm1' } },
    });
    renderApp(<ExpirationsPage />, { user: sessionUser('PHARMACIST') });
    await waitFor(() => expect(screen.getByTestId('expiry-EXPIRED')).toHaveTextContent('1 lote(s)'));
    expect(screen.getByTestId('expiry-CRITICAL')).toHaveTextContent('2');
    await userEvent.click(screen.getByRole('button', { name: 'Dar de baja' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Cantidad')).toHaveValue('6');
    expect(within(dialog).getByLabelText('Motivo')).toHaveValue('EXPIRED');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Registrar ajuste' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(call && JSON.parse(call[1]!.body as string)).toMatchObject({ batchId: 'b9', direction: 'OUT', quantity: 6, reason: 'EXPIRED' });
    });
  });

  it('quien no ajusta inventario consulta pero no da de baja', async () => {
    mockApi({ 'GET /inventory/expirations': response });
    renderApp(<ExpirationsPage />, { user: sessionUser('DOCTOR') });
    expect(await screen.findByText('Amoxicilina 500 mg')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dar de baja' })).not.toBeInTheDocument();
  });
});
