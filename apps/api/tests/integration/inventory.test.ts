import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { todayISO } from '../../src/lib/dates';
import { prisma } from '../../src/lib/prisma';
import { allocateFefo } from '../../src/modules/inventory/inventory.core';
import { actorWithRole, mainBranchId, type TestUser } from '../helpers';

const app = createApp({ rateLimitEnabled: false });
let owner: TestUser & { token: string };
let branchId: string;
let categoryId: string;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const tag = () => randomUUID().slice(0, 8).toUpperCase();

function inDays(days: number): string {
  const d = new Date(`${todayISO()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function newProduct(extra: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/v1/products')
    .set(auth(owner.token))
    .send({ commercialName: `Producto ${tag()}`, categoryId, presentation: 'BOX', purchasePrice: 20, salePrice: 40, minStock: 5, ...extra });
  expect(res.status).toBe(201);
  return res.body.product as { id: string; commercialName: string };
}

function entry(token: string, body: Record<string, unknown>) {
  return request(app).post('/api/v1/inventory/entries').set(auth(token)).send(body);
}

async function stockOf(productId: string) {
  const res = await request(app).get(`/api/v1/inventory/products/${productId}`).set(auth(owner.token));
  return res.body as { batches: { id: string; lotNumber: string; quantity: number; status: string }[]; movements: unknown[] };
}

beforeAll(async () => {
  owner = await actorWithRole(app, 'OWNER');
  branchId = await mainBranchId();
  categoryId = (await prisma.category.create({ data: { name: `Inventario ${tag()}` } })).id;
});
afterAll(() => prisma.$disconnect());

describe('POST /inventory/entries', () => {
  it('crea el lote y su movimiento de carga inicial', async () => {
    const p = await newProduct();
    const res = await entry(owner.token, { productId: p.id, lotNumber: 'l-001a', expiresAt: inDays(200), quantity: 25, unitCost: 18.5 });
    expect(res.status).toBe(201);
    expect(res.body.createdBatch).toBe(true);
    expect(res.body.batch).toMatchObject({ lotNumber: 'L-001A', quantity: 25, initialQuantity: 25, unitCost: 18.5, sellable: true });

    const movement = await prisma.inventoryMovement.findFirst({ where: { batchId: res.body.batch.id } });
    expect(movement).toMatchObject({ type: 'INITIAL_STOCK', quantityBefore: 0, quantityChange: 25, quantityAfter: 25, userId: owner.id });
    expect(await prisma.auditLog.findFirst({ where: { entityId: res.body.batch.id, action: 'INVENTORY_ENTRY' } })).not.toBeNull();
  });

  it('suma al lote existente si coincide la caducidad y rechaza si no coincide', async () => {
    const p = await newProduct();
    const expiresAt = inDays(300);
    await entry(owner.token, { productId: p.id, lotNumber: 'A1', expiresAt, quantity: 10 }).expect(201);
    const again = await entry(owner.token, { productId: p.id, lotNumber: 'a1', expiresAt, quantity: 5 });
    expect(again.body).toMatchObject({ createdBatch: false, batch: { quantity: 15 } });

    const mismatch = await entry(owner.token, { productId: p.id, lotNumber: 'A1', expiresAt: inDays(301), quantity: 5 });
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error.details).toEqual([expect.objectContaining({ path: 'expiresAt' })]);
  });

  it('no permite registrar lotes ya caducados ni fechas inválidas', async () => {
    const p = await newProduct();
    expect((await entry(owner.token, { productId: p.id, lotNumber: 'X', expiresAt: inDays(-1), quantity: 1 })).status).toBe(422);
    expect((await entry(owner.token, { productId: p.id, lotNumber: 'X', expiresAt: '2026-02-30', quantity: 1 })).status).toBe(400);
    expect(
      (await entry(owner.token, { productId: p.id, lotNumber: 'X', expiresAt: inDays(10), manufacturedAt: inDays(20), quantity: 1 })).status,
    ).toBe(400);
    expect((await entry(owner.token, { productId: p.id, lotNumber: 'X', expiresAt: inDays(10), quantity: 0 })).status).toBe(400);
  });

  it('el almacenista registra entradas al último costo del producto (no ve costos)', async () => {
    const p = await newProduct({ purchasePrice: 33 });
    const warehouse = await actorWithRole(app, 'WAREHOUSE');
    const res = await entry(warehouse.token, { productId: p.id, lotNumber: 'W1', expiresAt: inDays(100), quantity: 4, unitCost: 1 });
    expect(res.status).toBe(201);
    expect(res.body.batch).not.toHaveProperty('unitCost');
    const batch = await prisma.productBatch.findUniqueOrThrow({ where: { id: res.body.batch.id } });
    expect(Number(batch.unitCost)).toBe(33);
  });

  it('un cajero no puede registrar entradas', async () => {
    const p = await newProduct();
    const cashier = await actorWithRole(app, 'CASHIER');
    expect((await entry(cashier.token, { productId: p.id, lotNumber: 'C1', expiresAt: inDays(100), quantity: 4 })).status).toBe(403);
  });
});

describe('POST /inventory/adjustments', () => {
  async function batchWith(quantity: number) {
    const p = await newProduct();
    const res = await entry(owner.token, { productId: p.id, lotNumber: `B${tag()}`, expiresAt: inDays(120), quantity });
    return { product: p, batchId: res.body.batch.id as string };
  }
  const adjust = (token: string, body: Record<string, unknown>) =>
    request(app).post('/api/v1/inventory/adjustments').set(auth(token)).send(body);

  it('descuenta con motivo, registra el movimiento y lo audita', async () => {
    const { batchId } = await batchWith(10);
    const res = await adjust(owner.token, { batchId, direction: 'OUT', quantity: 3, reason: 'DAMAGED', notes: 'Caja aplastada' });
    expect(res.status).toBe(201);
    expect(res.body.movement).toMatchObject({ type: 'DAMAGED', reason: 'DAMAGED', quantityBefore: 10, quantityChange: -3, quantityAfter: 7, notes: 'Caja aplastada' });
    const audit = await prisma.auditLog.findFirst({ where: { entityId: batchId, action: 'INVENTORY_ADJUST' } });
    expect(audit?.metadata).toMatchObject({ before: 10, change: -3, after: 7 });
  });

  it('robo/pérdida genera merma y un ajuste positivo suma', async () => {
    const { batchId } = await batchWith(10);
    const loss = await adjust(owner.token, { batchId, direction: 'OUT', quantity: 2, reason: 'THEFT_LOSS' });
    expect(loss.body.movement.type).toBe('SHRINKAGE');
    const gain = await adjust(owner.token, { batchId, direction: 'IN', quantity: 1, reason: 'INVENTORY_CORRECTION' });
    expect(gain.body.movement).toMatchObject({ type: 'ADJUSTMENT_IN', quantityBefore: 8, quantityAfter: 9 });
  });

  it('no permite dejar el lote en negativo y no deja rastro del intento', async () => {
    const { batchId } = await batchWith(4);
    const res = await adjust(owner.token, { batchId, direction: 'OUT', quantity: 5, reason: 'INVENTORY_CORRECTION' });
    expect(res.status).toBe(422);
    expect(res.body.error.details).toEqual({ available: 4, requested: 5 });
    expect(await prisma.inventoryMovement.count({ where: { batchId } })).toBe(1); // sólo la entrada
    expect((await prisma.productBatch.findUniqueOrThrow({ where: { id: batchId } })).quantity).toBe(4);
  });

  it('exige motivo válido para el sentido del ajuste y observaciones si es "Otro"', async () => {
    const { batchId } = await batchWith(5);
    expect((await adjust(owner.token, { batchId, direction: 'OUT', quantity: 1 })).status).toBe(400);
    expect((await adjust(owner.token, { batchId, direction: 'IN', quantity: 1, reason: 'DAMAGED' })).status).toBe(400);
    const other = await adjust(owner.token, { batchId, direction: 'OUT', quantity: 1, reason: 'OTHER' });
    expect(other.status).toBe(400);
    expect(other.body.error.details).toEqual([expect.objectContaining({ path: 'notes' })]);
  });

  it('al llegar a cero el lote queda agotado y vuelve a activo si entra mercancía', async () => {
    const { batchId } = await batchWith(2);
    await adjust(owner.token, { batchId, direction: 'OUT', quantity: 2, reason: 'INTERNAL_USE' }).expect(201);
    expect((await prisma.productBatch.findUniqueOrThrow({ where: { id: batchId } })).status).toBe('DEPLETED');
    await adjust(owner.token, { batchId, direction: 'IN', quantity: 1, reason: 'DATA_ENTRY_ERROR' }).expect(201);
    expect((await prisma.productBatch.findUniqueOrThrow({ where: { id: batchId } })).status).toBe('ACTIVE');
  });

  it('dos ajustes simultáneos no pueden retirar más de lo que hay', async () => {
    const { batchId } = await batchWith(10);
    const results = await Promise.all([
      adjust(owner.token, { batchId, direction: 'OUT', quantity: 6, reason: 'INVENTORY_CORRECTION' }),
      adjust(owner.token, { batchId, direction: 'OUT', quantity: 6, reason: 'INVENTORY_CORRECTION' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
    expect((await prisma.productBatch.findUniqueOrThrow({ where: { id: batchId } })).quantity).toBe(4);
  });

  it('un lote de otra sucursal no se puede ajustar', async () => {
    const other = await prisma.branch.create({ data: { code: `S${tag()}`.slice(0, 20), name: 'Sucursal Norte' } });
    const p = await newProduct();
    const batch = await prisma.productBatch.create({
      data: { productId: p.id, branchId: other.id, lotNumber: 'N1', expiresAt: new Date(`${inDays(90)}T00:00:00Z`), quantity: 5, initialQuantity: 5, unitCost: 10 },
    });
    const res = await adjust(owner.token, { batchId: batch.id, direction: 'OUT', quantity: 1, reason: 'DAMAGED' });
    expect(res.status).toBe(404);
  });

  it('un cajero no puede ajustar inventario', async () => {
    const { batchId } = await batchWith(5);
    const cashier = await actorWithRole(app, 'CASHIER');
    expect((await adjust(cashier.token, { batchId, direction: 'OUT', quantity: 1, reason: 'DAMAGED' })).status).toBe(403);
  });
});

describe('existencias', () => {
  it('la existencia disponible excluye lotes caducados y en cuarentena', async () => {
    const p = await newProduct({ minStock: 10, maxStock: 30 });
    await entry(owner.token, { productId: p.id, lotNumber: 'OK1', expiresAt: inDays(100), quantity: 8 }).expect(201);
    const base = { productId: p.id, branchId, initialQuantity: 5, unitCost: 20 };
    await prisma.productBatch.create({ data: { ...base, lotNumber: 'EXP', expiresAt: new Date(`${inDays(-3)}T00:00:00Z`), quantity: 5 } });
    await prisma.productBatch.create({ data: { ...base, lotNumber: 'QUA', expiresAt: new Date(`${inDays(50)}T00:00:00Z`), quantity: 4, status: 'QUARANTINE' } });

    const res = await request(app).get('/api/v1/inventory/stock').query({ q: p.commercialName }).set(auth(owner.token));
    expect(res.body.data[0]).toMatchObject({ available: 8, expired: 5, quarantine: 4, stockStatus: 'LOW', daysToExpiry: 100, expiryStatus: 'OK' });
    // Valor al costo: lotes activos + cuarentena (8 + 5 caducado + 4) × 20
    expect(res.body.data[0].value).toBe(340);

    const product = await request(app).get(`/api/v1/products/${p.id}`).set(auth(owner.token));
    expect(product.body.product).toMatchObject({ stock: 8, stockStatus: 'LOW' });
  });

  it('filtra por estado de existencia y oculta el valor a quien no ve costos', async () => {
    const t = tag();
    const out = await newProduct({ commercialName: `Agotado ${t}` });
    const over = await newProduct({ commercialName: `Exceso ${t}`, minStock: 1, maxStock: 5 });
    await entry(owner.token, { productId: over.id, lotNumber: 'E1', expiresAt: inDays(100), quantity: 9 }).expect(201);

    const outRes = await request(app).get('/api/v1/inventory/stock').query({ q: t, stockStatus: 'OUT' }).set(auth(owner.token));
    expect(outRes.body.data.map((r: { productId: string }) => r.productId)).toEqual([out.id]);
    const overRes = await request(app).get('/api/v1/inventory/stock').query({ q: t, stockStatus: 'OVER' }).set(auth(owner.token));
    expect(overRes.body.data.map((r: { productId: string }) => r.productId)).toEqual([over.id]);

    const warehouse = await actorWithRole(app, 'WAREHOUSE');
    const w = await request(app).get('/api/v1/inventory/stock').query({ q: t }).set(auth(warehouse.token));
    expect(w.status).toBe(200);
    expect(w.body.data[0]).not.toHaveProperty('value');
    expect(w.body.summary).not.toHaveProperty('inventoryValue');
  });

  it('el resumen cuenta agotados y stock bajo de la sucursal', async () => {
    const res = await request(app).get('/api/v1/inventory/stock').set(auth(owner.token));
    expect(res.body.summary).toMatchObject({
      activeProducts: expect.any(Number),
      outOfStock: expect.any(Number),
      lowStock: expect.any(Number),
      inventoryValue: expect.any(Number),
    });
  });

  it('exporta las existencias a CSV', async () => {
    const p = await newProduct({ commercialName: `=Fórmula ${tag()}` });
    await entry(owner.token, { productId: p.id, lotNumber: 'CSV1', expiresAt: inDays(60), quantity: 3 }).expect(201);
    const res = await request(app).get('/api/v1/inventory/stock/export').query({ q: p.commercialName.slice(1) }).set(auth(owner.token));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(/existencias_\d{4}-\d{2}-\d{2}\.csv/);
    expect(res.text).toContain(`'${p.commercialName}`);
  });
});

