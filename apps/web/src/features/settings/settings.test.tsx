import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuditEntry } from '../../api/audit';
import { setSession } from '../../api/client';
import type { SettingsMap } from '../../api/settings';
import { mockApi, renderApp, sessionUser } from '../../test/render';
import { AuditPage } from '../audit/AuditPage';
import { SettingsPage } from './SettingsPage';

afterEach(() => {
  vi.unstubAllGlobals();
  setSession(null);
});

const settings: SettingsMap = {
  'pharmacy.profile': { value: { name: 'Mi Farmacia', phone: null, email: null, address: null }, updatedAt: null, updatedBy: null },
  'pharmacy.fiscal': { value: { rfc: null, legalName: null, taxRegime: null, fiscalAddress: null, zipCode: null }, updatedAt: null, updatedBy: null },
  'pharmacy.taxes': { value: { defaultRate: 0, pricesIncludeTax: true }, updatedAt: null, updatedBy: null },
  'inventory.defaults': { value: { defaultMarginPercent: 30, marginBasis: 'COST', defaultMinStock: 5 }, updatedAt: '2026-10-10T15:00:00.000Z', updatedBy: 'Laura Méndez' },
  'alerts.expiry': { value: { criticalDays: 30, warningDays: 90 }, updatedAt: null, updatedBy: null },
};
const branches = { branches: [{ id: 'b1', code: 'MATRIZ', name: 'Matriz', address: 'Av. Ficticia 1', phone: null, email: null, isActive: true, users: 6 }] };

describe('SettingsPage', () => {
  it('el propietario cambia los datos de la farmacia y el margen sobre el precio', async () => {
    const fetchMock = mockApi({
      'GET /settings': { settings },
      'GET /settings/branches': branches,
      'PUT /settings/pharmacy.profile': { settings },
      'PUT /settings/inventory.defaults': { settings },
    });
    renderApp(<SettingsPage />, { user: sessionUser('OWNER') });

    const name = await screen.findByLabelText('Nombre comercial');
    expect(screen.getByText(/Última modificación: .* por Laura Méndez/)).toBeInTheDocument();
    expect(await screen.findByText(/Av\. Ficticia 1 · 6 usuarios/)).toBeInTheDocument();
    await userEvent.clear(name);
    await userEvent.type(name, 'Farmacia San Rafael');
    const profile = name.closest('form')!;
    await userEvent.click(within(profile).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/settings/pharmacy.profile') && init?.method === 'PUT');
      expect(call && JSON.parse(call[1]!.body as string)).toEqual({ name: 'Farmacia San Rafael', phone: null, email: null, address: null });
    });

    // Decisión del propietario: margen sobre el precio de venta
    const pricing = screen.getByLabelText('Margen predeterminado (%)').closest('form')!;
    expect(within(pricing).getByText('$130.00')).toBeInTheDocument();
    await userEvent.click(within(pricing).getByRole('radio', { name: /Sobre el precio de venta/ }));
    // $100 ÷ (1 − 30 %) = $142.86 → $143.00
    expect(within(pricing).getByText('$143.00')).toBeInTheDocument();
    const pct = within(pricing).getByLabelText('Margen predeterminado (%)');
    await userEvent.clear(pct);
    await userEvent.type(pct, '95');
    await userEvent.click(within(pricing).getByRole('button', { name: 'Guardar' }));
    expect(within(pricing).getByText('Escribe un porcentaje entre 0 y 90')).toBeInTheDocument();
    await userEvent.clear(pct);
    await userEvent.type(pct, '25');
    await userEvent.click(within(pricing).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/settings/inventory.defaults') && init?.method === 'PUT');
      expect(call && JSON.parse(call[1]!.body as string)).toEqual({ marginBasis: 'PRICE', defaultMarginPercent: 25, defaultMinStock: 5 });
    });
  });

  it('quien sólo consulta no puede editar', async () => {
    mockApi({ 'GET /settings': { settings }, 'GET /settings/branches': branches });
    renderApp(<SettingsPage />, { user: sessionUser('PHARMACIST', { permissions: ['settings.view'] }) });
    expect(await screen.findByLabelText('Nombre comercial')).toBeDisabled();
    expect(screen.getByText(/sólo el propietario o el administrador la modifican/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nueva sucursal' })).not.toBeInTheDocument();
  });
});

const entry = (extra: Partial<AuditEntry>): AuditEntry => ({
  id: 'a1',
  createdAt: '2026-10-12T18:00:00.000Z',
  action: 'SETTINGS_UPDATE',
  group: 'admin',
  user: { id: 'u1', fullName: 'Laura Méndez', email: 'admin@farmacia.local' },
  branch: null,
  entityType: 'setting',
  entityId: 'inventory.defaults',
  ipAddress: '10.0.0.5',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
  metadata: { key: 'inventory.defaults', changes: [{ field: 'marginBasis', before: 'COST', after: 'PRICE' }] },
  ...extra,
});

describe('AuditPage', () => {
  it('lista, muestra el detalle con antes y después, filtra eventos de seguridad y exporta', async () => {
    const fetchMock = mockApi({
      'GET /audit/users': { users: [{ id: 'u1', fullName: 'Laura Méndez', email: 'admin@farmacia.local' }] },
      'GET /audit': {
        data: [entry({}), entry({ id: 'a2', action: 'ACCESS_DENIED', group: 'security', metadata: { method: 'GET', path: '/api/v1/audit', missing: ['audit.view'] } })],
        meta: { page: 1, pageSize: 50, total: 2, totalPages: 1 },
        summary: { total: 2, security: 1 },
      },
      'GET /audit/export': () => new Response('csv', { status: 200 }),
    });
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }));
    renderApp(<AuditPage />, { user: sessionUser('OWNER') });

    // (la etiqueta de la acción también existe en el filtro: se espera al contenido de la tabla)
    expect((await screen.findAllByText('GET /api/v1/audit · falta audit.view')).length).toBeGreaterThan(0);

    await userEvent.click(screen.getAllByRole('button', { name: 'Cambio de configuración' })[0]!);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Chrome en Windows', { exact: false })).toBeInTheDocument();
    // Nombres y valores legibles, no los códigos internos
    const row = within(dialog).getByRole('row', { name: /Cálculo del margen/ });
    expect(row).toHaveTextContent('Sobre el costo');
    expect(row).toHaveTextContent('Sobre el precio de venta');
    await userEvent.click(within(dialog).getByRole('button', { name: /cerrar/i }));

    await userEvent.click(screen.getByRole('button', { name: /1 de seguridad/ }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => /\/audit\?.*security=true/.test(String(url)))).toBe(true));

    await userEvent.click(screen.getByRole('button', { name: 'Exportar CSV' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => /\/audit\/export\?security=true/.test(String(url)))).toBe(true));
  });
});
