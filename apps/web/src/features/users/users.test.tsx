import { ALL_PERMISSIONS, SYSTEM_ROLES, type PermissionKey } from '@farmacia/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminUser, PermissionGroup, Role } from '../../api/admin';
import { setSession } from '../../api/client';
import { mockApi, renderApp, sessionUser } from '../../test/render';
import { PermissionMatrix } from './PermissionMatrix';
import { RoleEditorPage } from './RoleEditorPage';
import { UsersListPage } from './UsersListPage';

const branch = { id: 'b1', code: 'MATRIZ', name: 'Matriz' };

const role = (code: keyof typeof SYSTEM_ROLES): Role => ({
  id: code.toLowerCase(),
  code,
  name: SYSTEM_ROLES[code].name,
  description: SYSTEM_ROLES[code].description,
  isSystem: true,
  isOwner: code === 'OWNER',
  permissions: code === 'OWNER' ? [...ALL_PERMISSIONS] : [...SYSTEM_ROLES[code].permissions],
  userCount: 1,
});
const ROLES = [role('OWNER'), role('ADMIN'), role('CASHIER')];

const adminUser = (code: 'OWNER' | 'ADMIN' | 'CASHIER', id: string, extra: Partial<AdminUser> = {}): AdminUser => ({
  id,
  email: `${id}@test.local`,
  firstName: id,
  lastName: 'Prueba',
  fullName: `${id} Prueba`,
  phone: null,
  professionalLicense: null,
  status: 'ACTIVE',
  isLocked: false,
  lockedUntil: null,
  mustChangePassword: false,
  lastLoginAt: null,
  createdAt: new Date().toISOString(),
  role: { id: code.toLowerCase(), code, name: SYSTEM_ROLES[code].name },
  branches: [branch],
  defaultBranchId: 'b1',
  ...extra,
});

const page = (users: AdminUser[]) => ({
  data: users,
  meta: { page: 1, pageSize: 20, total: users.length, totalPages: 1 },
});

const GROUPS: PermissionGroup[] = [
  {
    module: 'sales',
    label: 'Ventas y devoluciones',
    permissions: [
      { key: 'sales.view', description: 'Ver historial de ventas', sensitive: false },
      { key: 'sales.create', description: 'Realizar ventas (punto de venta)', sensitive: false },
      { key: 'sales.cancel', description: 'Cancelar ventas', sensitive: true },
    ],
  },
  {
    module: 'audit',
    label: 'Auditoría',
    permissions: [{ key: 'audit.view', description: 'Consultar auditoría', sensitive: true }],
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
  setSession(null);
});

