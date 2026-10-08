import { ALL_PERMISSIONS } from '@farmacia/shared';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';
import { actorWithRole, createTestUser, DEFAULT_PASSWORD, loginAs, mainBranchId, roleId, type TestUser } from '../helpers';

const app = createApp({ rateLimitEnabled: false });
let owner: TestUser & { token: string };

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const uniqueName = (prefix: string) => `${prefix} ${randomUUID().slice(0, 8)}`;

async function createRole(token: string, permissions: string[], name = uniqueName('Rol')) {
  return request(app).post('/api/v1/roles').set(auth(token)).send({ name, permissions });
}

beforeAll(async () => {
  owner = await actorWithRole(app, 'OWNER');
});
afterAll(() => prisma.$disconnect());

describe('catálogo', () => {
  it('lista los roles del sistema con conteo de usuarios, propietario primero', async () => {
    const res = await request(app).get('/api/v1/roles').set(auth(owner.token));
    expect(res.status).toBe(200);
    const codes = res.body.roles.map((r: { code: string }) => r.code);
    expect(codes.slice(0, 6)).toEqual(['OWNER', 'ADMIN', 'DOCTOR', 'PHARMACIST', 'CASHIER', 'WAREHOUSE']);
    const ownerRole = res.body.roles[0];
    expect(ownerRole).toMatchObject({ isOwner: true, isSystem: true });
    expect(ownerRole.permissions).toHaveLength(ALL_PERMISSIONS.length);
    expect(ownerRole.userCount).toBeGreaterThan(0);
  });

  it('agrupa los permisos por módulo y marca los sensibles', async () => {
    const res = await request(app).get('/api/v1/permissions').set(auth(owner.token));
    expect(res.status).toBe(200);
    const all = res.body.groups.flatMap((g: { permissions: { key: string }[] }) => g.permissions);
    expect(all).toHaveLength(ALL_PERMISSIONS.length);
    const audit = all.find((p: { key: string }) => p.key === 'audit.view');
    expect(audit).toMatchObject({ sensitive: true });
  });
});

describe('roles personalizados', () => {
  it('crea un rol, se asigna a un usuario y sus permisos aplican', async () => {
    const res = await createRole(owner.token, ['products.view', 'inventory.view'], uniqueName('Auxiliar de mostrador'));
    expect(res.status).toBe(201);
    expect(res.body.role).toMatchObject({ isSystem: false, userCount: 0 });
    expect(res.body.role.code).toMatch(/^AUXILIAR_DE_MOSTRADOR/);
    expect(res.body.role.permissions).toEqual(['inventory.view', 'products.view']);

    const user = await createTestUser({ roleCode: res.body.role.code });
    const token = await loginAs(app, user);
    const me = await request(app).get('/api/v1/auth/me').set(auth(token));
    expect(me.body.user.permissions).toEqual(['inventory.view', 'products.view']);
  });

  it('rechaza permisos desconocidos y nombres repetidos', async () => {
    const unknown = await createRole(owner.token, ['products.view', 'hackear.todo']);
    expect(unknown.status).toBe(400);

    const name = uniqueName('Duplicado');
    expect((await createRole(owner.token, [], name)).status).toBe(201);
    const dup = await createRole(owner.token, [], name.toUpperCase());
    expect(dup.status).toBe(409);
  });

  it('cambiar los permisos de un rol aplica de inmediato a sus usuarios y queda auditado', async () => {
    const created = await createRole(owner.token, ['products.view']);
    const role = created.body.role;
    const user = await createTestUser({ roleCode: role.code });
    const token = await loginAs(app, user);

    expect((await request(app).get('/api/v1/users').set(auth(token))).status).toBe(403);

    const update = await request(app)
      .patch(`/api/v1/roles/${role.id}`)
      .set(auth(owner.token))
      .send({ permissions: ['products.view', 'users.view'] });
    expect(update.status).toBe(200);

    expect((await request(app).get('/api/v1/users').set(auth(token))).status).toBe(200);

    const audit = await prisma.auditLog.findFirst({ where: { entityId: role.id, action: 'ROLE_PERMISSIONS_CHANGE' } });
    expect(audit?.metadata).toMatchObject({ added: ['users.view'], removed: [] });
  });

  it('el rol Propietario no se puede modificar', async () => {
    const res = await request(app)
      .patch(`/api/v1/roles/${await roleId('OWNER')}`)
      .set(auth(owner.token))
      .send({ permissions: [] });
    expect(res.status).toBe(422);
  });

  it('el propietario puede personalizar roles del sistema', async () => {
    // Se crea un rol del sistema aislado para no alterar el CASHIER compartido por otras pruebas
    const created = await createRole(owner.token, ['sales.view']);
    await prisma.role.update({ where: { id: created.body.role.id }, data: { isSystem: true } });
    const res = await request(app)
      .patch(`/api/v1/roles/${created.body.role.id}`)
      .set(auth(owner.token))
      .send({ description: 'Personalizado', permissions: ['sales.view', 'sales.create'] });
    expect(res.status).toBe(200);
    expect(res.body.role.permissions).toEqual(['sales.create', 'sales.view']);
  });
});

