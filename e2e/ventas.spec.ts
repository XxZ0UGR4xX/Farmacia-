import { expect, test } from '@playwright/test';
import { collectErrors, createProduct, login, scan, uid, visible } from './support/helpers';

test.describe('Punto de venta', () => {
  test('venta en efectivo con cambio; aparece en el historial y en el corte', async ({ page, request }) => {
    const product = await createProduct(request, { price: 35, stock: 10 });
    const errors = collectErrors(page);
    await login(page, 'cashier');
    await scan(page, product.barcode);
    await expect(page.getByText(product.name)).toBeVisible();
    await scan(page, product.barcode); // un segundo escaneo suma una unidad
    await expect(page.getByText('$70.00').first()).toBeVisible();

    await page.getByRole('radio', { name: /Efectivo/ }).click();
    await page.getByLabel('Efectivo recibido').fill('100');
    await expect(page.getByText('$30.00').first()).toBeVisible(); // cambio
    await page.getByRole('button', { name: /^Cobrar/ }).click();
    const done = page.getByRole('dialog');
    await expect(done.getByText(/registrada/).first()).toBeVisible();
    const folio = (await done.getByText(/V-\d{6}/).first().innerText()).match(/V-\d{6}/)![0];

    await page.goto('/ventas/historial');
    await expect(visible(page.getByText(folio))).toBeVisible();
    await expect(page.getByText('Corte de hoy')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('un antibiótico exige registrar la receta del paciente, también en la caja', async ({ page, request }) => {
    const antibiotic = await createProduct(request, { price: 89, stock: 5, controlled: true });
    await login(page, 'cashier');
    await scan(page, antibiotic.barcode);
    const panel = page.getByTestId('rx-panel');
    await expect(panel).toBeVisible();
    await page.getByRole('radio', { name: /Tarjeta/ }).click();
    // Sin receta no se puede cobrar
    await expect(page.getByRole('button', { name: /^Cobrar/ })).toBeDisabled();

    // Paciente nuevo dado de alta desde el mostrador (datos ficticios)
    const id = uid();
    await panel.getByRole('button', { name: 'Nuevo paciente' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nuevo paciente' });
    await dialog.getByLabel('Nombre(s)').fill(`Paciente ${id}`);
    await dialog.getByLabel('Apellidos').fill('Prueba Ficticio');
    await dialog.getByRole('button', { name: 'Registrar paciente' }).click();
    await expect(panel.getByText(`Paciente ${id} Prueba Ficticio`)).toBeVisible();

    await panel.getByRole('radio', { name: /Registrar la receta/ }).click();
    await panel.getByLabel('Médico que prescribe').fill('Dra. Laura Ejemplo Sánchez');
    await page.getByRole('button', { name: /^Cobrar/ }).click();
    await expect(page.getByRole('dialog').getByText(/registrada/).first()).toBeVisible();
  });
});