describe('lotes y movimientos', () => {
  it('lista lotes por estado de caducidad', async () => {
    const p = await newProduct();
    await entry(owner.token, { productId: p.id, lotNumber: 'CRIT', expiresAt: inDays(10), quantity: 2 }).expect(201);
    await entry(owner.token, { productId: p.id, lotNumber: 'WARN', expiresAt: inDays(60), quantity: 2 }).expect(201);
    await entry(owner.token, { productId: p.id, lotNumber: 'NORM', expiresAt: inDays(200), quantity: 2 }).expect(201);

    const lots = async (expiry: string) =>
      (await request(app).get('/api/v1/inventory/batches').query({ productId: p.id, expiry }).set(auth(owner.token))).body.data.map(
        (b: { lotNumber: string }) => b.lotNumber,
      );
    expect(await lots('CRITICAL')).toEqual(['CRIT']);
    expect(await lots('WARNING')).toEqual(['WARN']);
    expect(await lots('OK')).toEqual(['NORM']);

    const byLot = await request(app).get('/api/v1/inventory/batches').query({ q: 'warn', productId: p.id }).set(auth(owner.token));
    expect(byLot.body.data).toHaveLength(1);
  });

  it('historial de movimientos con filtros; el cajero no tiene acceso', async () => {
    const p = await newProduct();
    const e = await entry(owner.token, { productId: p.id, lotNumber: 'MV1', expiresAt: inDays(90), quantity: 10 });
    await request(app)
      .post('/api/v1/inventory/adjustments')
      .set(auth(owner.token))
      .send({ batchId: e.body.batch.id, direction: 'OUT', quantity: 1, reason: 'EXPIRED' })
      .expect(201);

    const all = await request(app).get('/api/v1/inventory/movements').query({ productId: p.id }).set(auth(owner.token));
    expect(all.body.data.map((m: { type: string }) => m.type)).toEqual(['EXPIRED', 'INITIAL_STOCK']);
    expect(all.body.data[0].user.fullName).toBe('Usuario Prueba');

    const byType = await request(app).get('/api/v1/inventory/movements').query({ productId: p.id, type: 'EXPIRED' }).set(auth(owner.token));
    expect(byType.body.data).toHaveLength(1);
    const today = todayISO();
    const byDate = await request(app).get('/api/v1/inventory/movements').query({ productId: p.id, from: today, to: today }).set(auth(owner.token));
    expect(byDate.body.data).toHaveLength(2);
    const yesterday = inDays(-1);
    const before = await request(app).get('/api/v1/inventory/movements').query({ productId: p.id, to: yesterday }).set(auth(owner.token));
    expect(before.body.data).toHaveLength(0);

    const csv = await request(app).get('/api/v1/inventory/movements/export').query({ productId: p.id }).set(auth(owner.token));
    expect(csv.text).toContain('Baja por caducidad');

    const cashier = await actorWithRole(app, 'CASHIER');
    expect((await request(app).get('/api/v1/inventory/movements').set(auth(cashier.token))).status).toBe(403);
    expect((await request(app).get('/api/v1/inventory/stock').set(auth(cashier.token))).status).toBe(200);
  });
});

