import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { todayISO } from '../../src/lib/dates';
import { prisma } from '../../src/lib/prisma';
import { actorWithRole, createTestUser, loginAs, mainBranchId, type TestUser } from '../helpers';

const app = createApp({ rateLimitEnabled: false });
let owner: TestUser & { token: string };
let branchId: string;
let categoryId: string;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const tag = () => randomUUID().slice(0, 8).toUpperCase();
// RFC de persona física aleatorio (la base de pruebas conserva datos entre corridas)
const randomRfc = () => {
  const letters = Array.from({ length: 4 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');
  const digits = String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
  return `${letters}${digits}${tag().slice(0, 3)}`;
};

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

async function newSupplier(extra: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/v1/suppliers')
    .set(auth(owner.token))
    .send({ tradeName: `Distribuidora ${tag()}`, creditDays: 30, ...extra });
  expect(res.status).toBe(201);
  return res.body.supplier as { id: string; tradeName: string };
}

function createPurchase(token: string, body: Record<string, unknown>) {
  return request(app).post('/api/v1/purchases').set(auth(token)).send(body);
}

function line(productId: string, extra: Record<string, unknown> = {}) {
  return { productId, lotNumber: `L${tag()}`, expiresAt: inDays(400), quantity: 10, unitCost: 15, ...extra };
}

async function batchesOf(productId: string) {
  return prisma.productBatch.findMany({ where: { productId, branchId }, orderBy: { receivedAt: 'asc' } });
}

beforeAll(async () => {
  owner = await actorWithRole(app, 'OWNER');
  branchId = await mainBranchId();
  categoryId = (await prisma.category.create({ data: { name: `Compras ${tag()}` } })).id;
});
afterAll(() => prisma.$disconnect());

describe('Proveedores', () => {
  it('alta con validación de RFC, nombre y RFC únicos', async () => {
    const name = `Farmacéutica ${tag()}`;
    const rfc = randomRfc();
    const ok = await request(app).post('/api/v1/suppliers').set(auth(owner.token)).send({ tradeName: name, rfc: rfc.toLowerCase(), email: 'VENTAS@Ejemplo.com' });
    expect(ok.status).toBe(201);
    expect(ok.body.supplier).toMatchObject({ rfc, email: 'ventas@ejemplo.com', isActive: true, creditDays: 0 });

    const dupName = await request(app).post('/api/v1/suppliers').set(auth(owner.token)).send({ tradeName: name.toUpperCase() });
    expect(dupName.status).toBe(409);
    const dupRfc = await request(app).post('/api/v1/suppliers').set(auth(owner.token)).send({ tradeName: `Otro ${tag()}`, rfc });
    expect(dupRfc.status).toBe(409);
    expect(dupRfc.body.error.details).toEqual([expect.objectContaining({ path: 'rfc' })]);
    const badRfc = await request(app).post('/api/v1/suppliers').set(auth(owner.token)).send({ tradeName: `Otro ${tag()}`, rfc: '123' });
    expect(badRfc.status).toBe(400);

    expect(await prisma.auditLog.findFirst({ where: { action: 'SUPPLIER_CREATE', entityId: ok.body.supplier.id } })).not.toBeNull();
  });

  it('edita, desactiva y un proveedor inactivo no admite compras', async () => {
    const s = await newSupplier();
    const edited = await request(app).patch(`/api/v1/suppliers/${s.id}`).set(auth(owner.token)).send({ contactName: 'Ana López', creditDays: 15 });
    expect(edited.body.supplier).toMatchObject({ contactName: 'Ana López', creditDays: 15 });
    await request(app).patch(`/api/v1/suppliers/${s.id}/status`).set(auth(owner.token)).send({ isActive: false }).expect(200);

    const p = await newProduct();
    const res = await createPurchase(owner.token, { supplierId: s.id, purchaseDate: todayISO(), paymentMethod: 'CASH', items: [line(p.id)] });
    expect(res.status).toBe(422);

    const list = await request(app).get('/api/v1/suppliers?status=inactive').set(auth(owner.token));
    expect(list.body.data.map((x: { id: string }) => x.id)).toContain(s.id);
    const options = await request(app).get('/api/v1/suppliers/options').set(auth(owner.token));
    expect(options.body.items.map((x: { id: string }) => x.id)).not.toContain(s.id);
  });

  it('permisos: el almacenista administra, el farmacéutico consulta y el cajero no entra', async () => {
    const warehouse = await actorWithRole(app, 'WAREHOUSE');
    const pharmacist = await actorWithRole(app, 'PHARMACIST');
    const cashier = await actorWithRole(app, 'CASHIER');
    await request(app).post('/api/v1/suppliers').set(auth(warehouse.token)).send({ tradeName: `Almacén ${tag()}` }).expect(201);
    await request(app).get('/api/v1/suppliers').set(auth(pharmacist.token)).expect(200);
    await request(app).post('/api/v1/suppliers').set(auth(pharmacist.token)).send({ tradeName: `X ${tag()}` }).expect(403);
    await request(app).get('/api/v1/suppliers').set(auth(cashier.token)).expect(403);
  });
});

describe('Compras: alta y recepción', () => {
  it('de contado y recibida: crea lotes, actualiza el costo y queda pagada', async () => {
    const s = await newSupplier();
    const p1 = await newProduct({ taxRate: 0 });
    const p2 = await newProduct({ taxRate: 0.16 });
    const res = await createPurchase(owner.token, {
      supplierId: s.id,
      invoiceNumber: 'fac-1001',
      purchaseDate: todayISO(),
      paymentMethod: 'TRANSFER',
      receive: true,
      // Los totales del cliente se ignoran
      total: 1,
      items: [line(p1.id, { quantity: 10, unitCost: 12.5, discount: 5 }), line(p2.id, { quantity: 4, unitCost: 100 })],
    });
    expect(res.status).toBe(201);
    const purchase = res.body.purchase;
    // p1: 125 - 5 = 120 sin IVA; p2: 400 + 64 IVA
    expect(purchase).toMatchObject({
      status: 'RECEIVED',
      invoiceNumber: 'FAC-1001',
      subtotal: 525,
      discountTotal: 5,
      taxTotal: 64,
      total: 584,
      paymentStatus: 'PAID',
      amountPaid: 584,
      balance: 0,
    });
    expect(purchase.folio).toMatch(/^C-\d{6}$/);
    expect(purchase.payments).toHaveLength(1);

    const [batch1] = await batchesOf(p1.id);
    expect(batch1).toMatchObject({ quantity: 10, supplierId: s.id });
    expect(Number(batch1!.unitCost)).toBe(12); // costo neto con descuento
    const movement = await prisma.inventoryMovement.findFirst({ where: { batchId: batch1!.id } });
    expect(movement).toMatchObject({ type: 'PURCHASE_ENTRY', quantityChange: 10, referenceType: 'PURCHASE', referenceId: purchase.id });
    const product = await prisma.product.findUniqueOrThrow({ where: { id: p1.id } });
    expect(Number(product.purchasePrice)).toBe(12);

    const audit = await prisma.auditLog.findFirst({ where: { action: 'PURCHASE_RECEIVE', entityId: purchase.id } });
    expect(audit?.metadata).toMatchObject({ paidOnReceive: true, costChanges: expect.arrayContaining([{ product: p1.commercialName, from: 20, to: 12 }]) });
  });

  it('un pedido sin lotes no se puede recibir hasta completarlo', async () => {
    const s = await newSupplier();
    const p = await newProduct();
    const order = await createPurchase(owner.token, {
      supplierId: s.id,
      purchaseDate: todayISO(),
      paymentMethod: 'CASH',
      items: [{ productId: p.id, quantity: 6, unitCost: 10 }],
    });
    expect(order.status).toBe(201);
    expect(order.body.purchase).toMatchObject({ status: 'ORDERED', paymentStatus: 'PENDING' });
    const id = order.body.purchase.id;

    const premature = await request(app).post(`/api/v1/purchases/${id}/receive`).set(auth(owner.token));
    expect(premature.status).toBe(400);
    expect(premature.body.error.details).toEqual([{ path: 'items.0.lotNumber', message: expect.any(String) }]);
    expect(await batchesOf(p.id)).toHaveLength(0);

    const edited = await request(app)
      .put(`/api/v1/purchases/${id}`)
      .set(auth(owner.token))
      .send({ supplierId: s.id, purchaseDate: todayISO(), paymentMethod: 'CASH', items: [line(p.id, { quantity: 6, unitCost: 10 })] });
    expect(edited.status).toBe(200);

    const received = await request(app).post(`/api/v1/purchases/${id}/receive`).set(auth(owner.token));
    expect(received.status).toBe(200);
    expect(received.body.purchase).toMatchObject({ status: 'RECEIVED', paymentStatus: 'PAID' });
    expect(received.body.purchase.items[0].batchId).toBeTruthy();

    const twice = await request(app).post(`/api/v1/purchases/${id}/receive`).set(auth(owner.token));
    expect(twice.status).toBe(422);
    const edit = await request(app)
      .put(`/api/v1/purchases/${id}`)
      .set(auth(owner.token))
      .send({ supplierId: s.id, purchaseDate: todayISO(), paymentMethod: 'CASH', items: [line(p.id)] });
    expect(edit.status).toBe(422);
  });

  it('si una partida falla no se ingresa nada (todo o nada)', async () => {
    const s = await newSupplier();
    const p1 = await newProduct();
    const p2 = await newProduct();
    const existingLot = 'MISMO-LOTE';
    await createPurchase(owner.token, {
      supplierId: s.id,
      purchaseDate: todayISO(),
      paymentMethod: 'CASH',
      receive: true,
      items: [line(p2.id, { lotNumber: existingLot, expiresAt: inDays(300) })],
    }).expect(201);
    const purchasesBefore = await prisma.purchase.count({ where: { supplierId: s.id } });

    const res = await createPurchase(owner.token, {
      supplierId: s.id,
      purchaseDate: todayISO(),
      paymentMethod: 'CASH',
      receive: true,
      // La segunda partida trae el mismo lote con otra caducidad
      items: [line(p1.id), line(p2.id, { lotNumber: existingLot, expiresAt: inDays(301) })],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/^Partida 2:/);
    expect(res.body.error.details).toEqual([expect.objectContaining({ path: 'items.1.expiresAt' })]);
    expect(await batchesOf(p1.id)).toHaveLength(0);
    expect(await prisma.purchase.count({ where: { supplierId: s.id } })).toBe(purchasesBefore);
  });

  it('rechaza lotes caducados, fechas futuras, lotes repetidos y facturas duplicadas', async () => {
    const s = await newSupplier();
    const p = await newProduct();
    const base = { supplierId: s.id, purchaseDate: todayISO(), paymentMethod: 'CASH', receive: true };

    const expired = await createPurchase(owner.token, { ...base, items: [line(p.id, { expiresAt: inDays(-1) })] });
    expect(expired.status).toBe(422);
    expect(expired.body.error.details).toEqual([expect.objectContaining({ path: 'items.0.expiresAt' })]);

    const future = await createPurchase(owner.token, { ...base, purchaseDate: inDays(1), items: [line(p.id)] });
    expect(future.status).toBe(400);

    const repeated = await createPurchase(owner.token, { ...base, items: [line(p.id, { lotNumber: 'R1' }), line(p.id, { lotNumber: 'r1' })] });
    expect(repeated.status).toBe(400);
    expect(repeated.body.error.details).toEqual([expect.objectContaining({ path: 'items.1.lotNumber' })]);

    const tooMuchDiscount = await createPurchase(owner.token, { ...base, items: [line(p.id, { quantity: 1, unitCost: 10, discount: 11 })] });
    expect(tooMuchDiscount.status).toBe(400);

    await createPurchase(owner.token, { ...base, invoiceNumber: 'F-77', items: [line(p.id)] }).expect(201);
    const dup = await createPurchase(owner.token, { ...base, invoiceNumber: 'f-77', items: [line(p.id)] });
    expect(dup.status).toBe(409);
    expect(dup.body.error.details).toEqual([expect.objectContaining({ path: 'invoiceNumber' })]);
    // La misma factura de otro proveedor sí se acepta
    const other = await newSupplier();
    await createPurchase(owner.token, { ...base, supplierId: other.id, invoiceNumber: 'F-77', items: [line(p.id)] }).expect(201);
  });

  it('dos recepciones simultáneas de la misma compra ingresan la mercancía una sola vez', async () => {
    const s = await newSupplier();
    const p = await newProduct();
    const order = await createPurchase(owner.token, { supplierId: s.id, purchaseDate: todayISO(), paymentMethod: 'CREDIT', items: [line(p.id, { quantity: 7 })] });
    const id = order.body.purchase.id;
    const results = await Promise.all([
      request(app).post(`/api/v1/purchases/${id}/receive`).set(auth(owner.token)),
      request(app).post(`/api/v1/purchases/${id}/receive`).set(auth(owner.token)),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 422]);
    const batches = await batchesOf(p.id);
    expect(batches.reduce((sum, b) => sum + b.quantity, 0)).toBe(7);
  });
});

describe('Compras: crédito y pagos', () => {
  it('a crédito vence según el proveedor; pagos parciales y sin exceder el saldo', async () => {
    const s = await newSupplier({ creditDays: 30 });
    const p = await newProduct({ taxRate: 0 });
    const res = await createPurchase(owner.token, {
      supplierId: s.id,
      purchaseDate: inDays(-40),
      paymentMethod: 'CREDIT',
      receive: true,
      items: [line(p.id, { quantity: 10, unitCost: 30 })],
    });
    expect(res.body.purchase).toMatchObject({ total: 300, paymentStatus: 'PENDING', paymentDueDate: inDays(-10), overdue: true });
    const id = res.body.purchase.id;

    const overdue = await request(app).get('/api/v1/purchases?overdue=true').set(auth(owner.token));
    expect(overdue.body.data.map((x: { id: string }) => x.id)).toContain(id);
    expect(overdue.body.summary.overdueCount).toBeGreaterThanOrEqual(1);

    const pay = (amount: number) =>
      request(app).post(`/api/v1/purchases/${id}/payments`).set(auth(owner.token)).send({ amount, method: 'TRANSFER', reference: 'SPEI 123' });
    expect((await pay(100)).body.purchase).toMatchObject({ paymentStatus: 'PARTIAL', amountPaid: 100, balance: 200 });
    const over = await pay(250);
    expect(over.status).toBe(422);
    expect((await pay(200)).body.purchase).toMatchObject({ paymentStatus: 'PAID', balance: 0, overdue: false });
    expect((await pay(1)).status).toBe(422);
    expect(await prisma.auditLog.count({ where: { action: 'PURCHASE_PAYMENT', entityId: id } })).toBe(2);

    const supplier = await request(app).get(`/api/v1/suppliers/${s.id}`).set(auth(owner.token));
    expect(supplier.body.supplier.stats).toMatchObject({ purchaseCount: 1, totalPurchased: 300, balanceDue: 0 });
  });

  it('el almacenista recibe pero no registra pagos: la compra de contado queda por pagar', async () => {
    const warehouse = await actorWithRole(app, 'WAREHOUSE');
    const s = await newSupplier();
    const p = await newProduct();
    const res = await createPurchase(warehouse.token, { supplierId: s.id, purchaseDate: todayISO(), paymentMethod: 'CASH', receive: true, items: [line(p.id)] });
    expect(res.status).toBe(201);
    expect(res.body.purchase).toMatchObject({ status: 'RECEIVED', paymentStatus: 'PENDING' });
    await request(app).post(`/api/v1/purchases/${res.body.purchase.id}/payments`).set(auth(warehouse.token)).send({ amount: 1, method: 'CASH' }).expect(403);
  });
});

describe('Compras: cancelación', () => {
  it('cancelar un pedido no mueve inventario', async () => {
    const s = await newSupplier();
    const p = await newProduct();
    const order = await createPurchase(owner.token, { supplierId: s.id, purchaseDate: todayISO(), paymentMethod: 'CREDIT', items: [line(p.id)] });
    const res = await request(app).post(`/api/v1/purchases/${order.body.purchase.id}/cancel`).set(auth(owner.token)).send({ reason: 'Proveedor sin existencia' });
    expect(res.body.purchase.status).toBe('CANCELLED');
    expect(await batchesOf(p.id)).toHaveLength(0);
  });

  it('cancelar una compra recibida retira lo ingresado, si sigue en el lote', async () => {
    const s = await newSupplier();
    const p = await newProduct();
    const received = await createPurchase(owner.token, { supplierId: s.id, purchaseDate: todayISO(), paymentMethod: 'CREDIT', receive: true, items: [line(p.id, { quantity: 8 })] });
    const id = received.body.purchase.id;
    await request(app).post(`/api/v1/purchases/${id}/cancel`).set(auth(owner.token)).send({ reason: 'abc' }).expect(400);
    const res = await request(app).post(`/api/v1/purchases/${id}/cancel`).set(auth(owner.token)).send({ reason: 'Mercancía equivocada' });
    expect(res.status).toBe(200);
    const [batch] = await batchesOf(p.id);
    expect(batch).toMatchObject({ quantity: 0, status: 'DEPLETED' });
    const out = await prisma.inventoryMovement.findFirst({ where: { batchId: batch!.id, referenceType: 'PURCHASE_CANCEL' } });
    expect(out).toMatchObject({ type: 'ADJUSTMENT_OUT', reason: 'RETURN', quantityChange: -8 });
  });

  it('no se cancela si ya salieron unidades del lote o si tiene pagos', async () => {
    const s = await newSupplier();
    const p = await newProduct();
    const received = await createPurchase(owner.token, { supplierId: s.id, purchaseDate: todayISO(), paymentMethod: 'CREDIT', receive: true, items: [line(p.id, { quantity: 5 })] });
    const id = received.body.purchase.id;
    const [batch] = await batchesOf(p.id);
    await request(app).post('/api/v1/inventory/adjustments').set(auth(owner.token)).send({ batchId: batch!.id, direction: 'OUT', quantity: 2, reason: 'DAMAGED' }).expect(201);
    const sold = await request(app).post(`/api/v1/purchases/${id}/cancel`).set(auth(owner.token)).send({ reason: 'Ya no se necesita' });
    expect(sold.status).toBe(422);
    expect((await batchesOf(p.id))[0]!.quantity).toBe(3);

    const paid = await createPurchase(owner.token, { supplierId: s.id, purchaseDate: todayISO(), paymentMethod: 'CASH', receive: true, items: [line(p.id)] });
    const res = await request(app).post(`/api/v1/purchases/${paid.body.purchase.id}/cancel`).set(auth(owner.token)).send({ reason: 'Ya no se necesita' });
    expect(res.status).toBe(422);
  });
});

describe('Compras: consulta y permisos', () => {
  it('búsqueda por folio, factura o proveedor y filtro por estado', async () => {
    const s = await newSupplier({ tradeName: `Busqueda ${tag()}` });
    const p = await newProduct();
    const created = await createPurchase(owner.token, { supplierId: s.id, invoiceNumber: `Q-${tag()}`, purchaseDate: todayISO(), paymentMethod: 'CREDIT', items: [line(p.id)] });
    const { folio, invoiceNumber, id } = created.body.purchase;
    for (const q of [folio, folio.replace('C-', '').replace(/^0+/, ''), invoiceNumber.toLowerCase(), s.tradeName.slice(0, 12)]) {
      const res = await request(app).get('/api/v1/purchases').query({ q }).set(auth(owner.token));
      expect(res.body.data.map((x: { id: string }) => x.id), q).toContain(id);
    }
    const ordered = await request(app).get('/api/v1/purchases?status=RECEIVED').set(auth(owner.token));
    expect(ordered.body.data.map((x: { id: string }) => x.id)).not.toContain(id);
  });

  it('permisos por rol y por permiso de recepción', async () => {
    const s = await newSupplier();
    const p = await newProduct();
    const pharmacist = await actorWithRole(app, 'PHARMACIST');
    const cashier = await actorWithRole(app, 'CASHIER');
    await request(app).get('/api/v1/purchases').set(auth(pharmacist.token)).expect(200);
    await createPurchase(pharmacist.token, { supplierId: s.id, purchaseDate: todayISO(), paymentMethod: 'CASH', items: [line(p.id)] }).expect(403);
    await request(app).get('/api/v1/purchases').set(auth(cashier.token)).expect(403);

    // Rol que registra pedidos pero no recibe mercancía
    const role = await prisma.role.create({
      data: {
        code: `CAPTURA_${tag()}`,
        name: `Captura ${tag()}`,
        permissions: { create: [{ permission: { connect: { key: 'purchases.create' } } }, { permission: { connect: { key: 'purchases.view' } } }] },
      },
    });
    const user = await createTestUser({ roleCode: role.code });
    const token = await loginAs(app, user);
    const res = await createPurchase(token, { supplierId: s.id, purchaseDate: todayISO(), paymentMethod: 'CASH', receive: true, items: [line(p.id)] });
    expect(res.status).toBe(403);
    await createPurchase(token, { supplierId: s.id, purchaseDate: todayISO(), paymentMethod: 'CASH', items: [line(p.id)] }).expect(201);
  });

  it('una compra de otra sucursal no se puede consultar ni recibir', async () => {
    const other = await prisma.branch.create({ data: { code: `S${tag()}`.slice(0, 20), name: 'Sucursal Sur' } });
    const s = await newSupplier();
    const purchase = await prisma.purchase.create({
      data: { branchId: other.id, supplierId: s.id, purchaseDate: new Date(), paymentMethod: 'CASH', status: 'ORDERED', createdById: owner.id },
    });
    await request(app).get(`/api/v1/purchases/${purchase.id}`).set(auth(owner.token)).expect(404);
    await request(app).post(`/api/v1/purchases/${purchase.id}/receive`).set(auth(owner.token)).expect(404);
  });
});
