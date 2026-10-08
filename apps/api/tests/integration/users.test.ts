import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { actorWithRole, createTestUser, loginAs, mainBranchId, roleId, type TestUser } from '../helpers';

const app = createApp({ rateLimitEnabled: false });
let owner: TestUser & { token: string };
let branchId: string;

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const uniqueEmail = () => `nuevo-${randomUUID()}@test.local`;

async function newUserPayload(roleCode = 'CASHIER', overrides: Record<string, unknown> = {}) {
  return {
    email: uniqueEmail(),
    firstName: 'Ana',
    lastName: 'Pérez',
    roleId: await roleId(roleCode),
    branchIds: [branchId],
    ...overrides,
  };
}

async function auditFor(entityId: string, action: string) {
  return prisma.auditLog.findFirst({ where: { entityId, action } });
}

beforeAll(async () => {
  owner = await actorWithRole(app, 'OWNER');
  branchId = await mainBranchId();
});
afterAll(() => prisma.$disconnect());

describe('GET /users', () => {
  it('lista usuarios con paginación y búsqueda', async () => {
    const target = await createTestUser({ roleCode: 'PHARMACIST' });
    const res = await request(app)
      .get('/api/v1/users')
      .query({ q: target.email, pageSize: 5 })
      .set(auth(owner.token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ email: target.email, role: { code: 'PHARMACIST' }, status: 'ACTIVE' });
    expect(res.body.data[0]).not.toHaveProperty('passwordHash');
    expect(res.body.meta).toMatchObject({ page: 1, pageSize: 5, total: 1 });
  });

  it('filtra por rol y estado', async () => {
    await createTestUser({ roleCode: 'WAREHOUSE', status: 'INACTIVE' });
    const res = await request(app)
      .get('/api/v1/users')
      .query({ roleId: await roleId('WAREHOUSE'), status: 'INACTIVE', pageSize: 100 })
      .set(auth(owner.token));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const u of res.body.data) expect(u).toMatchObject({ status: 'INACTIVE', role: { code: 'WAREHOUSE' } });
  });

  it('un cajero no puede ver usuarios', async () => {
    const cashier = await actorWithRole(app, 'CASHIER');
    const res = await request(app).get('/api/v1/users').set(auth(cashier.token));
    expect(res.status).toBe(403);
  });

  it('un id mal formado responde 404', async () => {
    const res = await request(app).get('/api/v1/users/no-es-uuid').set(auth(owner.token));
    expect(res.status).toBe(404);
  });
});

