import { expect, test } from '@playwright/test';
import { createProduct, inDays, login, uid, visible } from './support/helpers';

test.describe('Compras e inventario', () => {
  test('el almacenista registra una compra, la recibe y el lote entra al inventario', async ({ page, request }) => {
    const product = await createProduct(request, { stock: 0, cost: 12 });
    const lot = `C-${uid()}`;
    await login(page, 'warehouse');
    await page.goto('/compras/nueva');
    const supplier = page.getByLabel('Proveedor');
    await expect(supplier.locator('option').nth(1)).toBeAttached();
    await supplier.selectOption({ index: 1 });
    await page.getByLabel('Folio de factura (opcional)').fill(`F-${uid()}`);
    await page.getByLabel('Agregar producto').fill(product.name);
    await page.getByRole('button', { name: new RegExp(`^${product.name}`) }).click();
    const line = page.getByTestId('purchase-line').first();
    await line.getByLabel('Lote').fill(lot);
    await line.getByLabel('Caducidad').fill(inDays(500));
    await line.getByLabel('Cantidad').fill('12');
    await line.getByLabel('Costo unitario').fill('12.50');
    await page.getByRole('button', { name: 'Guardar y recibir mercancía' }).click();
    await expect(page.getByRole('status').filter({ hasText: /recibida/ }).first()).toBeVisible();

    // El lote quedó con su movimiento "Entrada por compra"
    await page.getByRole('link', { name: product.name }).click();
    await expect(visible(page.getByText(lot))).toBeVisible();
    await expect(visible(page.getByText('Entrada por compra'))).toBeVisible();
  });

  test('un ajuste de salida exige motivo y queda en la bitácora de movimientos', async ({ page, request }) => {
    const product = await createProduct(request, { stock: 10 });
    await login(page, 'warehouse');
    await page.goto(`/inventario/existencias/${product.id}`);
    await page.getByRole('button', { name: 'Ajustar', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Ajustar inventario' });
    await dialog.getByRole('radio', { name: /Salida/ }).click();
    await dialog.getByLabel('Cantidad').fill('2');
    await dialog.getByRole('button', { name: 'Registrar ajuste' }).click();
    // Sin motivo no se registra
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Motivo').selectOption({ label: 'Producto dañado' });
    await dialog.getByRole('button', { name: 'Registrar ajuste' }).click();
    await expect(dialog).toBeHidden();

    await page.goto('/inventario/movimientos');
    await expect(visible(page.getByText(product.name))).toBeVisible();
    await expect(visible(page.getByText('Producto dañado'))).toBeVisible();
  });
});
