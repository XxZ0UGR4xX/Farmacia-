import { expect, test, type Page } from '@playwright/test';
import { login, newSession } from './support/helpers';

/** Deja el margen sobre el costo o sobre el precio (y lo guarda sólo si cambió). */
async function setMarginBasis(page: Page, basis: 'COST' | 'PRICE') {
  await page.goto('/configuracion');
  const form = page.locator('form').filter({ has: page.getByLabel('Margen predeterminado (%)') });
  const radio = form.getByRole('radio', { name: basis === 'PRICE' ? /Sobre el precio de venta/ : /Sobre el costo/ });
  if (await radio.isChecked()) return;
  await radio.check();
  await form.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Precios y margen: cambios guardados')).toBeVisible();
}

test.describe('Configuración y auditoría', () => {
  test.afterEach(async ({ browser }) => {
    // La configuración es global: se devuelve al valor de demostración (en una sesión nueva)
    const page = await newSession(browser, 'owner');
    await setMarginBasis(page, 'COST');
    await page.context().close();
  });

  test('el margen sobre el precio de venta cambia el precio sugerido y queda auditado', async ({ page, browser }) => {
    await login(page, 'owner');
    await setMarginBasis(page, 'COST');
    await setMarginBasis(page, 'PRICE');

    // El farmacéutico da de alta un producto: $100 de costo con 30 % sobre el precio → $143
    const pharmacist = await newSession(browser, 'pharmacist');
    await pharmacist.goto('/inventario/productos/nuevo');
    await pharmacist.getByLabel('Precio de compra (costo)').fill('100');
    await pharmacist.getByLabel('Precio de venta').fill('1');
    await pharmacist.getByRole('button', { name: /Sugerir precio \(30 % sobre precio de venta\)/ }).click();
    await expect(pharmacist.getByLabel('Precio de venta')).toHaveValue('143.00');
    await pharmacist.context().close();

    // La bitácora muestra el cambio con antes y después
    await page.goto('/auditoria');
    await page.getByLabel('Acción').selectOption({ label: 'Cambio de configuración' });
    await page.getByRole('button', { name: 'Cambio de configuración' }).first().click();
    const detail = page.getByRole('dialog');
    await expect(detail.getByRole('row', { name: /Cálculo del margen.*Sobre el costo.*Sobre el precio de venta/ })).toBeVisible();
  });
});
