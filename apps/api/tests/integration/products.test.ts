import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { actorWithRole, createTestUser, loginAs, mainBranchId, type TestUser } from '../helpers';

const app = createApp({ rateLimitEnabled: false });
let owner: TestUser & { token: string };
let categoryId: string;
let laboratoryId: string;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const tag = () => randomUUID().slice(0, 8);

async function createProduct(token: string, extra: Record<string, unknown> = {}) {
  return request(app)
    .post('/api/v1/products')
    .set(auth(token))
    .send({
      commercialName: `Paracetamol ${tag()}`,
      genericName: 'Paracetamol',
      activeIngredient: 'Paracetamol',
      concentration: '500 mg',
      categoryId,
      laboratoryId,
      presentation: 'BOX',
      purchasePrice: 18,
      salePrice: 35,
      ...extra,
    });
}

beforeAll(async () => {
  owner = await actorWithRole(app, 'OWNER');
  categoryId = (await prisma.category.create({ data: { name: `Analgésicos ${tag()}` } })).id;
  laboratoryId = (await prisma.laboratory.create({ data: { name: `Lab ${tag()}` } })).id;
});
afterAll(() => prisma.$disconnect());

describe('POST /products', () => {
  it('crea el producto con SKU automático, margen y parámetros de inventario', async () => {
    const res = await createProduct(owner.token, { minStock: 12, maxStock: 80, location: 'Anaquel A-1' });
    expect(res.status).toBe(201);
    const p = res.body.product;
    expect(p.sku).toMatch(/^MED-\d{6}$/);
    expect(p).toMatchObject({
      salePrice: 35,
      purchasePrice: 18,
      taxRate: 0,
      status: 'ACTIVE',
      stock: 0,
      stockStatus: 'OUT',
      inventory: { minStock: 12, maxStock: 80, location: 'Anaquel A-1' },
      category: { id: categoryId },
      laboratory: { id: laboratoryId },
    });
    expect(p.margin).toMatchObject({ profit: 17, markupPercent: 94.44 });

    const audit = await prisma.auditLog.findFirst({ where: { entityId: p.id, action: 'PRODUCT_CREATE' } });
    expect(audit?.userId).toBe(owner.id);
  });

  it('usa el stock mínimo predeterminado de la configuración', async () => {
    const res = await createProduct(owner.token);
    expect(res.body.product.inventory.minStock).toBe(5);
  });

  it('rechaza códigos de barras y SKU duplicados indicando el producto', async () => {
    const barcode = `75${Date.now()}`.slice(0, 13);
    const first = await createProduct(owner.token, { barcode, sku: `SKU-${tag()}`.toUpperCase() });
    expect(first.status).toBe(201);
    const dupBarcode = await createProduct(owner.token, { barcode });
    expect(dupBarcode.status).toBe(409);
    expect(dupBarcode.body.error.details).toEqual([expect.objectContaining({ path: 'barcode' })]);
    const dupSku = await createProduct(owner.token, { sku: first.body.product.sku });
    expect(dupSku.status).toBe(409);
  });

  it('valida campos obligatorios, referencias y montos', async () => {
    const empty = await request(app).post('/api/v1/products').set(auth(owner.token)).send({});
    expect(empty.status).toBe(400);
    const paths = empty.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['commercialName', 'categoryId', 'presentation', 'salePrice']));

    expect((await createProduct(owner.token, { categoryId: randomUUID() })).status).toBe(400);
    expect((await createProduct(owner.token, { salePrice: -5 })).status).toBe(400);
    expect((await createProduct(owner.token, { minStock: 10, maxStock: 2 })).status).toBe(400);
  });

  it('un cajero no puede crear productos', async () => {
    const cashier = await actorWithRole(app, 'CASHIER');
    expect((await createProduct(cashier.token)).status).toBe(403);
  });
});

