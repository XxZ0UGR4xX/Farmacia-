import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { todayISO } from '../../src/lib/dates';
import { prisma } from '../../src/lib/prisma';
import { actorWithRole, mainBranchId, type TestUser } from '../helpers';

const app = createApp({ rateLimitEnabled: false });
let owner: TestUser & { token: string };
let cashier: TestUser & { token: string };
let pharmacist: TestUser & { token: string };
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
    .send({ commercialName: `Venta ${tag()}`, categoryId, presentation: 'BOX', purchasePrice: 10, salePrice: 25, taxRate: 0, minStock: 1, ...extra });
  expect(res.status).toBe(201);
  return res.body.product as { id: string; commercialName: string };
}

async function stock(productId: string, lotNumber: string, quantity: number, expiresInDays: number, unitCost = 10) {
  const res = await request(app)
    .post('/api/v1/inventory/entries')
    .set(auth(owner.token))
    .send({ productId, lotNumber, expiresAt: inDays(expiresInDays), quantity, unitCost });
  expect(res.status).toBe(201);
  return res.body.batch.id as string;
}

function sell(token: string, body: Record<string, unknown>) {
  return request(app).post('/api/v1/sales').set(auth(token)).send(body);
}

const cash = (amount: number, received = amount) => [{ method: 'CASH', amount, received }];

async function batchQty(batchId: string) {
  return (await prisma.productBatch.findUniqueOrThrow({ where: { id: batchId } })).quantity;
}

beforeAll(async () => {
  owner = await actorWithRole(app, 'OWNER');
  cashier = await actorWithRole(app, 'CASHIER');
  pharmacist = await actorWithRole(app, 'PHARMACIST');
  branchId = await mainBranchId();
  categoryId = (await prisma.category.create({ data: { name: `Ventas ${tag()}` } })).id;
});
afterAll(() => prisma.$disconnect());