describe('POST /users', () => {
  it('crea un usuario con contraseña temporal que debe cambiar al entrar', async () => {
    const payload = await newUserPayload('CASHIER', { phone: '555 123 4567' });
    const res = await request(app).post('/api/v1/users').set(auth(owner.token)).send(payload);

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      email: payload.email,
      role: { code: 'CASHIER' },
      mustChangePassword: true,
      defaultBranchId: branchId,
      phone: '555 123 4567',
    });
    const temp: string = res.body.temporaryPassword;
    expect(temp).toMatch(/^(?=.*[a-zA-Z])(?=.*\d).{12}$/);

    // Puede iniciar sesión con la contraseña temporal y el perfil exige cambiarla
    const login = await request(app).post('/api/v1/auth/login').send({ email: payload.email, password: temp });
    expect(login.status).toBe(200);
    expect(login.body.user.mustChangePassword).toBe(true);

    // Tras cambiarla, ya no se exige
    await request(app)
      .post('/api/v1/auth/change-password')
      .set(auth(login.body.accessToken))
      .send({ currentPassword: temp, newPassword: 'MiClavePropia2026' })
      .expect(200);
    const me = await request(app).get('/api/v1/auth/me').set(auth(login.body.accessToken));
    expect(me.body.user.mustChangePassword).toBe(false);

    const audit = await auditFor(res.body.user.id, 'USER_CREATE');
    expect(audit?.userId).toBe(owner.id);
    expect(JSON.stringify(audit?.metadata)).not.toContain(temp);
  });

  it('acepta una contraseña temporal elegida por el administrador si cumple la política', async () => {
    const weak = await request(app)
      .post('/api/v1/users')
      .set(auth(owner.token))
      .send(await newUserPayload('CASHIER', { temporaryPassword: 'corta' }));
    expect(weak.status).toBe(400);

    const ok = await request(app)
      .post('/api/v1/users')
      .set(auth(owner.token))
      .send(await newUserPayload('CASHIER', { temporaryPassword: 'Temporal2026x' }));
    expect(ok.status).toBe(201);
    expect(ok.body.temporaryPassword).toBe('Temporal2026x');
  });

  it('rechaza correos duplicados indicando el campo', async () => {
    const existing = await createTestUser();
    const res = await request(app)
      .post('/api/v1/users')
      .set(auth(owner.token))
      .send(await newUserPayload('CASHIER', { email: existing.email.toUpperCase() }));
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual([expect.objectContaining({ path: 'email' })]);
  });

  it('valida sucursales y rol', async () => {
    const noBranches = await request(app)
      .post('/api/v1/users')
      .set(auth(owner.token))
      .send(await newUserPayload('CASHIER', { branchIds: [] }));
    expect(noBranches.status).toBe(400);

    const badDefault = await request(app)
      .post('/api/v1/users')
      .set(auth(owner.token))
      .send(await newUserPayload('CASHIER', { defaultBranchId: randomUUID() }));
    expect(badDefault.status).toBe(400);

    const unknownBranch = await request(app)
      .post('/api/v1/users')
      .set(auth(owner.token))
      .send(await newUserPayload('CASHIER', { branchIds: [randomUUID()] }));
    expect(unknownBranch.status).toBe(400);

    const unknownRole = await request(app)
      .post('/api/v1/users')
      .set(auth(owner.token))
      .send(await newUserPayload('CASHIER', { roleId: randomUUID() }));
    expect(unknownRole.status).toBe(400);
  });

  it('un administrador puede crear cajeros pero no propietarios', async () => {
    const admin = await actorWithRole(app, 'ADMIN');
    const cashier = await request(app)
      .post('/api/v1/users')
      .set(auth(admin.token))
      .send(await newUserPayload('CASHIER'));
    expect(cashier.status).toBe(201);

    const ownerAttempt = await request(app)
      .post('/api/v1/users')
      .set(auth(admin.token))
      .send(await newUserPayload('OWNER'));
    expect(ownerAttempt.status).toBe(403);
  });

  it('un farmacéutico (sin users.manage) no puede crear usuarios', async () => {
    const pharmacist = await actorWithRole(app, 'PHARMACIST');
    const res = await request(app)
      .post('/api/v1/users')
      .set(auth(pharmacist.token))
      .send(await newUserPayload('CASHIER'));
    expect(res.status).toBe(403);
  });
});

describe('PATCH /users/:id', () => {
  it('actualiza datos y deja la bitácora de cambios', async () => {
    const target = await createTestUser({ roleCode: 'CASHIER' });
    const res = await request(app)
      .patch(`/api/v1/users/${target.id}`)
      .set(auth(owner.token))
      .send({ firstName: 'Mario', professionalLicense: '12345678' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ firstName: 'Mario', professionalLicense: '12345678' });

    const audit = await auditFor(target.id, 'USER_UPDATE');
    expect(audit?.metadata).toMatchObject({
      firstName: { from: 'Usuario', to: 'Mario' },
      professionalLicense: { from: null, to: '12345678' },
    });
  });

  it('el cambio de rol aplica de inmediato en la sesión abierta del usuario', async () => {
    const target = await createTestUser({ roleCode: 'CASHIER' });
    const token = await loginAs(app, target);
    const before = await request(app).get('/api/v1/users').set(auth(token));
    expect(before.status).toBe(403);

    await request(app)
      .patch(`/api/v1/users/${target.id}`)
      .set(auth(owner.token))
      .send({ roleId: await roleId('ADMIN') })
      .expect(200);

    const after = await request(app).get('/api/v1/users').set(auth(token));
    expect(after.status).toBe(200);
  });

  it('nadie puede cambiar su propio rol', async () => {
    const admin = await actorWithRole(app, 'ADMIN');
    const res = await request(app)
      .patch(`/api/v1/users/${admin.id}`)
      .set(auth(admin.token))
      .send({ roleId: await roleId('CASHIER') });
    expect(res.status).toBe(422);
  });

  it('un administrador no puede editar al propietario ni ascender a nadie a propietario', async () => {
    const admin = await actorWithRole(app, 'ADMIN');
    const editOwner = await request(app)
      .patch(`/api/v1/users/${owner.id}`)
      .set(auth(admin.token))
      .send({ firstName: 'Hackeado' });
    expect(editOwner.status).toBe(403);

    const cashier = await createTestUser({ roleCode: 'CASHIER' });
    const promote = await request(app)
      .patch(`/api/v1/users/${cashier.id}`)
      .set(auth(admin.token))
      .send({ roleId: await roleId('OWNER') });
    expect(promote.status).toBe(403);
  });

  it('valida que la sucursal predeterminada esté asignada', async () => {
    const target = await createTestUser({ roleCode: 'CASHIER' });
    const res = await request(app)
      .patch(`/api/v1/users/${target.id}`)
      .set(auth(owner.token))
      .send({ defaultBranchId: randomUUID() });
    expect(res.status).toBe(400);
  });
});