describe('eliminar roles', () => {
  it('no elimina roles del sistema', async () => {
    const res = await request(app).delete(`/api/v1/roles/${await roleId('CASHIER')}`).set(auth(owner.token));
    expect(res.status).toBe(422);
  });

  it('no elimina roles con usuarios asignados (aunque estén inactivos)', async () => {
    const created = await createRole(owner.token, ['products.view']);
    await createTestUser({ roleCode: created.body.role.code, status: 'INACTIVE' });
    const res = await request(app).delete(`/api/v1/roles/${created.body.role.id}`).set(auth(owner.token));
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/1 usuario/);
  });

  it('elimina un rol sin usuarios y lo audita', async () => {
    const created = await createRole(owner.token, ['products.view']);
    const res = await request(app).delete(`/api/v1/roles/${created.body.role.id}`).set(auth(owner.token));
    expect(res.status).toBe(204);
    expect(await prisma.role.findUnique({ where: { id: created.body.role.id } })).toBeNull();
    expect(await prisma.auditLog.findFirst({ where: { entityId: created.body.role.id, action: 'ROLE_DELETE' } })).not.toBeNull();
  });
});

describe('anti-escalamiento de privilegios', () => {
  it('sin roles.manage no se pueden crear roles (administrador)', async () => {
    const admin = await actorWithRole(app, 'ADMIN');
    const res = await createRole(admin.token, ['products.view']);
    expect(res.status).toBe(403);
  });

  it('un gestor de roles no puede otorgar permisos que no tiene ni editar su propio rol', async () => {
    // Rol delegado: puede gestionar roles y usuarios, pero no ve la auditoría
    const delegated = await createRole(owner.token, ['roles.manage', 'users.view', 'users.manage']);
    const manager = await createTestUser({ roleCode: delegated.body.role.code });
    const token = await loginAs(app, manager);

    const escalate = await createRole(token, ['audit.view']);
    expect(escalate.status).toBe(403);
    expect(escalate.body.error.details).toEqual({ missing: ['audit.view'] });

    const allowed = await createRole(token, ['users.view']);
    expect(allowed.status).toBe(201);

    const selfEdit = await request(app)
      .patch(`/api/v1/roles/${delegated.body.role.id}`)
      .set(auth(token))
      .send({ permissions: ['roles.manage', 'users.view', 'users.manage', 'audit.view'] });
    expect([403, 422]).toContain(selfEdit.status);

    const editAdmin = await request(app)
      .patch(`/api/v1/roles/${await roleId('ADMIN')}`)
      .set(auth(token))
      .send({ description: 'x' });
    expect(editAdmin.status).toBe(403);
  });

  it('un usuario con users.manage no puede asignar un rol con más permisos que los suyos', async () => {
    const delegated = await createRole(owner.token, ['users.view', 'users.manage']);
    const manager = await createTestUser({ roleCode: delegated.body.role.code });
    const token = await loginAs(app, manager);

    const branchId = await mainBranchId();
    const target = await prisma.user.create({
      data: {
        email: `t-${randomUUID()}@test.local`,
        passwordHash: await hashPassword(DEFAULT_PASSWORD),
        firstName: 'T',
        lastName: 'T',
        roleId: delegated.body.role.id,
        defaultBranchId: branchId,
        branches: { create: { branchId } },
      },
    });
    const res = await request(app)
      .patch(`/api/v1/users/${target.id}`)
      .set(auth(token))
      .send({ roleId: await roleId('PHARMACIST') });
    expect(res.status).toBe(403);
  });
});
