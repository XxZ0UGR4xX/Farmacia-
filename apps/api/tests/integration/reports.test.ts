import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { todayISO } from '../../src/lib/dates';
import { prisma } from '../../src/lib/prisma';
import { createTestUser, loginAs } from '../helpers';

/**
 * Los reportes se calculan por sucursal: estas pruebas operan en una sucursal propia
 * (ventas, devoluciones, bajas y compras hechas aquí) para que los totales sean exactos.
 */
const app = createApp({ rateLimitEnabled: false });
const tag = () => randomUUID().slice(0, 8).toUpperCase();
let branchId: string;
let categoryId: string;
const users: Record<string, { id: string; token: string }> = {};
const as = (who: string) => ({ Authorization: `Bearer ${users[who]!.token}`, 'X-Branch-Id': branchId });

function inDays(days: number): string {
  const d = new Date(`${todayISO()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function actor(key: string, roleCode: string) {
  const user = await createTestUser({ roleCode });
  await prisma.userBranch.create({ data: { userId: user.id, branchId } });
  await prisma.user.update({ where: { id: user.id }, data: { defaultBranchId: branchId } });
  users[key] = { id: user.id, token: await loginAs(app, user) };
}

async function product(name: string, salePrice: number, purchasePrice: number, minStock = 0) {
  const res = await request(app)
    .post('/api/v1/products')
    .set(as('owner'))
    .send({ commercialName: `${name} ${tag()}`, categoryId, presentation: 'BOX', purchasePrice, salePrice, taxRate: 0, minStock });
  expect(res.status).toBe(201);
  return res.body.product as { id: string; commercialName: string };
}

async function stock(productId: string, quantity: number, unitCost: number, expiresInDays = 300) {
  const res = await request(app)
    .post('/api/v1/inventory/entries')
    .set(as('owner'))
    .send({ productId, lotNumber: `L-${tag()}`, expiresAt: inDays(expiresInDays), quantity, unitCost });
  expect(res.status).toBe(201);
  return res.body.batch.id as string;
}

async function sell(who: string, productId: string, quantity: number, total: number, method = 'CASH') {
  const res = await request(app)
    .post('/api/v1/sales')
    .set(as(who))
    .send({ items: [{ productId, quantity }], payments: [{ method, amount: total, ...(method === 'CASH' ? { received: total } : {}) }] });
  expect(res.status).toBe(201);
  return res.body.sale as { id: string; items: { id: string }[] };
}

let fast: { id: string };
let slow: { id: string };
let lowStock: { id: string };
let expiring: { id: string };
let supplierA: string;

beforeAll(async () => {
  branchId = (await prisma.branch.create({ data: { code: `RP${tag()}`.slice(0, 20), name: 'Sucursal Reportes' } })).id;
  categoryId = (await prisma.category.create({ data: { name: `Reportes ${tag()}` } })).id;

  await actor('owner', 'OWNER');
  await actor('cashier', 'CASHIER');
  await actor('pharmacist', 'PHARMACIST');
  await actor('warehouse', 'WAREHOUSE');
  // Rol a la medida: ve reportes operativos y exporta, pero sin costos ni utilidad
  const role = await prisma.role.create({
    data: {
      code: `RP_${tag()}`,
      name: `Encargado ${tag()}`,
      permissions: {
        create: (await prisma.permission.findMany({ where: { key: { in: ['dashboard.view', 'reports.view', 'reports.export', 'sales.view'] } } })).map((p) => ({
          permissionId: p.id,
        })),
      },
    },
  });
  await actor('manager', role.code);

  fast = await product('Rápido', 100, 40);
  slow = await product('Sin rotación', 50, 20);
  lowStock = await product('Bajo mínimo', 30, 10, 5);
  await stock(fast.id, 20, 40);
  await stock(slow.id, 10, 20);
  await stock(lowStock.id, 2, 10);
  // Producto aparte para la baja: si fuera del producto rápido, FEFO vendería primero ese lote
  expiring = await product('Por caducar', 60, 40);
  const expiringBatch = await stock(expiring.id, 4, 40, 5);

  // Ventas: 3 + 2 unidades del producto rápido (una por el farmacéutico), una cancelada
  const s1 = await sell('cashier', fast.id, 3, 300);
  await sell('pharmacist', fast.id, 2, 200, 'CARD');
  const cancelled = await sell('cashier', fast.id, 1, 100);
  expect((await request(app).post(`/api/v1/sales/${cancelled.id}/cancel`).set(as('owner')).send({ reason: 'Error de cobro' })).status).toBe(200);
  // Devolución de 1 unidad (regresa al inventario)
  const ret = await request(app)
    .post(`/api/v1/sales/${s1.id}/returns`)
    .set(as('owner'))
    .send({ reason: 'No lo necesitó', refundMethod: 'CASH', items: [{ saleItemId: s1.items[0]!.id, quantity: 1, disposition: 'RESTOCKED' }] });
  expect(ret.status).toBe(201);
  // Baja por caducidad: 2 unidades a costo 40
  const adj = await request(app).post('/api/v1/inventory/adjustments').set(as('owner')).send({ batchId: expiringBatch, direction: 'OUT', quantity: 2, reason: 'EXPIRED' });
  expect(adj.status).toBe(201);

  // Compras recibidas: una pagada y otra a crédito vencida
  supplierA = (await prisma.supplier.create({ data: { tradeName: `Proveedor A ${tag()}` } })).id;
  const supplierB = (await prisma.supplier.create({ data: { tradeName: `Proveedor B ${tag()}` } })).id;
  const base = { branchId, paymentMethod: 'CREDIT' as const, createdById: users.owner!.id, status: 'RECEIVED' as const, purchaseDate: new Date(`${todayISO()}T00:00:00Z`) };
  await prisma.purchase.create({ data: { ...base, supplierId: supplierA, subtotal: 800, total: 800, amountPaid: 800, paymentStatus: 'PAID' } });
  await prisma.purchase.create({ data: { ...base, supplierId: supplierB, subtotal: 300, total: 300, paymentDueDate: new Date(`${inDays(-1)}T00:00:00Z`) } });
  // Un pedido no recibido no cuenta como compra
  await prisma.purchase.create({ data: { ...base, supplierId: supplierA, subtotal: 999, total: 999, status: 'ORDERED' } });
});
afterAll(() => prisma.$disconnect());

describe('GET /reports/sales', () => {
  it('totales, devoluciones, cancelaciones y utilidad del periodo', async () => {
    const res = await request(app).get('/api/v1/reports/sales').set(as('owner'));
    expect(res.status).toBe(200);
    const { totals, series, byMethod, byCashier } = res.body;
    expect(totals).toMatchObject({
      count: 2,
      units: 5,
      gross: 500,
      refunds: 100,
      returns: 1,
      net: 400,
      averageTicket: 250,
      cancelled: { count: 1, total: 100 },
      // Venta neta sin IVA 400; costo neto 4 × 40 = 160
      revenue: 400,
      cost: 160,
      profit: 240,
      margin: 0.6,
      markup: 1.5,
    });
    expect(res.body.range).toMatchObject({ to: todayISO(), days: 30, groupBy: 'day' });
    expect(series).toHaveLength(30);
    expect(series.at(-1)).toMatchObject({ period: todayISO(), count: 2, gross: 500, refunds: 100, net: 400, profit: 240 });
    expect(series.reduce((s: number, x: { gross: number }) => s + x.gross, 0)).toBe(500);
    expect(byMethod).toEqual(
      expect.arrayContaining([
        { method: 'CASH', count: 1, amount: 300, refunds: 100, net: 200 },
        { method: 'CARD', count: 1, amount: 200, refunds: 0, net: 200 },
      ]),
    );
    expect(byCashier).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: users.cashier!.id, count: 1, total: 300, cancelled: 1 }),
        expect.objectContaining({ userId: users.pharmacist!.id, count: 1, total: 200, cancelled: 0 }),
      ]),
    );
    expect(res.body.byCategory).toEqual([expect.objectContaining({ categoryId, units: 5, total: 500, profit: 300 })]);
  });

  it('sin permiso financiero no hay costos ni utilidad', async () => {
    const res = await request(app).get('/api/v1/reports/sales').set(as('manager'));
    expect(res.status).toBe(200);
    expect(res.body.financial).toBe(false);
    expect(res.body.totals.gross).toBe(500);
    expect(res.body.totals).not.toHaveProperty('profit');
    expect(res.body.totals).not.toHaveProperty('cost');
    expect(res.body.series[0]).not.toHaveProperty('profit');
    expect(res.body.byCategory[0]).not.toHaveProperty('profit');
  });

  it('agrupa por semana y por mes, y valida el periodo', async () => {
    const week = await request(app).get(`/api/v1/reports/sales?from=${inDays(-60)}&to=${todayISO()}&groupBy=week`).set(as('owner'));
    expect(week.status).toBe(200);
    expect(week.body.series.at(-1).gross).toBe(500);
    for (const p of week.body.series) expect(new Date(`${p.period}T00:00:00Z`).getUTCDay()).toBe(1); // lunes
    const month = await request(app).get(`/api/v1/reports/sales?from=${inDays(-200)}`).set(as('owner'));
    expect(month.body.range.groupBy).toBe('month');
    expect(month.body.series.every((p: { period: string }) => p.period.endsWith('-01'))).toBe(true);

    expect((await request(app).get(`/api/v1/reports/sales?from=${todayISO()}&to=${inDays(-1)}`).set(as('owner'))).status).toBe(400);
    expect((await request(app).get(`/api/v1/reports/sales?from=${inDays(-800)}&to=${todayISO()}`).set(as('owner'))).status).toBe(400);
    expect((await request(app).get('/api/v1/reports/sales?from=2026-02-30').set(as('owner'))).status).toBe(400);
  });

  it('sólo con permiso de reportes', async () => {
    expect((await request(app).get('/api/v1/reports/sales').set(as('cashier'))).status).toBe(403);
    expect((await request(app).get('/api/v1/reports/sales').set(as('pharmacist'))).status).toBe(403);
  });
});

describe('GET /reports/products', () => {
  it('más vendidos y productos sin movimiento con existencia', async () => {
    const res = await request(app).get('/api/v1/reports/products').set(as('owner'));
    expect(res.status).toBe(200);
    expect(res.body.productsSold).toBe(1);
    expect(res.body.top).toEqual([expect.objectContaining({ productId: fast.id, units: 5, returned: 1, sales: 2, total: 500, profit: 300 })]);
    const ids = res.body.slow.map((p: { productId: string }) => p.productId);
    expect(ids).toEqual(expect.arrayContaining([slow.id, lowStock.id, expiring.id]));
    expect(res.body.slow.find((p: { productId: string }) => p.productId === slow.id)).toMatchObject({ stock: 10, retailValue: 500, costValue: 200, lastSale: null });
    expect(res.body.slowCount).toBe(3);
  });
});

describe('GET /reports/inventory', () => {
  it('valor por categoría, existencias bajo mínimo y riesgo de caducidad', async () => {
    const res = await request(app).get('/api/v1/reports/inventory').set(as('owner'));
    expect(res.status).toBe(200);
    // Se compara contra los lotes reales de la sucursal
    const lots = await prisma.productBatch.findMany({ where: { branchId, status: 'ACTIVE' }, include: { product: true } });
    const units = lots.reduce((s, b) => s + b.quantity, 0);
    const cost = lots.reduce((s, b) => s + b.quantity * Number(b.unitCost), 0);
    expect(res.body.totals).toMatchObject({ units, costValue: cost, lowStock: 1, outOfStock: 0 });
    expect(res.body.byCategory).toEqual([expect.objectContaining({ categoryId, products: 4, units })]);
    expect(res.body.risk.expiringSoon).toMatchObject({ lots: 1, units: 2, costValue: 80 });

    const manager = await request(app).get('/api/v1/reports/inventory').set(as('manager'));
    expect(manager.body.totals).not.toHaveProperty('costValue');
    expect(manager.body.risk.expiringSoon).not.toHaveProperty('costValue');
  });
});

describe('GET /reports/shrinkage', () => {
  it('bajas por motivo con su costo', async () => {
    const res = await request(app).get('/api/v1/reports/shrinkage').set(as('owner'));
    expect(res.status).toBe(200);
    expect(res.body.totals).toMatchObject({ lossUnits: 2, lossCost: 80, gainUnits: 0 });
    expect(res.body.losses).toEqual([{ type: 'EXPIRED', reason: 'EXPIRED', movements: 1, units: 2, cost: 80 }]);
    expect(res.body.top).toEqual([expect.objectContaining({ productId: expiring.id, units: 2, cost: 80 })]);
    const manager = await request(app).get('/api/v1/reports/shrinkage').set(as('manager'));
    expect(manager.body.losses).toEqual([{ type: 'EXPIRED', reason: 'EXPIRED', movements: 1, units: 2 }]);
  });
});

describe('GET /reports/purchases', () => {
  it('compras recibidas por proveedor y cuentas por pagar; sólo con permiso financiero', async () => {
    const res = await request(app).get('/api/v1/reports/purchases').set(as('owner'));
    expect(res.status).toBe(200);
    expect(res.body.totals).toMatchObject({ count: 2, total: 1100, paid: 800, payable: 300, overdue: 300 });
    expect(res.body.bySupplier[0]).toMatchObject({ supplierId: supplierA, count: 1, total: 800, share: 0.7273 });
    expect(res.body.payables).toEqual([expect.objectContaining({ count: 1, balance: 300, overdue: 300, nextDue: null })]);
    expect((await request(app).get('/api/v1/reports/purchases').set(as('manager'))).status).toBe(403);
  });
});

describe('GET /reports/dashboard', () => {
  it('el propietario ve la sucursal completa con utilidad', async () => {
    const res = await request(app).get('/api/v1/reports/dashboard').set(as('owner'));
    expect(res.status).toBe(200);
    expect(res.body.salesScope).toBe('branch');
    expect(res.body.sales.today).toMatchObject({ total: 500, count: 2, units: 5, refunds: 100, profit: 240 });
    expect(res.body.sales.last7).toHaveLength(7);
    expect(res.body.sales.recent).toHaveLength(3);
    expect(res.body.inventory).toMatchObject({ lowStock: 1, outOfStock: 0 });
    expect(res.body.inventory.costValue).toBeGreaterThan(0);
    expect(res.body.expirations).toMatchObject({ expiringLots: 1, expiringUnits: 2 });
    expect(res.body.purchases).toMatchObject({ overdue: { count: 1, amount: 300 }, pendingOrders: 1 });
  });

  it('cada rol ve sólo lo que le corresponde', async () => {
    // El farmacéutico ve sus propias ventas, sin utilidad ni valor del inventario
    const ph = await request(app).get('/api/v1/reports/dashboard').set(as('pharmacist'));
    expect(ph.status).toBe(200);
    expect(ph.body.salesScope).toBe('own');
    expect(ph.body.sales.today).toEqual(expect.objectContaining({ total: 200, count: 1 }));
    expect(ph.body.sales.today).not.toHaveProperty('profit');
    expect(ph.body.sales.recent).toHaveLength(1);
    expect(ph.body.inventory).not.toHaveProperty('costValue');
    expect(ph.body.purchases).toEqual({ pendingOrders: 1 });

    const wh = await request(app).get('/api/v1/reports/dashboard').set(as('warehouse'));
    expect(wh.body).toMatchObject({ salesScope: null, sales: null, returns: null });
    // El almacenista ve pedidos por recibir, no los saldos con proveedores
    expect(wh.body.purchases).toEqual({ pendingOrders: 1 });

    // El cajero no tiene dashboard
    expect((await request(app).get('/api/v1/reports/dashboard').set(as('cashier'))).status).toBe(403);
  });
});

describe('GET /reports/:report/export', () => {
  it('Excel con todas las tablas y queda en auditoría', async () => {
    const res = await request(app)
      .get('/api/v1/reports/sales/export?format=xlsx')
      .set(as('owner'))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="ventas_\d{4}-\d{2}-\d{2}_a_\d{4}-\d{2}-\d{2}\.xlsx"/);
    const body = res.body as Buffer;
    expect(body.subarray(0, 2).toString()).toBe('PK');
    const audit = await prisma.auditLog.findFirst({ where: { action: 'REPORT_EXPORT', userId: users.owner!.id }, orderBy: { createdAt: 'desc' } });
    expect(audit).toMatchObject({ branchId, entityId: 'sales', metadata: expect.objectContaining({ format: 'xlsx', financial: true }) });
  });

  it('CSV sin columnas financieras para quien no tiene el permiso', async () => {
    const res = await request(app).get('/api/v1/reports/sales/export?format=csv').set(as('manager'));
    expect(res.status).toBe(200);
    const [header] = res.text.replace(/^﻿/, '').split('\r\n');
    expect(header).toBe('Periodo (por día),Ventas,Unidades,Ventas brutas,Devoluciones,Ventas netas');
    const owner = await request(app).get('/api/v1/reports/products/export?format=csv').set(as('owner'));
    expect(owner.text).toContain('Utilidad bruta');
  });

  it('exige permiso de exportar y un reporte válido', async () => {
    expect((await request(app).get('/api/v1/reports/sales/export').set(as('pharmacist'))).status).toBe(403);
    expect((await request(app).get('/api/v1/reports/otro/export').set(as('owner'))).status).toBe(400);
    expect((await request(app).get('/api/v1/reports/purchases/export').set(as('manager'))).status).toBe(403);
  });
});