describe('POST /sales: cobro', () => {
  it('surte con FEFO, desglosa el IVA, calcula el cambio y registra los movimientos', async () => {
    const p = await newProduct({ salePrice: 23.2, taxRate: 0.16 });
    const soon = await stock(p.id, 'A-PRONTO', 3, 20, 8);
    const later = await stock(p.id, 'B-DESPUES', 10, 200, 12);

    const res = await sell(cashier.token, { items: [{ productId: p.id, quantity: 5 }], payments: cash(116, 200) });
    expect(res.status).toBe(201);
    const sale = res.body.sale;
    // 5 × 23.20 = 116.00 con IVA incluido → base 100, IVA 16
    expect(sale).toMatchObject({ status: 'COMPLETED', total: 116, subtotal: 100, taxTotal: 16, discountTotal: 0 });
    expect(sale.folio).toMatch(/^V-\d{6}$/);
    expect(sale.payments).toEqual([expect.objectContaining({ method: 'CASH', amount: 116, received: 200, change: 84 })]);
    // El cajero no ve costos
    expect(sale.costTotal).toBeUndefined();
    expect(sale.items[0].batches).toEqual([
      expect.objectContaining({ lotNumber: 'A-PRONTO', quantity: 3 }),
      expect.objectContaining({ lotNumber: 'B-DESPUES', quantity: 2 }),
    ]);
    expect(await batchQty(soon)).toBe(0);
    expect(await batchQty(later)).toBe(8);

    const movements = await prisma.inventoryMovement.findMany({ where: { referenceId: sale.id }, orderBy: { createdAt: 'asc' } });
    expect(movements.map((m) => [m.type, m.quantityChange])).toEqual([
      ['SALE', -3],
      ['SALE', -2],
    ]);
    const stored = await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect(Number(stored.costTotal)).toBe(3 * 8 + 2 * 12);
    expect(await prisma.auditLog.findFirst({ where: { action: 'SALE_CREATE', entityId: sale.id } })).not.toBeNull();

    const asOwner = await request(app).get(`/api/v1/sales/${sale.id}`).set(auth(owner.token));
    expect(asOwner.body.sale).toMatchObject({ costTotal: 48, profit: 52 });
    expect(asOwner.body.sale.header).toHaveProperty('name');
  });

  it('no vende lotes caducados y si no alcanza no registra nada', async () => {
    const p = await newProduct();
    await prisma.productBatch.create({
      data: { productId: p.id, branchId, lotNumber: 'VIEJO', expiresAt: new Date(`${inDays(-3)}T00:00:00Z`), quantity: 5, initialQuantity: 5, unitCost: 10 },
    });
    const fresh = await stock(p.id, 'NUEVO', 2, 100);
    const salesBefore = await prisma.sale.count();

    const res = await sell(cashier.token, { items: [{ productId: p.id, quantity: 3 }], payments: cash(75) });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/sólo hay 2 unidad/);
    expect(res.body.error.details).toEqual([expect.objectContaining({ path: 'items.0.quantity' })]);
    expect(await batchQty(fresh)).toBe(2);
    expect(await prisma.sale.count()).toBe(salesBefore);
  });

  it('el precio lo pone el servidor y un total distinto al que vio el cajero se rechaza', async () => {
    const p = await newProduct({ salePrice: 30 });
    await stock(p.id, 'L1', 10, 300);
    const res = await sell(cashier.token, { items: [{ productId: p.id, quantity: 1, unitPrice: 1 }], payments: cash(30) });
    expect(res.status).toBe(201);
    expect(res.body.sale.total).toBe(30);

    const changed = await sell(cashier.token, { items: [{ productId: p.id, quantity: 1 }], expectedTotal: 25, payments: cash(30) });
    expect(changed.status).toBe(409);
    expect(changed.body.error.details).toMatchObject({ expectedTotal: 25, total: 30 });
  });

  it('valida los pagos: deben cubrir el total exacto y sólo el efectivo da cambio', async () => {
    const p = await newProduct({ salePrice: 50 });
    await stock(p.id, 'L1', 10, 300);
    const items = [{ productId: p.id, quantity: 2 }];
    expect((await sell(cashier.token, { items, payments: cash(90) })).status).toBe(400);
    expect((await sell(cashier.token, { items, payments: cash(100, 80) })).status).toBe(400);
    expect((await sell(cashier.token, { items, payments: [{ method: 'CARD', amount: 100, received: 200 }] })).status).toBe(400);
    expect((await sell(cashier.token, { items, payments: [...cash(50), ...cash(50)] })).status).toBe(400);
    const mixed = await sell(cashier.token, { items, payments: [{ method: 'CARD', amount: 60, reference: '1234' }, { method: 'CASH', amount: 40, received: 50 }] });
    expect(mixed.status).toBe(201);
    expect(mixed.body.sale.payments).toEqual([
      expect.objectContaining({ method: 'CARD', amount: 60, change: null }),
      expect.objectContaining({ method: 'CASH', amount: 40, change: 10 }),
    ]);
  });

  it('descuentos sólo con permiso y nunca mayores al importe', async () => {
    const p = await newProduct({ salePrice: 40 });
    await stock(p.id, 'L1', 10, 300);
    const body = (discount: number, total: number) => ({ items: [{ productId: p.id, quantity: 1, discount }], payments: cash(total) });
    expect((await sell(cashier.token, body(5, 35))).status).toBe(403);
    expect((await sell(pharmacist.token, body(50, 0.01))).status).toBe(400);
    const ok = await sell(pharmacist.token, body(5, 35));
    expect(ok.status).toBe(201);
    expect(ok.body.sale).toMatchObject({ total: 35, discountTotal: 5 });
  });

  it('un producto con receta exige confirmar que se revisó', async () => {
    const p = await newProduct({ requiresPrescription: true });
    await stock(p.id, 'L1', 10, 300);
    const body = { items: [{ productId: p.id, quantity: 1 }], payments: cash(25) };
    const res = await sell(cashier.token, body);
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/requiere receta/);
    const ok = await sell(cashier.token, { ...body, prescriptionChecked: true });
    expect(ok.status).toBe(201);
    expect(ok.body.sale.prescriptionChecked).toBe(true);
  });

  it('no vende productos inactivos ni repetidos en dos partidas', async () => {
    const p = await newProduct({ status: 'INACTIVE' });
    await stock(p.id, 'L1', 10, 300);
    expect((await sell(cashier.token, { items: [{ productId: p.id, quantity: 1 }], payments: cash(25) })).status).toBe(422);
    const q = await newProduct();
    const dup = await sell(cashier.token, { items: [{ productId: q.id, quantity: 1 }, { productId: q.id, quantity: 1 }], payments: cash(50) });
    expect(dup.status).toBe(400);
  });
});