describe('GET /products', () => {
  it('busca sin acentos, por varias palabras, código de barras y SKU', async () => {
    const t = tag();
    const created = await createProduct(owner.token, {
      commercialName: `Ácido fólico ${t}`,
      genericName: 'Ácido fólico',
      concentration: '5 mg',
      barcode: `2009${Date.now()}`.slice(0, 13),
    });
    const p = created.body.product;
    for (const q of [`acido ${t}`, `FOLICO ${t}`, `${t} 5 mg`, p.barcode, p.sku.toLowerCase()]) {
      const res = await request(app).get('/api/v1/products').query({ q }).set(auth(owner.token));
      expect(res.body.data.map((x: { id: string }) => x.id), `búsqueda "${q}"`).toContain(p.id);
    }
    const none = await request(app).get('/api/v1/products').query({ q: `ibuprofeno ${t}` }).set(auth(owner.token));
    expect(none.body.data).toHaveLength(0);
  });

  it('filtra por categoría, receta y estado', async () => {
    const t = tag();
    await createProduct(owner.token, { commercialName: `Amoxicilina ${t}`, requiresPrescription: true });
    await createProduct(owner.token, { commercialName: `Loratadina ${t}`, status: 'INACTIVE' });
    const rx = await request(app)
      .get('/api/v1/products')
      .query({ q: t, requiresPrescription: 'true' })
      .set(auth(owner.token));
    expect(rx.body.data.map((x: { commercialName: string }) => x.commercialName)).toEqual([`Amoxicilina ${t}`]);
    const inactive = await request(app).get('/api/v1/products').query({ q: t, status: 'INACTIVE' }).set(auth(owner.token));
    expect(inactive.body.data).toHaveLength(1);
    const byCategory = await request(app).get('/api/v1/products').query({ q: t, categoryId }).set(auth(owner.token));
    expect(byCategory.body.meta.total).toBe(2);
  });

  it('un cajero ve precio de venta pero no costo ni margen', async () => {
    const created = await createProduct(owner.token);
    const cashier = await actorWithRole(app, 'CASHIER');
    const res = await request(app).get(`/api/v1/products/${created.body.product.id}`).set(auth(cashier.token));
    expect(res.status).toBe(200);
    expect(res.body.product.salePrice).toBe(35);
    expect(res.body.product).not.toHaveProperty('purchasePrice');
    expect(res.body.product).not.toHaveProperty('margin');
  });

  it('busca por código de barras exacto (lector)', async () => {
    const barcode = `2001${Date.now()}`.slice(0, 13);
    const created = await createProduct(owner.token, { barcode });
    const res = await request(app).get(`/api/v1/products/barcode/${barcode}`).set(auth(owner.token));
    expect(res.body.product.id).toBe(created.body.product.id);
    expect((await request(app).get('/api/v1/products/barcode/0000000').set(auth(owner.token))).status).toBe(404);
  });

  it('calcula existencias desde los lotes de la sucursal', async () => {
    const created = await createProduct(owner.token, { minStock: 10 });
    const id = created.body.product.id;
    const branchId = await mainBranchId();
    await prisma.productBatch.create({
      data: { productId: id, branchId, lotNumber: `L-${tag()}`, expiresAt: new Date('2030-01-01'), quantity: 6, initialQuantity: 6, unitCost: 18 },
    });
    await prisma.productBatch.create({
      data: { productId: id, branchId, lotNumber: `L-${tag()}`, expiresAt: new Date('2030-06-01'), quantity: 4, initialQuantity: 4, unitCost: 18, status: 'QUARANTINE' },
    });
    const res = await request(app).get(`/api/v1/products/${id}`).set(auth(owner.token));
    // Los lotes en cuarentena no cuentan como disponibles
    expect(res.body.product).toMatchObject({ stock: 6, stockStatus: 'LOW' });
  });

  it('rechaza una sucursal a la que el usuario no tiene acceso', async () => {
    const res = await request(app).get('/api/v1/products').set(auth(owner.token)).set('X-Branch-Id', randomUUID());
    expect(res.status).toBe(403);
  });
});

describe('PATCH /products/:id', () => {
  it('cambiar el precio requiere products.change_price y se audita aparte', async () => {
    const created = await createProduct(owner.token);
    const id = created.body.product.id;
    const pharmacist = await actorWithRole(app, 'PHARMACIST'); // edita productos, no cambia precios

    const denied = await request(app).patch(`/api/v1/products/${id}`).set(auth(pharmacist.token)).send({ salePrice: 40 });
    expect(denied.status).toBe(403);

    const allowedEdit = await request(app)
      .patch(`/api/v1/products/${id}`)
      .set(auth(pharmacist.token))
      .send({ indications: 'Dolor leve', location: 'Anaquel Z-9' });
    expect(allowedEdit.status).toBe(200);
    expect(allowedEdit.body.product).toMatchObject({ indications: 'Dolor leve', inventory: { location: 'Anaquel Z-9' } });

    const priced = await request(app).patch(`/api/v1/products/${id}`).set(auth(owner.token)).send({ salePrice: 39.5 });
    expect(priced.body.product.salePrice).toBe(39.5);

    const priceAudit = await prisma.auditLog.findFirst({ where: { entityId: id, action: 'PRODUCT_PRICE_CHANGE' } });
    expect(priceAudit?.metadata).toMatchObject({ salePrice: { from: 35, to: 39.5 } });
    const updateAudit = await prisma.auditLog.findFirst({ where: { entityId: id, action: 'PRODUCT_UPDATE' } });
    expect(updateAudit?.metadata).toMatchObject({
      indications: { from: null, to: 'Dolor leve' },
      inventory: { location: { to: 'Anaquel Z-9' } },
    });
  });

  it('enviar el mismo precio no cuenta como cambio', async () => {
    const created = await createProduct(owner.token);
    const pharmacist = await actorWithRole(app, 'PHARMACIST');
    const res = await request(app)
      .patch(`/api/v1/products/${created.body.product.id}`)
      .set(auth(pharmacist.token))
      .send({ salePrice: 35, commercialName: 'Renombrado' });
    expect(res.status).toBe(200);
  });

  it('la búsqueda refleja el nuevo nombre', async () => {
    const created = await createProduct(owner.token);
    const t = tag();
    await request(app).patch(`/api/v1/products/${created.body.product.id}`).set(auth(owner.token)).send({ commercialName: `Naproxeno ${t}` });
    const res = await request(app).get('/api/v1/products').query({ q: `naproxeno ${t}` }).set(auth(owner.token));
    expect(res.body.data).toHaveLength(1);
  });
});