describe('FEFO', () => {
  it('surte primero el lote que caduca antes y no usa caducados ni cuarentena', async () => {
    const p = await newProduct();
    await entry(owner.token, { productId: p.id, lotNumber: 'LATE', expiresAt: inDays(300), quantity: 10 }).expect(201);
    await entry(owner.token, { productId: p.id, lotNumber: 'SOON', expiresAt: inDays(15), quantity: 5 }).expect(201);
    const base = { productId: p.id, branchId, initialQuantity: 9, quantity: 9, unitCost: 20 };
    await prisma.productBatch.create({ data: { ...base, lotNumber: 'OLD', expiresAt: new Date(`${inDays(-5)}T00:00:00Z`) } });
    await prisma.productBatch.create({ data: { ...base, lotNumber: 'QUAR', expiresAt: new Date(`${inDays(5)}T00:00:00Z`), status: 'QUARANTINE' } });

    const allocation = await prisma.$transaction((tx) => allocateFefo(tx, { branchId, productId: p.id, quantity: 12, today: todayISO() }));
    expect(allocation.map((a) => [a.lotNumber, a.quantity])).toEqual([
      ['SOON', 5],
      ['LATE', 7],
    ]);

    await expect(
      prisma.$transaction((tx) => allocateFefo(tx, { branchId, productId: p.id, quantity: 16, today: todayISO() })),
    ).rejects.toMatchObject({ code: 'BUSINESS_RULE', details: { available: 15, requested: 16 } });
  });
});