describe('POST /sales: cobros simultáneos y reintentos', () => {
  it('reintentar el mismo cobro no vende dos veces', async () => {
    const p = await newProduct();
    const batch = await stock(p.id, 'L1', 10, 300);
    const body = { clientRequestId: randomUUID(), items: [{ productId: p.id, quantity: 2 }], payments: cash(50) };
    const [a, b] = await Promise.all([sell(cashier.token, body), sell(cashier.token, body)]);
    const again = await sell(cashier.token, body);
    expect([a.status, b.status, again.status].every((s) => s === 201)).toBe(true);
    expect(new Set([a.body.sale.id, b.body.sale.id, again.body.sale.id]).size).toBe(1);
    expect(await batchQty(batch)).toBe(8);
  });

  it('dos ventas al mismo tiempo no venden más de lo que hay', async () => {
    const p = await newProduct();
    const batch = await stock(p.id, 'L1', 10, 300);
    const body = { items: [{ productId: p.id, quantity: 6 }], payments: cash(150) };
    const results = await Promise.all([sell(cashier.token, body), sell(owner.token, body)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
    expect(await batchQty(batch)).toBe(4);
  });
});

describe('Cancelación y devoluciones', () => {
  async function saleOf(qty: number, extra: Record<string, unknown> = {}) {
    const p = await newProduct({ salePrice: 20, ...extra });
    const a = await stock(p.id, `A${tag()}`, 2, 30);
    const b = await stock(p.id, `B${tag()}`, 10, 300);
    const res = await sell(owner.token, { items: [{ productId: p.id, quantity: qty }], payments: cash(qty * 20) });
    expect(res.status).toBe(201);
    return { sale: res.body.sale, product: p, a, b };
  }

  it('cancelar regresa las unidades a los mismos lotes', async () => {
    const { sale, a, b } = await saleOf(4);
    expect([await batchQty(a), await batchQty(b)]).toEqual([0, 8]);
    await request(app).post(`/api/v1/sales/${sale.id}/cancel`).set(auth(cashier.token)).send({ reason: 'Error de cobro' }).expect(403);
    const res = await request(app).post(`/api/v1/sales/${sale.id}/cancel`).set(auth(owner.token)).send({ reason: 'Error de cobro' });
    expect(res.body.sale).toMatchObject({ status: 'CANCELLED', cancelReason: 'Error de cobro' });
    expect([await batchQty(a), await batchQty(b)]).toEqual([2, 10]);
    const back = await prisma.inventoryMovement.count({ where: { referenceId: sale.id, type: 'SALE_CANCELLATION' } });
    expect(back).toBe(2);
    await request(app).post(`/api/v1/sales/${sale.id}/cancel`).set(auth(owner.token)).send({ reason: 'Otra vez' }).expect(422);
  });

  it('una devolución queda en revisión, reembolsa lo proporcional y la revisión decide', async () => {
    const { sale, a, b } = await saleOf(4);
    const itemId = sale.items[0].id;
    await request(app)
      .post(`/api/v1/sales/${sale.id}/returns`)
      .set(auth(cashier.token))
      .send({ reason: 'No lo necesitó', refundMethod: 'CASH', items: [{ saleItemId: itemId, quantity: 1 }] })
      .expect(403);

    const res = await request(app)
      .post(`/api/v1/sales/${sale.id}/returns`)
      .set(auth(pharmacist.token))
      .send({ reason: 'No lo necesitó', refundMethod: 'CASH', items: [{ saleItemId: itemId, quantity: 3 }] });
    expect(res.status).toBe(201);
    expect(res.body.sale).toMatchObject({ status: 'PARTIALLY_RETURNED', refunded: 60 });
    expect(res.body.sale.items[0].returnedQty).toBe(3);
    // En revisión: no vuelve al inventario todavía
    expect([await batchQty(a), await batchQty(b)]).toEqual([0, 8]);

    const tooMany = await request(app)
      .post(`/api/v1/sales/${sale.id}/returns`)
      .set(auth(pharmacist.token))
      .send({ reason: 'Otra', refundMethod: 'CASH', items: [{ saleItemId: itemId, quantity: 2 }] });
    expect(tooMany.status).toBe(422);

    const pending = await request(app).get('/api/v1/returns?pending=true').set(auth(pharmacist.token));
    const ret = pending.body.data.find((r: { sale: { id: string } }) => r.sale.id === sale.id);
    // Se devolvió del último lote usado (B: 2 de los 2 que salieron) y luego de A
    expect(ret.items.map((i: { lotNumber: string; quantity: number }) => i.quantity).sort()).toEqual([1, 2]);
    expect(pending.body.summary.pendingItems).toBeGreaterThanOrEqual(2);

    const fromB = ret.items.find((i: { lotNumber: string }) => i.lotNumber.startsWith('B'));
    const fromA = ret.items.find((i: { lotNumber: string }) => i.lotNumber.startsWith('A'));
    const review = (id: string, decision: string) =>
      request(app).post(`/api/v1/returns/${ret.id}/items/${id}/review`).set(auth(pharmacist.token)).send({ decision, notes: 'Empaque íntegro' });
    await request(app).post(`/api/v1/returns/${ret.id}/items/${fromB.id}/review`).set(auth(cashier.token)).send({ decision: 'RESTOCK' }).expect(403);
    await review(fromB.id, 'RESTOCK').expect(204);
    expect(await batchQty(b)).toBe(10);
    await review(fromB.id, 'RESTOCK').expect(422);
    await review(fromA.id, 'DISCARD').expect(204);
    expect(await batchQty(a)).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'RETURN_REVIEW', entityId: ret.id } })).toBe(2);

    // Ya con devoluciones no se puede cancelar
    await request(app).post(`/api/v1/sales/${sale.id}/cancel`).set(auth(owner.token)).send({ reason: 'Ya no' }).expect(422);
  });

  it('regresar directo al inventario: sólo con permiso y nunca a un lote caducado', async () => {
    const { sale, b } = await saleOf(1);
    const itemId = sale.items[0].id;
    const ok = await request(app)
      .post(`/api/v1/sales/${sale.id}/returns`)
      .set(auth(pharmacist.token))
      .send({ reason: 'Equivocación', refundMethod: 'CARD', items: [{ saleItemId: itemId, quantity: 1, disposition: 'RESTOCKED' }] });
    expect(ok.status).toBe(201);
    expect(ok.body.sale.status).toBe('RETURNED');

    const other = await saleOf(1);
    await prisma.productBatch.update({ where: { id: other.a }, data: { expiresAt: new Date(`${inDays(-1)}T00:00:00Z`) } });
    const expired = await request(app)
      .post(`/api/v1/sales/${other.sale.id}/returns`)
      .set(auth(pharmacist.token))
      .send({ reason: 'Equivocación', refundMethod: 'CASH', items: [{ saleItemId: other.sale.items[0].id, quantity: 1, disposition: 'RESTOCKED' }] });
    expect(expired.status).toBe(422);
    expect(b).toBeTruthy();
  });

  it('el reembolso total de una partida es exactamente lo cobrado', async () => {
    const p = await newProduct({ salePrice: 10 });
    await stock(p.id, 'L1', 10, 300);
    // 3 × 10 − 1 de descuento = 29: no se divide exacto entre 3
    const res = await sell(owner.token, { items: [{ productId: p.id, quantity: 3, discount: 1 }], payments: cash(29) });
    const itemId = res.body.sale.items[0].id;
    const ret = (quantity: number) =>
      request(app).post(`/api/v1/sales/${res.body.sale.id}/returns`).set(auth(owner.token)).send({ reason: 'Prueba', refundMethod: 'CASH', items: [{ saleItemId: itemId, quantity }] });
    await ret(1).expect(201);
    await ret(1).expect(201);
    const last = await ret(1);
    expect(last.body.sale.refunded).toBe(29);
  });
});