describe('DELETE /products/:id', () => {
  it('baja lógica: libera el código de barras y conserva el historial', async () => {
    const barcode = `2002${Date.now()}`.slice(0, 13);
    const created = await createProduct(owner.token, { barcode });
    const id = created.body.product.id;
    expect((await request(app).delete(`/api/v1/products/${id}`).set(auth(owner.token))).status).toBe(204);

    expect((await request(app).get(`/api/v1/products/${id}`).set(auth(owner.token))).status).toBe(404);
    const row = await prisma.product.findUnique({ where: { id } });
    expect(row?.deletedAt).not.toBeNull();
    expect((await createProduct(owner.token, { barcode })).status).toBe(201);
    const audit = await prisma.auditLog.findFirst({ where: { entityId: id, action: 'PRODUCT_DELETE' } });
    expect(audit?.metadata).toMatchObject({ barcode });
  });

  it('no elimina productos con existencias', async () => {
    const created = await createProduct(owner.token);
    const id = created.body.product.id;
    await prisma.productBatch.create({
      data: { productId: id, branchId: await mainBranchId(), lotNumber: `L-${tag()}`, expiresAt: new Date('2030-01-01'), quantity: 3, initialQuantity: 3, unitCost: 10 },
    });
    const res = await request(app).delete(`/api/v1/products/${id}`).set(auth(owner.token));
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/3 unidad/);
  });

  it('requiere products.delete (el farmacéutico no lo tiene)', async () => {
    const created = await createProduct(owner.token);
    const pharmacist = await actorWithRole(app, 'PHARMACIST');
    expect((await request(app).delete(`/api/v1/products/${created.body.product.id}`).set(auth(pharmacist.token))).status).toBe(403);
  });
});

describe('imagen del producto', () => {
  it('acepta JPG/PNG, la convierte a WebP, la sirve y reemplaza la anterior', async () => {
    const created = await createProduct(owner.token);
    const id = created.body.product.id;
    const png = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#10b981' } }).png().toBuffer();

    const first = await request(app).post(`/api/v1/products/${id}/image`).set(auth(owner.token)).attach('image', png, 'foto.png');
    expect(first.status).toBe(200);
    expect(first.body.imageUrl).toMatch(/^\/api\/uploads\/products\/.+\.webp$/);

    const served = await request(app).get(first.body.imageUrl).buffer(true);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/webp');
    const meta = await sharp(served.body as Buffer).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(800);

    const second = await request(app).post(`/api/v1/products/${id}/image`).set(auth(owner.token)).attach('image', png, 'otra.png');
    const firstFile = path.join(process.env.UPLOAD_DIR!, 'products', path.basename(first.body.imageUrl));
    expect(existsSync(firstFile)).toBe(false);

    const product = await request(app).get(`/api/v1/products/${id}`).set(auth(owner.token));
    expect(product.body.product.imageUrl).toBe(second.body.imageUrl);

    expect((await request(app).delete(`/api/v1/products/${id}/image`).set(auth(owner.token))).status).toBe(204);
  });

  it('rechaza archivos que no son imágenes aunque digan serlo', async () => {
    const created = await createProduct(owner.token);
    const fake = Buffer.from('<?php echo "hola"; ?>');
    const res = await request(app)
      .post(`/api/v1/products/${created.body.product.id}/image`)
      .set(auth(owner.token))
      .attach('image', fake, { filename: 'foto.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/no es una imagen válida/);
  });

  it('rechaza tipos no permitidos', async () => {
    const created = await createProduct(owner.token);
    const res = await request(app)
      .post(`/api/v1/products/${created.body.product.id}/image`)
      .set(auth(owner.token))
      .attach('image', Buffer.from('GIF89a'), { filename: 'a.gif', contentType: 'image/gif' });
    expect(res.status).toBe(400);
  });
});

describe('GET /settings/defaults', () => {
  it('expone margen, IVA y stock mínimo predeterminados', async () => {
    const user = await createTestUser({ roleCode: 'PHARMACIST' });
    const res = await request(app).get('/api/v1/settings/defaults').set(auth(await loginAs(app, user)));
    expect(res.body).toMatchObject({
      taxes: { pricesIncludeTax: true },
      inventory: { defaultMarginPercent: 30, defaultMinStock: 5 },
      currency: { code: 'MXN' },
    });
  });
});