describe('activar / desactivar', () => {
  it('desactivar cierra sus sesiones y le impide entrar; reactivar lo restablece', async () => {
    const target = await createTestUser({ roleCode: 'PHARMACIST' });
    const token = await loginAs(app, target);

    const off = await request(app).post(`/api/v1/users/${target.id}/deactivate`).set(auth(owner.token));
    expect(off.status).toBe(200);
    expect(off.body.user.status).toBe('INACTIVE');

    const me = await request(app).get('/api/v1/auth/me').set(auth(token));
    expect(me.status).toBe(401);
    const login = await request(app).post('/api/v1/auth/login').send({ email: target.email, password: target.password });
    expect(login.status).toBe(403);

    const on = await request(app).post(`/api/v1/users/${target.id}/activate`).set(auth(owner.token));
    expect(on.body.user.status).toBe('ACTIVE');
    await loginAs(app, target);

    expect(await auditFor(target.id, 'USER_DEACTIVATE')).not.toBeNull();
    expect(await auditFor(target.id, 'USER_ACTIVATE')).not.toBeNull();
  });

  it('nadie puede desactivarse a sí mismo', async () => {
    const res = await request(app).post(`/api/v1/users/${owner.id}/deactivate`).set(auth(owner.token));
    expect(res.status).toBe(422);
  });
});

describe('acciones de seguridad', () => {
  it('restablecer contraseña: genera una temporal, cierra sesiones y exige cambio', async () => {
    const target = await createTestUser({ roleCode: 'CASHIER' });
    const token = await loginAs(app, target);

    const res = await request(app).post(`/api/v1/users/${target.id}/reset-password`).set(auth(owner.token));
    expect(res.status).toBe(200);
    const temp: string = res.body.temporaryPassword;

    expect((await request(app).get('/api/v1/auth/me').set(auth(token))).status).toBe(401);
    const old = await request(app).post('/api/v1/auth/login').send({ email: target.email, password: target.password });
    expect(old.status).toBe(401);
    const login = await request(app).post('/api/v1/auth/login').send({ email: target.email, password: temp });
    expect(login.status).toBe(200);
    expect(login.body.user.mustChangePassword).toBe(true);
  });

  it('no permite restablecer la propia contraseña por esta vía', async () => {
    const res = await request(app).post(`/api/v1/users/${owner.id}/reset-password`).set(auth(owner.token));
    expect(res.status).toBe(422);
  });

  it('desbloquea una cuenta bloqueada por intentos fallidos', async () => {
    const target = await createTestUser({ roleCode: 'CASHIER' });
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/v1/auth/login').send({ email: target.email, password: 'incorrecta123' });
    }
    const detail = await request(app).get(`/api/v1/users/${target.id}`).set(auth(owner.token));
    expect(detail.body.user.isLocked).toBe(true);

    const res = await request(app).post(`/api/v1/users/${target.id}/unlock`).set(auth(owner.token));
    expect(res.status).toBe(200);
    expect(res.body.user.isLocked).toBe(false);
    await loginAs(app, target);
  });

  it('cierra todas las sesiones de un usuario', async () => {
    const target = await createTestUser({ roleCode: 'CASHIER' });
    const t1 = await loginAs(app, target);
    const t2 = await loginAs(app, target);

    const detail = await request(app).get(`/api/v1/users/${target.id}`).set(auth(owner.token));
    expect(detail.body.user.activeSessions).toBe(2);

    const res = await request(app).post(`/api/v1/users/${target.id}/revoke-sessions`).set(auth(owner.token));
    expect(res.body.revokedSessions).toBe(2);
    expect((await request(app).get('/api/v1/auth/me').set(auth(t1))).status).toBe(401);
    expect((await request(app).get('/api/v1/auth/me').set(auth(t2))).status).toBe(401);
  });

  it('un administrador no puede restablecer la contraseña del propietario', async () => {
    const admin = await actorWithRole(app, 'ADMIN');
    const res = await request(app).post(`/api/v1/users/${owner.id}/reset-password`).set(auth(admin.token));
    expect(res.status).toBe(403);
  });
});

describe('GET /branches', () => {
  it('lista las sucursales activas', async () => {
    const res = await request(app).get('/api/v1/branches').set(auth(owner.token));
    expect(res.status).toBe(200);
    expect(res.body.branches).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'MATRIZ' })]));
  });
});
