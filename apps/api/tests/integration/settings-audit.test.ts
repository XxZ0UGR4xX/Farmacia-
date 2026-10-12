import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { todayISO } from '../../src/lib/dates';
import { prisma } from '../../src/lib/prisma';
import { actorWithRole, mainBranchId, type TestUser } from '../helpers';

const app = createApp({ rateLimitEnabled: false });
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const tag = () => randomUUID().slice(0, 6).toUpperCase();
let owner: TestUser & { token: string };
let admin: TestUser & { token: string };
let pharmacist: TestUser & { token: string };

// La configuración es global: se guarda y se restaura para no afectar a otras pruebas
const KEYS = ['pharmacy.profile', 'pharmacy.fiscal', 'inventory.defaults', 'alerts.expiry'];
let saved: { key: string; value: unknown }[] = [];

beforeAll(async () => {
  owner = await actorWithRole(app, 'OWNER');
  admin = await actorWithRole(app, 'ADMIN');
  pharmacist = await actorWithRole(app, 'PHARMACIST');
  saved = (await prisma.setting.findMany({ where: { key: { in: KEYS } } })).map((s) => ({ key: s.key, value: s.value }));
});
afterAll(async () => {
  for (const s of saved) await prisma.setting.update({ where: { key: s.key }, data: { value: s.value as object } });
  await prisma.$disconnect();
});

describe('Configuración', () => {
  it('se consulta con settings.view y se edita con settings.manage', async () => {
    const res = await request(app).get('/api/v1/settings').set(auth(owner.token));
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.settings).sort()).toEqual(['alerts.expiry', 'inventory.defaults', 'pharmacy.fiscal', 'pharmacy.profile', 'pharmacy.taxes']);
    expect(res.body.settings['inventory.defaults'].value).toMatchObject({ marginBasis: 'COST' });

    expect((await request(app).get('/api/v1/settings').set(auth(pharmacist.token))).status).toBe(403);
    expect((await request(app).put('/api/v1/settings/pharmacy.profile').set(auth(pharmacist.token)).send({ name: 'X' })).status).toBe(403);
  });

  it('los datos de la farmacia salen en el ticket y el cambio queda auditado con antes y después', async () => {
    const name = `Farmacia Prueba ${tag()}`;
    const res = await request(app)
      .put('/api/v1/settings/pharmacy.profile')
      .set(auth(admin.token))
      .send({ name, phone: '55 1234 5678', email: 'contacto@farmacia-demo.local', address: 'Av. Ficticia 123' });
    expect(res.status).toBe(200);
    expect(res.body.settings['pharmacy.profile']).toMatchObject({ value: { name, phone: '55 1234 5678' }, updatedBy: 'Usuario Prueba' });

    const log = await prisma.auditLog.findFirst({ where: { action: 'SETTINGS_UPDATE', userId: admin.id }, orderBy: { createdAt: 'desc' } });
    expect(log?.metadata).toMatchObject({ key: 'pharmacy.profile', changes: expect.arrayContaining([expect.objectContaining({ field: 'name', after: name })]) });

    // Un guardado sin cambios no genera otro registro
    const count = await prisma.auditLog.count({ where: { action: 'SETTINGS_UPDATE', userId: admin.id } });
    await request(app).put('/api/v1/settings/pharmacy.profile').set(auth(admin.token)).send({ name, phone: '55 1234 5678', email: 'contacto@farmacia-demo.local', address: 'Av. Ficticia 123' });
    expect(await prisma.auditLog.count({ where: { action: 'SETTINGS_UPDATE', userId: admin.id } })).toBe(count);
  });

  it('valida RFC, código postal, margen sobre precio y días de alerta', async () => {
    const put = (key: string, body: object) => request(app).put(`/api/v1/settings/${key}`).set(auth(owner.token)).send(body);
    expect((await put('pharmacy.fiscal', { rfc: 'NOVALIDO', zipCode: '123' })).status).toBe(400);
    const fiscal = await put('pharmacy.fiscal', { rfc: 'fde010101aa1', legalName: 'Farmacia Demo SA de CV', zipCode: '06600' });
    expect(fiscal.body.settings['pharmacy.fiscal'].value).toMatchObject({ rfc: 'FDE010101AA1', zipCode: '06600' });

    // Decisión del propietario: el margen puede ser sobre el costo o sobre el precio de venta
    expect((await put('inventory.defaults', { defaultMarginPercent: 95, marginBasis: 'PRICE', defaultMinStock: 5 })).status).toBe(400);
    const pricing = await put('inventory.defaults', { defaultMarginPercent: 25, marginBasis: 'PRICE', defaultMinStock: 5 });
    expect(pricing.status).toBe(200);
    const defaults = await request(app).get('/api/v1/settings/defaults').set(auth(pharmacist.token));
    expect(defaults.body.inventory).toEqual({ defaultMarginPercent: 25, marginBasis: 'PRICE', defaultMinStock: 5 });

    expect((await put('alerts.expiry', { criticalDays: 60, warningDays: 30 })).status).toBe(400);
    expect((await put('alerts.expiry', { criticalDays: 45, warningDays: 120 })).status).toBe(200);
    expect((await put('otra.clave', { a: 1 })).status).toBe(400);
  });
});

