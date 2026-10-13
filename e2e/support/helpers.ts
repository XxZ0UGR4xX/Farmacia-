import { expect, type APIRequestContext, type Browser, type Locator, type Page } from '@playwright/test';
import { BASE_URL, E2E_PASSWORD, USERS, type Who } from './constants';

/** Identificador corto y único por corrida (para nombres, lotes y códigos de barras). */
export const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();

export function inDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Inicia sesión desde la pantalla, como lo haría el usuario. */
export async function login(page: Page, who: Who, password = E2E_PASSWORD) {
  await page.goto('/iniciar-sesion');
  await page.getByLabel('Correo electrónico').fill(USERS[who]);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: /entrar/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/iniciar-sesion'));
}

/** Otra sesión del navegador (otro usuario al mismo tiempo), con la misma configuración. */
export async function newSession(browser: Browser, who: Who): Promise<Page> {
  const context = await browser.newContext({ baseURL: BASE_URL, locale: 'es-MX', timezoneId: 'America/Mexico_City', viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  await login(page, who);
  return page;
}

/** Las listas se dibujan dos veces (tabla en escritorio, tarjetas en celular): la que se ve. */
export const visible = (locator: Locator) => locator.filter({ visible: true }).first();

/** Errores de JavaScript de la página: una prueba los revisa al final. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

/** Cliente de la API (para preparar datos de una prueba sin depender de otras pantallas). */
export async function apiAs(request: APIRequestContext, who: Who) {
  const res = await request.post('/api/v1/auth/login', { data: { email: USERS[who], password: E2E_PASSWORD } });
  expect(res.status(), `inicio de sesión de ${who}`).toBe(200);
  const { accessToken } = (await res.json()) as { accessToken: string };
  const headers = { Authorization: `Bearer ${accessToken}` };
  const call = async <T>(method: 'get' | 'post' | 'patch' | 'put', path: string, data?: unknown): Promise<T> => {
    const r = await request[method](`/api/v1${path}`, { headers, data });
    expect(r.ok(), `${method.toUpperCase()} ${path} → ${r.status()} ${await r.text()}`).toBe(true);
    return (await r.json()) as T;
  };
  return {
    get: <T>(path: string) => call<T>('get', path),
    post: <T>(path: string, data?: unknown) => call<T>('post', path, data),
    put: <T>(path: string, data?: unknown) => call<T>('put', path, data),
  };
}

export interface TestProduct {
  id: string;
  name: string;
  barcode: string;
}

/** Producto propio de la prueba con existencia: así no se agota el inventario de demostración. */
export async function createProduct(
  request: APIRequestContext,
  opts: { price?: number; cost?: number; stock?: number; controlled?: boolean } = {},
): Promise<TestProduct> {
  const api = await apiAs(request, 'owner');
  const id = uid();
  const { items } = await api.get<{ items: { id: string }[] }>('/categories');
  const name = `${opts.controlled ? 'Antibiótico' : 'Analgésico'} prueba ${id}`;
  const barcode = `E2E${id}`;
  const { product } = await api.post<{ product: { id: string } }>('/products', {
    commercialName: name,
    barcode,
    categoryId: items[0]!.id,
    presentation: 'BOX',
    purchasePrice: opts.cost ?? 20,
    salePrice: opts.price ?? 50,
    taxRate: 0,
    minStock: 1,
    requiresPrescription: Boolean(opts.controlled),
    isControlled: Boolean(opts.controlled),
  });
  if (opts.stock !== 0) {
    await api.post('/inventory/entries', { productId: product.id, lotNumber: `L-${id}`, expiresAt: inDays(400), quantity: opts.stock ?? 20, unitCost: opts.cost ?? 20 });
  }
  return { id: product.id, name, barcode };
}

/** Agrega un producto al carrito del punto de venta con el "lector" (código + Enter). */
export async function scan(page: Page, barcode: string) {
  const input = page.getByLabel('Producto');
  await input.fill(barcode);
  await input.press('Enter');
}