describe('UsersListPage', () => {
  it('un administrador no ve acciones sobre el propietario, pero sí sobre un cajero', async () => {
    mockApi({
      'GET /users': page([adminUser('OWNER', 'dueno'), adminUser('CASHIER', 'cajero', { isLocked: true })]),
      'GET /roles': { roles: ROLES },
      'GET /branches': { branches: [branch] },
    });
    renderApp(<UsersListPage />, { user: sessionUser('ADMIN') });

    const table = await screen.findByRole('table');
    expect(within(table).getByText('dueno Prueba')).toBeInTheDocument();
    const cashierActions = await within(table).findByRole('button', { name: 'Acciones para cajero Prueba' });
    expect(within(table).queryByRole('button', { name: 'Acciones para dueno Prueba' })).not.toBeInTheDocument();

    await userEvent.click(cashierActions);
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: /Desbloquear cuenta/ })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /Desactivar/ })).toBeInTheDocument();
  });

  it('el propietario no puede desactivarse ni restablecer su contraseña desde la lista', async () => {
    const me = sessionUser('OWNER');
    mockApi({
      'GET /users': page([adminUser('OWNER', me.id)]),
      'GET /roles': { roles: ROLES },
      'GET /branches': { branches: [branch] },
    });
    renderApp(<UsersListPage />, { user: me });

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Tú')).toBeInTheDocument();
    await userEvent.click(await within(table).findByRole('button', { name: /Acciones para/ }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: /Editar/ })).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: /Desactivar/ })).not.toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: /Restablecer/ })).not.toBeInTheDocument();
  });

  it('crea un usuario, sólo ofrece roles otorgables y muestra la contraseña temporal', async () => {
    const created = adminUser('CASHIER', 'nuevo');
    const fetchMock = mockApi({
      'GET /users': page([]),
      'GET /roles': { roles: ROLES },
      'GET /branches': { branches: [branch] },
      'POST /users': { user: created, temporaryPassword: 'Tmp7kQ2mNx9p' },
    });
    renderApp(<UsersListPage />, { user: sessionUser('ADMIN') });

    await userEvent.click(await screen.findByRole('button', { name: /Nuevo usuario/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo usuario' });

    // Validación antes de enviar
    await userEvent.click(within(dialog).getByRole('button', { name: 'Crear usuario' }));
    expect(await within(dialog).findByText('El nombre es obligatorio')).toBeInTheDocument();
    expect(within(dialog).getByText('Selecciona un rol')).toBeInTheDocument();

    // Un administrador no puede otorgar el rol Propietario
    const roleSelect = within(dialog).getByLabelText('Rol');
    const options = within(roleSelect).getAllByRole('option').map((o) => o.textContent);
    expect(options).not.toContain('Propietario');
    expect(options).toContain('Cajero');

    await userEvent.type(within(dialog).getByLabelText('Nombre(s)'), 'Nuevo');
    await userEvent.type(within(dialog).getByLabelText('Apellidos'), 'Prueba');
    await userEvent.type(within(dialog).getByLabelText('Correo electrónico'), 'nuevo@test.local');
    await userEvent.selectOptions(roleSelect, 'cashier');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Crear usuario' }));

    const passwordDialog = await screen.findByRole('dialog', { name: 'Usuario creado' });
    expect(within(passwordDialog).getByText('Tmp7kQ2mNx9p')).toBeInTheDocument();

    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(post[1]!.body as string)).toEqual({
      email: 'nuevo@test.local',
      firstName: 'Nuevo',
      lastName: 'Prueba',
      phone: null,
      professionalLicense: null,
      roleId: 'cashier',
      branchIds: ['b1'],
      defaultBranchId: 'b1',
    });
  });

  it('muestra en el campo el error de correo duplicado que devuelve el servidor', async () => {
    mockApi({
      'GET /users': page([]),
      'GET /roles': { roles: ROLES },
      'GET /branches': { branches: [branch] },
      'POST /users': new Response(
        JSON.stringify({
          error: { code: 'CONFLICT', message: 'Ya existe', details: [{ path: 'email', message: 'Este correo ya está registrado' }] },
        }),
        { status: 409 },
      ),
    });
    renderApp(<UsersListPage />, { user: sessionUser('OWNER') });

    await userEvent.click(await screen.findByRole('button', { name: /Nuevo usuario/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo usuario' });
    await userEvent.type(within(dialog).getByLabelText('Nombre(s)'), 'A');
    await userEvent.type(within(dialog).getByLabelText('Apellidos'), 'B');
    await userEvent.type(within(dialog).getByLabelText('Correo electrónico'), 'repetido@test.local');
    await userEvent.selectOptions(within(dialog).getByLabelText('Rol'), 'cashier');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Crear usuario' }));

    expect(await within(dialog).findByText('Este correo ya está registrado')).toBeInTheDocument();
  });
});

describe('PermissionMatrix', () => {
  function Harness({ grantable }: { grantable: (k: PermissionKey) => boolean }) {
    const [selected, setSelected] = useState<Set<PermissionKey>>(new Set(['sales.view']));
    return (
      <>
        <PermissionMatrix groups={GROUPS} selected={selected} onChange={setSelected} readOnly={false} grantable={grantable} />
        <output>{[...selected].sort().join(',')}</output>
      </>
    );
  }

  it('el casillero del módulo selecciona todos los permisos otorgables', async () => {
    const { container } = render(<Harness grantable={() => true} />);
    const moduleBox = screen.getByLabelText('Seleccionar todos los permisos de Ventas y devoluciones');
    expect(moduleBox).toHaveProperty('indeterminate', true);

    await userEvent.click(moduleBox);
    expect(container.querySelector('output')).toHaveTextContent(/^sales\.cancel,sales\.create,sales\.view$/);
    expect(moduleBox).toBeChecked();
  });

  it('no permite marcar permisos que el usuario no puede otorgar', async () => {
    render(<Harness grantable={(k) => k !== 'audit.view'} />);
    const auditBox = screen.getByRole('checkbox', { name: /Consultar auditoría/ });
    expect(auditBox).toBeDisabled();
    expect(screen.getAllByText('Sensible')).toHaveLength(2);
  });
});

describe('RoleEditorPage', () => {
  it('el rol Propietario se muestra en sólo lectura', async () => {
    mockApi({ 'GET /roles': { roles: ROLES }, 'GET /permissions': { groups: GROUPS } });
    renderApp(<RoleEditorPage />, {
      user: sessionUser('OWNER'),
      path: '/usuarios/roles/owner',
      routes: [{ path: '/usuarios/roles/:id', element: <RoleEditorPage /> }],
    });
    expect(await screen.findByText(/siempre tiene acceso total/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Nombre del rol')).toBeDisabled());
  });

  it('crea un rol con los permisos seleccionados', async () => {
    const fetchMock = mockApi({
      'GET /roles': { roles: ROLES },
      'GET /permissions': { groups: GROUPS },
      'POST /roles': { role: { ...role('CASHIER'), id: 'nuevo', name: 'Auxiliar', isSystem: false } },
    });
    const { router } = renderApp(<RoleEditorPage />, {
      user: sessionUser('OWNER'),
      path: '/usuarios/roles/nuevo',
      routes: [
        { path: '/usuarios/roles/nuevo', element: <RoleEditorPage /> },
        { path: '/usuarios/roles', element: <p>Lista de roles</p> },
      ],
    });

    await userEvent.type(await screen.findByLabelText('Nombre del rol'), 'Auxiliar');
    await userEvent.click(screen.getByRole('checkbox', { name: /Realizar ventas/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Crear rol' }));

    expect(await screen.findByText('Lista de roles')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/usuarios/roles');
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(post[1]!.body as string)).toEqual({
      name: 'Auxiliar',
      description: null,
      permissions: ['sales.create'],
    });
  });
});
