import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { actorWithRole, type TestUser } from '../helpers';

const app = createApp({ rateLimitEnabled: false });
let owner: TestUser & { token: string };
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const unique = (p: string) => `${p} ${randomUUID().slice(0, 8)}`;

beforeAll(async () => {
  owner = await actorWithRole(app, 'OWNER');
});
afterAll(() => prisma.$disconnect());

describe.each([
  ['categories', 'category', { description: 'Descripción' }],
  ['laboratories', 'laboratory', { country: 'México', website: 'https://ejemplo.mx' }],
] as const)('/%s', (path, entityType, extra) => {
  it('crea, lista con conteo de productos, edita y elimina', async () => {
    const name = unique('Catálogo');
    const created = await request(app).post(`/api/v1/${path}`).set(auth(owner.token)).send({ name, ...extra });
    expect(created.status).toBe(201);
    expect(created.body.item).toMatchObject({ name, productCount: 0, ...extra });
    const id = created.body.item.id;

    const list = await request(app).get(`/api/v1/${path}`).set(auth(owner.token));
    expect(list.body.items.find((i: { id: string }) => i.id === id)).toBeTruthy();

    const renamed = unique('Renombrado');
    const updated = await request(app).patch(`/api/v1/${path}/${id}`).set(auth(owner.token)).send({ name: renamed });
    expect(updated.body.item.name).toBe(renamed);

    expect((await request(app).delete(`/api/v1/${path}/${id}`).set(auth(owner.token))).status).toBe(204);
    const after = await request(app).get(`/api/v1/${path}`).set(auth(owner.token));
    expect(after.body.items.find((i: { id: string }) => i.id === id)).toBeUndefined();

    const actions = (await prisma.auditLog.findMany({ where: { entityId: id, entityType } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['CATALOG_CREATE', 'CATALOG_UPDATE', 'CATALOG_DELETE']));
  });

  it('el nombre es único sin distinguir mayúsculas y uno eliminado se reactiva', async () => {
    const name = unique('Único');
    const first = await request(app).post(`/api/v1/${path}`).set(auth(owner.token)).send({ name });
    const dup = await request(app).post(`/api/v1/${path}`).set(auth(owner.token)).send({ name: name.toUpperCase() });
    expect(dup.status).toBe(409);

    await request(app).delete(`/api/v1/${path}/${first.body.item.id}`).set(auth(owner.token)).expect(204);
    const again = await request(app).post(`/api/v1/${path}`).set(auth(owner.token)).send({ name });
    expect(again.status).toBe(201);
    expect(again.body.item.id).toBe(first.body.item.id);
  });

  it('un farmacéutico puede consultar pero no administrar catálogos', async () => {
    const pharmacist = await actorWithRole(app, 'PHARMACIST');
    expect((await request(app).get(`/api/v1/${path}`).set(auth(pharmacist.token))).status).toBe(200);
    const res = await request(app).post(`/api/v1/${path}`).set(auth(pharmacist.token)).send({ name: unique('X') });
    expect(res.status).toBe(403);
  });
});

describe('borrado protegido', () => {
  it('no elimina una categoría que usan productos vigentes', async () => {
    const cat = await request(app).post('/api/v1/categories').set(auth(owner.token)).send({ name: unique('En uso') });
    await request(app)
      .post('/api/v1/products')
      .set(auth(owner.token))
      .send({ commercialName: 'Producto en uso', categoryId: cat.body.item.id, presentation: 'BOX', salePrice: 10 })
      .expect(201);
    const res = await request(app).delete(`/api/v1/categories/${cat.body.item.id}`).set(auth(owner.token));
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/1 producto/);
  });

  it('valida el sitio web del laboratorio', async () => {
    const res = await request(app)
      .post('/api/v1/laboratories')
      .set(auth(owner.token))
      .send({ name: unique('Lab'), website: 'no es url' });
    expect(res.status).toBe(400);
  });
});
