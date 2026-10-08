import express from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { authenticate } from '../../src/middlewares/authenticate';
import { authorize } from '../../src/middlewares/authorize';
import { errorHandler } from '../../src/middlewares/error-handler';
import { createTestUser } from '../helpers';

const authApp = createApp({ rateLimitEnabled: false });

// App mínima con una ruta protegida para probar los middlewares de forma aislada
const protectedApp = express();
protectedApp.get('/protegido', authenticate, authorize('users.manage'), (_req, res) => {
  res.json({ ok: true });
});
protectedApp.use(errorHandler);

async function tokenFor(roleCode: string) {
  const user = await createTestUser({ roleCode });
  const res = await request(authApp)
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: user.password });
  return { user, token: res.body.accessToken as string };
}

afterAll(() => prisma.$disconnect());

describe('autorización por permisos', () => {
  it('el propietario accede', async () => {
    const { token } = await tokenFor('OWNER');
    const res = await request(protectedApp).get('/protegido').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('el administrador accede (tiene users.manage)', async () => {
    const { token } = await tokenFor('ADMIN');
    const res = await request(protectedApp).get('/protegido').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('un cajero recibe 403 y el intento queda auditado', async () => {
    const { user, token } = await tokenFor('CASHIER');
    const res = await request(protectedApp).get('/protegido').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');

    const denied = await prisma.auditLog.findFirst({
      where: { userId: user.id, action: 'ACCESS_DENIED' },
    });
    expect(denied?.metadata).toMatchObject({ missing: ['users.manage'] });
  });

  it('sin token responde 401', async () => {
    const res = await request(protectedApp).get('/protegido');
    expect(res.status).toBe(401);
  });

  it('un usuario desactivado pierde el acceso con su token vigente', async () => {
    const { user, token } = await tokenFor('OWNER');
    await prisma.user.update({ where: { id: user.id }, data: { status: 'INACTIVE' } });
    const { invalidateUser } = await import('../../src/modules/auth/session-cache');
    invalidateUser(user.id);
    const res = await request(protectedApp).get('/protegido').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });
});
