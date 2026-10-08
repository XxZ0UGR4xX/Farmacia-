import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '../../api/catalog';
import { setSession } from '../../api/client';
import { mockApi, renderApp, sessionUser } from '../../test/render';
import { CatalogPage } from './CatalogPage';
import { ProductFormPage } from './ProductFormPage';
import { ProductsListPage } from './ProductsListPage';

const DEFAULTS = {
  taxes: { defaultRate: 0, pricesIncludeTax: true },
  inventory: { defaultMarginPercent: 30, defaultMinStock: 5 },
  currency: { code: 'MXN', symbol: '$', locale: 'es-MX' },
};
const CATEGORIES = { items: [{ id: 'cat1', name: 'Analgésicos', productCount: 1, description: null }] };
const LABS = { items: [{ id: 'lab1', name: 'Laboratorios Salvia', productCount: 1, country: 'México', website: null }] };

function product(extra: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    sku: 'MED-000001',
    barcode: '2000000010015',
    commercialName: 'Paracetamol 500 mg',
    genericName: 'Paracetamol',
    activeIngredient: 'Paracetamol',
    category: { id: 'cat1', name: 'Analgésicos' },
    presentation: 'BOX',
    concentration: '500 mg',
    pharmaceuticalForm: 'Tableta',
    contentQuantity: '20 tabletas',
    laboratory: { id: 'lab1', name: 'Laboratorios Salvia' },
    manufacturer: null,
    salePrice: 35,
    taxRate: 0,
    purchasePrice: 18,
    margin: { netSalePrice: 35, profit: 17, markupPercent: 94.44, marginPercent: 48.57 },
    requiresPrescription: false,
    isControlled: false,
    status: 'ACTIVE',
    imageUrl: null,
    description: null,
    indications: null,
    observations: null,
    stock: 0,
    stockStatus: 'OUT',
    inventory: { minStock: 10, maxStock: 60, location: 'Anaquel A-1' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...extra,
  };
}

const page = (items: Product[]) => ({ data: items, meta: { page: 1, pageSize: 25, total: items.length, totalPages: 1 } });

afterEach(() => {
  vi.unstubAllGlobals();
  setSession(null);
});

const routesFor = (element: React.ReactElement, path: string) => [
  { path, element },
  { path: '/inventario/productos', element: <p>Lista de productos</p> },
  { path: '/inventario/productos/:id', element: <p>Detalle</p> },
];

describe('ProductFormPage — alta', () => {
  it('valida, calcula el margen en vivo y envía el producto', async () => {
    const fetchMock = mockApi({
      'GET /categories': CATEGORIES,
      'GET /laboratories': LABS,
      'GET /settings/defaults': DEFAULTS,
      'POST /products': { product: product({ id: 'p-creado' }) },
    });
    const { router } = renderApp(<ProductFormPage />, {
      user: sessionUser('OWNER'),
      path: '/inventario/productos/nuevo',
      routes: routesFor(<ProductFormPage />, '/inventario/productos/nuevo'),
    });

    // El stock mínimo predeterminado viene de la configuración
    await waitFor(() => expect(screen.getByLabelText('Stock mínimo')).toHaveValue('5'));

    await userEvent.click(screen.getByRole('button', { name: 'Registrar producto' }));
    expect(await screen.findByText('El nombre comercial es obligatorio')).toBeInTheDocument();
    expect(screen.getByText('Selecciona una categoría')).toBeInTheDocument();
    expect(screen.getByText('Este precio es obligatorio')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Nombre comercial'), 'Paracetamol 500 mg');
    await userEvent.selectOptions(screen.getByLabelText('Categoría'), 'cat1');
    await userEvent.selectOptions(screen.getByLabelText('Presentación'), 'BOX');
    await userEvent.type(screen.getByLabelText('Precio de compra (costo)'), '18');
    await userEvent.type(screen.getByLabelText('Precio de venta'), '35,00');
    expect(screen.getByText('$17.00')).toBeInTheDocument(); // utilidad por unidad

    // El Enter del lector de código de barras no envía el formulario
    await userEvent.type(screen.getByLabelText('Código de barras'), '2000000010015{Enter}');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Registrar producto' }));
    const post = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(call).toBeTruthy();
      return call!;
    });
    expect(JSON.parse(post[1]!.body as string)).toMatchObject({
      commercialName: 'Paracetamol 500 mg',
      categoryId: 'cat1',
      presentation: 'BOX',
      barcode: '2000000010015',
      purchasePrice: 18,
      salePrice: 35,
      taxRate: 0,
      minStock: 5,
      laboratoryId: null,
    });
    // Tras registrarlo se abre su ficha para agregar la imagen
    expect(await screen.findByText('Detalle')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/inventario/productos/p-creado');
  });

  it('avisa si el precio de venta queda por debajo del costo y sugiere uno', async () => {
    mockApi({ 'GET /categories': CATEGORIES, 'GET /laboratories': LABS, 'GET /settings/defaults': DEFAULTS });
    renderApp(<ProductFormPage />, {
      user: sessionUser('OWNER'),
      path: '/inventario/productos/nuevo',
      routes: routesFor(<ProductFormPage />, '/inventario/productos/nuevo'),
    });
    await userEvent.type(await screen.findByLabelText('Precio de compra (costo)'), '100');
    await userEvent.type(screen.getByLabelText('Precio de venta'), '80');
    expect(screen.getByText('El precio de venta está por debajo del costo.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Sugerir precio/ }));
    expect(screen.getByLabelText('Precio de venta')).toHaveValue('130.00');
  });
});

describe('ProductFormPage — edición', () => {
  it('un farmacéutico edita el producto pero no puede cambiar precios', async () => {
    const fetchMock = mockApi({
      'GET /products/p1': { product: product() },
      'GET /categories': CATEGORIES,
      'GET /laboratories': LABS,
      'GET /settings/defaults': DEFAULTS,
      'PATCH /products/p1': { product: product({ indications: 'Dolor leve' }) },
    });
    renderApp(<ProductFormPage />, {
      user: sessionUser('PHARMACIST'),
      path: '/inventario/productos/p1',
      routes: [
        { path: '/inventario/productos/:id', element: <ProductFormPage /> },
        { path: '/inventario/productos', element: <p>Lista de productos</p> },
      ],
    });

    expect(await screen.findByText('Tu rol no permite cambiar precios.')).toBeInTheDocument();
    expect(screen.getByLabelText('Precio de venta')).toBeDisabled();
    // El farmacéutico no puede eliminar productos
    expect(screen.queryByRole('button', { name: /Eliminar/ })).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Indicaciones'), 'Dolor leve');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Lista de productos')).toBeInTheDocument();

    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    const body = JSON.parse(patch[1]!.body as string);
    expect(body.indications).toBe('Dolor leve');
    expect(body).not.toHaveProperty('salePrice');
    expect(body).not.toHaveProperty('purchasePrice');
  });

  it('un cajero ve el producto en modo consulta, sin costo', async () => {
    const { purchasePrice: _cost, margin: _margin, ...withoutCosts } = product();
    mockApi({
      'GET /products/p1': { product: withoutCosts },
      'GET /categories': CATEGORIES,
      'GET /laboratories': LABS,
      'GET /settings/defaults': DEFAULTS,
    });
    renderApp(<ProductFormPage />, {
      user: sessionUser('CASHIER'),
      path: '/inventario/productos/p1',
      routes: [{ path: '/inventario/productos/:id', element: <ProductFormPage /> }],
    });
    expect(await screen.findByText(/modo consulta/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Precio de compra (costo)')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Nombre comercial')).toBeDisabled();
  });
});