describe('Sucursales', () => {
  it('alta, edición y reglas para desactivar', async () => {
    const code = `S${tag()}`;
    const created = await request(app).post('/api/v1/settings/branches').set(auth(owner.token)).send({ code: code.toLowerCase(), name: 'Sucursal Norte', phone: '55 0000 0001' });
    expect(created.status).toBe(201);
    expect(created.body.branch).toMatchObject({ code, name: 'Sucursal Norte', isActive: true });
    const id = created.body.branch.id as string;

    expect((await request(app).post('/api/v1/settings/branches').set(auth(owner.token)).send({ code, name: 'Repetida' })).status).toBe(409);

    // Editar sólo el nombre no la reactiva ni cambia otros datos
    const off = await request(app).patch(`/api/v1/settings/branches/${id}`).set(auth(owner.token)).send({ isActive: false });
    expect(off.status).toBe(200);
    const renamed = await request(app).patch(`/api/v1/settings/branches/${id}`).set(auth(owner.token)).send({ name: 'Sucursal Norte 2' });
    expect(renamed.body.branch).toMatchObject({ name: 'Sucursal Norte 2', isActive: false, phone: '55 0000 0001' });

    // La matriz es la predeterminada de usuarios activos: no se puede desactivar
    const main = await mainBranchId();
    const blocked = await request(app).patch(`/api/v1/settings/branches/${main}`).set(auth(owner.token)).send({ isActive: false });
    expect(blocked.status).toBe(422);

    expect(await prisma.auditLog.count({ where: { entityType: 'branch', entityId: id } })).toBe(3);
    expect((await request(app).post('/api/v1/settings/branches').set(auth(pharmacist.token)).send({ code: 'X1', name: 'X' })).status).toBe(403);
  });
});

describe('Bitácora de auditoría', () => {
  it('filtra por usuario, grupo, acción y fecha; sólo con audit.view', async () => {
    const all = await request(app).get(`/api/v1/audit?userId=${owner.id}`).set(auth(owner.token));
    expect(all.status).toBe(200);
    expect(all.body.data.length).toBeGreaterThan(0);
    expect(all.body.data.every((r: { user: { id: string } }) => r.user.id === owner.id)).toBe(true);
    expect(all.body.data[0]).toMatchObject({ action: expect.any(String), group: expect.any(String), user: { fullName: 'Usuario Prueba' } });

    const settings = await request(app).get(`/api/v1/audit?group=admin&action=SETTINGS_UPDATE&from=${todayISO()}&to=${todayISO()}`).set(auth(owner.token));
    expect(settings.body.data.length).toBeGreaterThan(0);
    expect(settings.body.data.every((r: { action: string }) => r.action === 'SETTINGS_UPDATE')).toBe(true);

    // Acción de otro grupo: nada (los filtros se combinan)
    const none = await request(app).get('/api/v1/audit?group=sales&action=SETTINGS_UPDATE').set(auth(owner.token));
    expect(none.body.data).toEqual([]);

    expect((await request(app).get('/api/v1/audit?action=NO_EXISTE').set(auth(owner.token))).status).toBe(400);
    expect((await request(app).get('/api/v1/audit').set(auth(pharmacist.token))).status).toBe(403);
  });

  it('los intentos de acceso negado aparecen como eventos de seguridad', async () => {
    await request(app).get('/api/v1/audit').set(auth(pharmacist.token));
    const res = await request(app).get(`/api/v1/audit?security=true&userId=${pharmacist.id}`).set(auth(owner.token));
    expect(res.body.data[0]).toMatchObject({ action: 'ACCESS_DENIED', group: 'security', metadata: expect.objectContaining({ missing: ['audit.view'] }) });
    expect(res.body.summary.security).toBeGreaterThan(0);
  });

  it('se exporta a CSV y la exportación también queda registrada', async () => {
    const res = await request(app).get(`/api/v1/audit/export?userId=${owner.id}`).set(auth(owner.token));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text.replace(/^﻿/, '').split('\r\n')[0]).toBe('Fecha,Usuario,Correo,Acción,Grupo,Sucursal,Entidad,Id,IP,Detalle');
    const log = await prisma.auditLog.findFirst({ where: { action: 'AUDIT_EXPORT', userId: owner.id } });
    expect(log?.metadata).toMatchObject({ filters: { userId: owner.id }, truncated: false });
  });

  it('la bitácora no se puede modificar ni borrar', async () => {
    const row = await prisma.auditLog.findFirstOrThrow({ where: { userId: owner.id } });
    await expect(prisma.auditLog.update({ where: { id: row.id }, data: { action: 'OTRA' } })).rejects.toThrow();
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow();
  });
});
