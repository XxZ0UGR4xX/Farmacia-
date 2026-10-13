import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { collectErrors, login } from './support/helpers';

test.describe('Dashboard y reportes', () => {
  test('el propietario ve indicadores, gráficas con vista de tabla y exporta a Excel', async ({ page }) => {
    const errors = collectErrors(page);
    await login(page, 'owner');
    await expect(page.getByTestId('kpi-sales-today')).toBeVisible();
    await expect(page.getByText('Utilidad bruta de hoy')).toBeVisible();

    await page.goto('/reportes');
    await expect(page.getByTestId('report-net')).toBeVisible();
    await page.getByRole('button', { name: '30 días' }).click();
    await page.getByRole('button', { name: 'Ver tabla' }).first().click();
    await expect(page.getByRole('table').first()).toBeVisible();

    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Excel' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^ventas_\d{4}-\d{2}-\d{2}_a_\d{4}-\d{2}-\d{2}\.xlsx$/);
    const file = await readFile((await download.path())!);
    expect(file.subarray(0, 2).toString()).toBe('PK'); // un .xlsx es un ZIP

    for (const [tab, id] of [
      ['Inventario', 'inventory-cost'],
      ['Mermas y ajustes', 'shrinkage-loss'],
      ['Compras', 'purchases-total'],
    ] as const) {
      await page.getByRole('tab', { name: tab }).click();
      await expect(page.getByTestId(id)).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
});
