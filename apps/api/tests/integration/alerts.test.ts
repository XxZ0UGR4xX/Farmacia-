import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { todayISO } from '../../src/lib/dates';
import { prisma } from '../../src/lib/prisma';
import { refreshAlerts } from '../../src/modules/notifications/alerts.service';
import { createTestUser, loginAs } from '../helpers';

/**
 * Las alertas son por sucursal: estas pruebas usan una sucursal propia para no depender
 * de los datos que crean otros archivos de prueba.
 */
const app = createApp({ rateLimitEnabled: false });
const tag = () => randomUUID().slice(0, 8).toUpperCase();
let branchId: string;
let categoryId: string;
let ownerId: string;
const tokens: Record<string, string> = {};

const day = (offset: number) => {
  const d = new Date(`${todayISO()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
};

async function product(name: string, minStock: number) {
  const p = await prisma.product.create({
    data: { sku: `AL-${tag()}`, commercialName: name, searchText: name.toLowerCase(), categoryId, presentation: 'BOX', salePrice: 30, purchasePrice: 10 },
  });
  await prisma.inventory.create({ data: { productId: p.id, branchId, minStock } });
  return p;
}

async function batch(productId: string, quantity: number, expiresInDays: number, lot = `L${tag()}`) {
  return prisma.productBatch.create({
    data: { productId, branchId, lotNumber: lot, expiresAt: day(expiresInDays), quantity, initialQuantity: quantity, unitCost: 10, status: quantity > 0 ? 'ACTIVE' : 'DEPLETED' },
  });
}

async function actor(roleCode: string) {
  const user = await createTestUser({ roleCode });
  await prisma.userBranch.create({ data: { userId: user.id, branchId } });
  return { ...user, token: await loginAs(app, user) };
}

const active = () => prisma.notification.findMany({ where: { branchId, resolvedAt: null } });
const keys = async () => (await active()).map((n) => n.dedupeKey).sort();

let outProduct: { id: string };
let lowProduct: { id: string };
let lowBatch: { id: string };
let expiredBatch: { id: string };
let soonBatch: { id: string };

beforeAll(async () => {
  branchId = (await prisma.branch.create({ data: { code: `AL${tag()}`.slice(0, 20), name: 'Sucursal Alertas' } })).id;
  categoryId = (await prisma.category.create({ data: { name: `Alertas ${tag()}` } })).id;

  outProduct = await product('Agotado de prueba', 5);
  lowProduct = await product('Bajo de prueba', 5);
  lowBatch = await batch(lowProduct.id, 3, 300);
  const expiry = await product('Caducidad de prueba', 2);
  expiredBatch = await batch(expiry.id, 4, -2, 'VENCIDO');
  soonBatch = await batch(expiry.id, 6, 10, 'PRONTO');
  await batch(expiry.id, 20, 200, 'LEJANO');
  // Sin mínimo definido no se alerta aunque esté en cero
  await product('Sin mínimo', 0);

  const owner = await actor('OWNER');
  ownerId = owner.id;
  tokens.OWNER = owner.token;
  tokens.CASHIER = (await actor('CASHIER')).token;
  tokens.WAREHOUSE = (await actor('WAREHOUSE')).token;

  const supplier = await prisma.supplier.create({ data: { tradeName: `Proveedor alertas ${tag()}` } });
  const base = { branchId, supplierId: supplier.id, paymentMethod: 'CREDIT' as const, createdById: ownerId, total: 500, subtotal: 500 };
  await prisma.purchase.create({ data: { ...base, purchaseDate: day(-40), status: 'RECEIVED', paymentDueDate: day(-1) } });
  await prisma.purchase.create({ data: { ...base, purchaseDate: day(-28), status: 'RECEIVED', paymentDueDate: day(2) } });
  await prisma.purchase.create({ data: { ...base, purchaseDate: day(-5), status: 'RECEIVED', paymentDueDate: day(25) } });
  await prisma.purchase.create({ data: { ...base, purchaseDate: day(-10), status: 'ORDERED' } });
});
afterAll(() => prisma.$disconnect());

describe('Conciliación de alertas', () => {
  it('detecta cada condición una sola vez', async () => {
    await refreshAlerts(branchId);
    const list = await active();
    const byType = (t: string) => list.filter((n) => n.type === t);
    expect(byType('OUT_OF_STOCK')).toEqual([expect.objectContaining({ severity: 'CRITICAL', entityId: outProduct.id })]);
    expect(byType('LOW_STOCK')).toEqual([expect.objectContaining({ severity: 'WARNING', entityId: lowProduct.id })]);
    expect(byType('EXPIRED')).toEqual([expect.objectContaining({ dedupeKey: `EXPIRED:${expiredBatch.id}`, severity: 'CRITICAL' })]);
    expect(byType('EXPIRING_SOON')).toEqual([expect.objectContaining({ dedupeKey: `EXPIRING_SOON:${soonBatch.id}` })]);
    expect(byType('EXPIRING_SOON')[0]!.message).toMatch(/en 10 días/);
    const payments = byType('SUPPLIER_PAYMENT_DUE');
    expect(payments.map((n) => n.severity).sort()).toEqual(['CRITICAL', 'WARNING']);
    expect(byType('PURCHASE_PENDING')).toHaveLength(1);

    // Repetir no duplica
    const again = await refreshAlerts(branchId);
    expect(again).toMatchObject({ created: 0, resolved: 0 });
    expect(await active()).toHaveLength(list.length);
  });

  it('revisiones simultáneas no duplican alertas', async () => {
    await Promise.all([refreshAlerts(branchId), refreshAlerts(branchId), refreshAlerts(branchId)]);
    const k = await keys();
    expect(new Set(k).size).toBe(k.length);
  });

  it('se cierra cuando la condición desaparece y el texto se actualiza sin perder lo leído', async () => {
    await refreshAlerts(branchId);
    const low = (await active()).find((n) => n.type === 'LOW_STOCK')!;
    await prisma.notificationRead.create({ data: { notificationId: low.id, userId: ownerId } });

    // Se vende una más: sigue bajo, cambia el texto
    await prisma.productBatch.update({ where: { id: lowBatch.id }, data: { quantity: 2 } });
    const updated = await refreshAlerts(branchId);
    expect(updated.updated).toBeGreaterThanOrEqual(1);
    const same = await prisma.notification.findUniqueOrThrow({ where: { id: low.id }, include: { reads: true } });
    expect(same.message).toMatch(/Quedan 2/);
    expect(same.reads).toHaveLength(1);

    // Llega mercancía al agotado: se cierra su alerta
    await batch(outProduct.id, 50, 400);
    const r = await refreshAlerts(branchId);
    expect(r.resolved).toBeGreaterThanOrEqual(1);
    expect((await active()).some((n) => n.type === 'OUT_OF_STOCK')).toBe(false);
    const closed = await prisma.notification.findFirst({ where: { branchId, type: 'OUT_OF_STOCK' } });
    expect(closed?.resolvedAt).not.toBeNull();

    // Si vuelve a agotarse, es una alerta nueva (no se reabre la anterior)
    await prisma.productBatch.updateMany({ where: { productId: outProduct.id, branchId }, data: { quantity: 0, status: 'DEPLETED' } });
    await refreshAlerts(branchId);
    expect(await prisma.notification.count({ where: { branchId, type: 'OUT_OF_STOCK' } })).toBe(2);
  });
});

describe('GET /notifications', () => {
  const get = (role: string, path = '/api/v1/notifications') =>
    request(app).get(path).set({ Authorization: `Bearer ${tokens[role]}`, 'X-Branch-Id': branchId });

  it('cada rol ve sólo las alertas que le corresponden', async () => {
    await refreshAlerts(branchId);
    const types = async (role: string) => new Set(((await get(role)).body.data as { type: string }[]).map((n) => n.type));
    const owner = await types('OWNER');
    expect(owner).toEqual(new Set(['OUT_OF_STOCK', 'LOW_STOCK', 'EXPIRED', 'EXPIRING_SOON', 'SUPPLIER_PAYMENT_DUE', 'PURCHASE_PENDING']));
    expect(await types('CASHIER')).toEqual(new Set(['OUT_OF_STOCK', 'LOW_STOCK']));
    const warehouse = await types('WAREHOUSE');
    expect(warehouse.has('PURCHASE_PENDING')).toBe(true);
    expect(warehouse.has('SUPPLIER_PAYMENT_DUE')).toBe(false);
  });

  it('ordena por gravedad, enlaza a su pantalla y lleva el control de leídas por usuario', async () => {
    const res = await get('OWNER');
    const list = res.body.data as { id: string; severity: string; link: string | null; read: boolean; type: string }[];
    const order = { CRITICAL: 0, WARNING: 1, INFO: 2 } as Record<string, number>;
    expect(list.map((n) => order[n.severity])).toEqual([...list.map((n) => order[n.severity]!)].sort((a, b) => a - b));
    expect(list.find((n) => n.type === 'SUPPLIER_PAYMENT_DUE')?.link).toMatch(/^\/compras\/historial\//);
    expect(list.find((n) => n.type === 'EXPIRED')?.link).toMatch(/^\/inventario\/existencias\//);

    const before = (await get('CASHIER', '/api/v1/notifications/summary')).body.unread;
    const target = list.find((n) => n.type === 'OUT_OF_STOCK' || n.type === 'LOW_STOCK')!;
    await request(app).post(`/api/v1/notifications/${target.id}/read`).set({ Authorization: `Bearer ${tokens.OWNER}`, 'X-Branch-Id': branchId }).expect(204);
    // Leerla el propietario no cambia el contador de la cajera
    expect((await get('CASHIER', '/api/v1/notifications/summary')).body.unread).toBe(before);

    await request(app).post('/api/v1/notifications/read-all').set({ Authorization: `Bearer ${tokens.OWNER}`, 'X-Branch-Id': branchId }).expect(200);
    expect((await get('OWNER', '/api/v1/notifications/summary')).body.unread).toBe(0);

    // La cajera no puede marcar una alerta que no puede ver
    const payment = list.find((n) => n.type === 'SUPPLIER_PAYMENT_DUE')!;
    await request(app).post(`/api/v1/notifications/${payment.id}/read`).set({ Authorization: `Bearer ${tokens.CASHIER}`, 'X-Branch-Id': branchId }).expect(404);
  });
});

describe('GET /inventory/expirations', () => {
  it('resume caducados, críticos y próximos de la sucursal', async () => {
    const res = await request(app).get('/api/v1/inventory/expirations').set({ Authorization: `Bearer ${tokens.OWNER}`, 'X-Branch-Id': branchId });
    expect(res.status).toBe(200);
    expect(res.body.summary.EXPIRED).toMatchObject({ batches: 1, units: 4, value: 40 });
    expect(res.body.summary.CRITICAL).toMatchObject({ batches: 1, units: 6 });
    expect(res.body.data.map((b: { lotNumber: string }) => b.lotNumber)).toEqual(['VENCIDO', 'PRONTO']);

    const expired = await request(app).get('/api/v1/inventory/expirations?class=EXPIRED').set({ Authorization: `Bearer ${tokens.OWNER}`, 'X-Branch-Id': branchId });
    expect(expired.body.data).toHaveLength(1);

    const csv = await request(app).get('/api/v1/inventory/expirations/export').set({ Authorization: `Bearer ${tokens.OWNER}`, 'X-Branch-Id': branchId });
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain('VENCIDO');

    // El cajero no tiene acceso a caducidades
    await request(app).get('/api/v1/inventory/expirations').set({ Authorization: `Bearer ${tokens.CASHIER}`, 'X-Branch-Id': branchId }).expect(403);
  });
});
