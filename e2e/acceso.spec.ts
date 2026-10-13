import { expect, test } from '@playwright/test';
import { USERS } from './support/constants';
import { apiAs, collectErrors, login, uid } from './support/helpers';

test.describe('Acceso y permisos', () => {
  test('cada rol entra a su pantalla y sólo ve sus módulos', async ({ page }) => {
    const errors = collectErrors(page);
    await login(page, 'cashier');
    // La cajera no tiene dashboard: entra directo al punto de venta
    await expect(page).toHaveURL(/\/ventas\/punto-de-venta/);
    const menu = page.getByRole('navigation').first();
    await expect(menu.getByRole('link', { name: 'Punto de venta' })).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Reportes' })).toHaveCount(0);
    await expect(menu.getByRole('link', { name: 'Auditoría' })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('el farmacéutico no entra a reportes, auditoría ni configuración', async ({ page }) => {
    await login(page, 'pharmacist');
    await expect(page.getByText('Mis ventas de hoy')).toBeVisible();
    for (const path of ['/reportes', '/auditoria', '/configuracion']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: 'Acceso restringido' })).toBeVisible();
    }
  });

  test('una contraseña incorrecta no abre sesión', async ({ page }) => {
    await page.goto('/iniciar-sesion');
    await page.getByLabel('Correo electrónico').fill(USERS.warehouse);
    await page.getByLabel('Contraseña', { exact: true }).fill('NoEsLaClave2026');
    await page.getByRole('button', { name: /entrar/i }).click();
    await expect(page.getByText('Correo o contraseña incorrectos')).toBeVisible();
    await expect(page).toHaveURL(/iniciar-sesion/);
  });

  test('un usuario nuevo debe cambiar su contraseña temporal al entrar', async ({ page, request }) => {
    const api = await apiAs(request, 'owner');
    const { roles } = await api.get<{ roles: { id: string; code: string }[] }>('/roles');
    const { branches } = await api.get<{ branches: { id: string }[] }>('/branches');
    const email = `cajero-${uid().toLowerCase()}@farmacia-e2e.local`;
    const { temporaryPassword } = await api.post<{ temporaryPassword: string }>('/users', {
      email,
      firstName: 'Cajero',
      lastName: 'Nuevo',
      roleId: roles.find((r) => r.code === 'CASHIER')!.id,
      branchIds: [branches[0]!.id],
    });

    await page.goto('/iniciar-sesion');
    await page.getByLabel('Correo electrónico').fill(email);
    await page.getByLabel('Contraseña', { exact: true }).fill(temporaryPassword);
    await page.getByRole('button', { name: /entrar/i }).click();
    // No puede ir a ningún lado hasta elegir su propia contraseña
    await expect(page).toHaveURL(/\/perfil\?obligatorio=1/);
    await page.goto('/ventas/punto-de-venta');
    await expect(page).toHaveURL(/\/perfil\?obligatorio=1/);

    const nueva = `MiClave${uid()}9`;
    await page.getByLabel('Contraseña actual').fill(temporaryPassword);
    await page.getByLabel('Nueva contraseña', { exact: true }).fill(nueva);
    await page.getByLabel('Confirmar nueva contraseña').fill(nueva);
    await page.getByRole('button', { name: 'Actualizar contraseña' }).click();
    await expect(page.getByText(/actualizada|cambiada/i).first()).toBeVisible();
    await page.goto('/');
    await expect(page).toHaveURL(/\/ventas\/punto-de-venta/);
  });
});