describe('GET /sales: historial y corte', () => {
  it('el cajero ve sólo sus ventas pero puede buscar cualquier folio', async () => {
    const p = await newProduct({ salePrice: 15 });
    await stock(p.id, 'L1', 50, 300);
    const other = await actorWithRole(app, 'CASHIER');
    const mine = await sell(cashier.token, { items: [{ productId: p.id, quantity: 1 }], payments: [{ method: 'CARD', amount: 15 }] });
    const theirs = await sell(other.token, { items: [{ productId: p.id, quantity: 2 }], payments: cash(30) });

    const list = await request(app).get('/api/v1/sales').query({ from: todayISO(), to: todayISO(), pageSize: 100 }).set(auth(cashier.token));
    expect(list.body.scope).toBe('own');
    const ids = list.body.data.map((s: { id: string }) => s.id);
    expect(ids).toContain(mine.body.sale.id);
    expect(ids).not.toContain(theirs.body.sale.id);
    expect(list.body.summary.byMethod.CARD).toBeGreaterThanOrEqual(15);

    const byFolio = await request(app).get('/api/v1/sales').query({ q: theirs.body.sale.folio }).set(auth(cashier.token));
    expect(byFolio.body.data.map((s: { id: string }) => s.id)).toEqual([theirs.body.sale.id]);

    const ownerList = await request(app).get('/api/v1/sales').query({ from: todayISO(), to: todayISO(), pageSize: 100 }).set(auth(owner.token));
    expect(ownerList.body.scope).toBe('branch');
    expect(ownerList.body.data.map((s: { id: string }) => s.id)).toEqual(expect.arrayContaining([mine.body.sale.id, theirs.body.sale.id]));
  });

  it('una venta de otra sucursal no se puede consultar ni cancelar', async () => {
    const other = await prisma.branch.create({ data: { code: `S${tag()}`.slice(0, 20), name: 'Sucursal Oriente' } });
    const sale = await prisma.sale.create({ data: { branchId: other.id, subtotal: 10, total: 10, costTotal: 5, createdById: owner.id } });
    await request(app).get(`/api/v1/sales/${sale.id}`).set(auth(owner.token)).expect(404);
    await request(app).post(`/api/v1/sales/${sale.id}/cancel`).set(auth(owner.token)).send({ reason: 'No es mía' }).expect(404);
  });
});