describe('ProductsListPage', () => {
  it('lista productos y oculta el margen a quien no ve costos', async () => {
    const { purchasePrice: _c, margin: _m, ...withoutCosts } = product();
    mockApi({ 'GET /products': page([withoutCosts]), 'GET /categories': CATEGORIES, 'GET /laboratories': LABS });
    renderApp(<ProductsListPage />, { user: sessionUser('CASHIER') });
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Paracetamol 500 mg')).toBeInTheDocument();
    expect(within(table).getByText('500 mg · Tableta · Caja con 20 tabletas')).toBeInTheDocument();
    expect(within(table).queryByText('Margen')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Nuevo producto/ })).not.toBeInTheDocument();
  });

  it('al escanear un código de barras y presionar Enter abre el producto', async () => {
    mockApi({
      'GET /products': page([product()]),
      'GET /categories': CATEGORIES,
      'GET /laboratories': LABS,
      'GET /products/barcode/2000000010015': { product: product() },
    });
    const { router } = renderApp(<ProductsListPage />, {
      user: sessionUser('OWNER'),
      path: '/inventario/productos',
      routes: [
        { path: '/inventario/productos', element: <ProductsListPage /> },
        { path: '/inventario/productos/:id', element: <p>Detalle</p> },
      ],
    });
    await userEvent.type(await screen.findByLabelText('Buscar'), '2000000010015{Enter}');
    expect(await screen.findByText('Detalle')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/inventario/productos/p1');
  });
});

describe('CatalogPage', () => {
  it('crea un laboratorio con la concordancia correcta en los textos', async () => {
    const fetchMock = mockApi({
      'GET /laboratories': LABS,
      'POST /laboratories': { item: { id: 'lab2', name: 'Dermagen', productCount: 0, country: null, website: null } },
    });
    renderApp(<CatalogPage kind="laboratories" />, { user: sessionUser('OWNER') });
    await userEvent.click(await screen.findByRole('button', { name: 'Nuevo laboratorio' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo laboratorio' });
    await userEvent.type(within(dialog).getByLabelText('Nombre'), 'Dermagen');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('"Dermagen" agregado')).toBeInTheDocument();
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(post[1]!.body as string)).toEqual({ name: 'Dermagen', country: '', website: '' });
  });

  it('un farmacéutico consulta el catálogo sin botones de administración', async () => {
    mockApi({ 'GET /categories': CATEGORIES });
    renderApp(<CatalogPage kind="categories" />, { user: sessionUser('PHARMACIST') });
    expect(await screen.findByText('Analgésicos')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nueva categoría' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Editar/ })).not.toBeInTheDocument();
  });
});
