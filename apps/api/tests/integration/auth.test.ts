import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { MemoryMailer, setMailer } from '../../src/lib/mailer';
import { prisma } from '../../src/lib/prisma';
import {
  cookieHeader,
  createTestUser,
  parseSetCookies,
  sessionCookies,
  type TestUser,
} from '../helpers';

const app = createApp({ rateLimitEnabled: false });
const mailer = new MemoryMailer();

async function login(user: TestUser, rememberMe = false) {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: user.password, rememberMe });
  expect(res.status).toBe(200);
  return { res, accessToken: res.body.accessToken as string, cookies: sessionCookies(res) };
}

async function auditActions(userId: string): Promise<string[]> {
  const logs = await prisma.auditLog.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
  return logs.map((l) => l.action);
}

beforeAll(() => setMailer(mailer));
afterAll(() => prisma.$disconnect());

describe('POST /auth/login', () => {
  it('inicia sesión, entrega access token y fija cookies seguras', async () => {
    const user = await createTestUser();
    const { res } = await login(user);

    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ email: user.email, role: { code: 'OWNER' } });
    expect(res.body.user.permissions).toContain('users.manage');
    // El refresh token nunca viaja en el cuerpo
    expect(JSON.stringify(res.body)).not.toContain(sessionCookies(res).rt);

    const cookies = parseSetCookies(res);
    expect(cookies.rt!.raw).toMatch(/HttpOnly/i);
    expect(cookies.rt!.raw).toMatch(/SameSite=Strict/i);
    expect(cookies.rt!.raw).toMatch(/Path=\/api\/v1\/auth/);
    // Sin "Recordarme": cookie de sesión (sin Expires/Max-Age)
    expect(cookies.rt!.raw).not.toMatch(/Max-Age|Expires/i);
    expect(cookies.csrf_token!.raw).not.toMatch(/HttpOnly/i);

    expect(await auditActions(user.id)).toContain('AUTH_LOGIN');
  });

  it('con "Recordarme" la cookie es persistente', async () => {
    const user = await createTestUser();
    const { res } = await login(user, true);
    expect(parseSetCookies(res).rt!.raw).toMatch(/Max-Age=\d+/);
  });

  it('el correo no distingue mayúsculas', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: `  ${user.email.toUpperCase()} `, password: user.password });
    expect(res.status).toBe(200);
  });

  it('responde igual ante contraseña incorrecta y correo inexistente', async () => {
    const user = await createTestUser();
    const bad = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'incorrecta123' });
    const unknown = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'no-existe@test.local', password: 'incorrecta123' });

    expect(bad.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(bad.body).toEqual(unknown.body);
    expect(bad.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('bloquea la cuenta tras 5 intentos fallidos, aun con la contraseña correcta', async () => {
    const user = await createTestUser();
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'mala1234567' });
    }
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password });
    expect(res.status).toBe(423);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
    expect(await auditActions(user.id)).toContain('AUTH_ACCOUNT_LOCKED');
  });

  it('rechaza usuarios inactivos', async () => {
    const user = await createTestUser({ status: 'INACTIVE' });
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_INACTIVE');
  });

  it('valida los datos de entrada', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'no-es-correo' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'email' })]),
    );
  });

  it('rechaza JSON mal formado', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":');
    expect(res.status).toBe(400);
  });
});

describe('GET /auth/me', () => {
  it('requiere autenticación', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('rechaza tokens inválidos', async () => {
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', 'Bearer abc.def.ghi');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('devuelve el perfil con permisos del rol', async () => {
    const user = await createTestUser({ roleCode: 'CASHIER' });
    const { accessToken } = await login(user);
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user.role.code).toBe('CASHIER');
    expect(res.body.user.permissions).toContain('sales.create');
    expect(res.body.user.permissions).not.toContain('inventory.adjust');
    expect(res.body.user.branches).toHaveLength(1);
  });
});

describe('POST /auth/refresh', () => {
  it('exige token CSRF', async () => {
    const user = await createTestUser();
    const { cookies } = await login(user);
    const noHeader = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookieHeader(cookies));
    expect(noHeader.status).toBe(403);
    expect(noHeader.body.error.code).toBe('CSRF_INVALID');

    const wrong = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(cookies))
      .set('X-CSRF-Token', 'otro-valor');
    expect(wrong.status).toBe(403);
  });

  it('rota el refresh token y emite un nuevo access token', async () => {
    const user = await createTestUser();
    const { cookies } = await login(user);
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(cookies))
      .set('X-CSRF-Token', cookies.csrf);
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(sessionCookies(res).rt).not.toBe(cookies.rt);
  });

  it('carrera entre pestañas: el token recién rotado responde REFRESH_RACE sin revocar la sesión', async () => {
    const user = await createTestUser();
    const { cookies, accessToken } = await login(user);
    const first = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(cookies))
      .set('X-CSRF-Token', cookies.csrf);
    expect(first.status).toBe(200);

    const second = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(cookies))
      .set('X-CSRF-Token', cookies.csrf);
    expect(second.status).toBe(401);
    expect(second.body.error.code).toBe('REFRESH_RACE');

    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${accessToken}`);
    expect(me.status).toBe(200);
  });

  it('detecta la reutilización de un token antiguo y revoca la sesión completa', async () => {
    const user = await createTestUser();
    const { cookies, accessToken } = await login(user);
    const rotated = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(cookies))
      .set('X-CSRF-Token', cookies.csrf);
    const newCookies = sessionCookies(rotated);

    // Simular que el token viejo se reutiliza tiempo después (p.ej. robado)
    await prisma.refreshToken.updateMany({
      where: { rotatedAt: { not: null }, session: { userId: user.id } },
      data: { rotatedAt: new Date(Date.now() - 60_000) },
    });

    const reuse = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(cookies))
      .set('X-CSRF-Token', cookies.csrf);
    expect(reuse.status).toBe(401);

    // Ni el token nuevo ni el access token siguen siendo válidos
    const legit = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(newCookies))
      .set('X-CSRF-Token', newCookies.csrf);
    expect(legit.status).toBe(401);
    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${accessToken}`);
    expect(me.status).toBe(401);
    expect(await auditActions(user.id)).toContain('AUTH_TOKEN_REUSE');
  });

  it('sin cookie responde 401', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', 'csrf_token=abc')
      .set('X-CSRF-Token', 'abc');
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  it('revoca la sesión: el access token y el refresh token dejan de funcionar', async () => {
    const user = await createTestUser();
    const { cookies, accessToken } = await login(user);

    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', cookieHeader(cookies))
      .set('X-CSRF-Token', cookies.csrf);
    expect(res.status).toBe(204);
    expect(parseSetCookies(res).rt!.raw).toMatch(/Expires=Thu, 01 Jan 1970/);

    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${accessToken}`);
    expect(me.status).toBe(401);
    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookieHeader(cookies))
      .set('X-CSRF-Token', cookies.csrf);
    expect(refresh.status).toBe(401);
    expect(await auditActions(user.id)).toContain('AUTH_LOGOUT');
  });
});

describe('recuperación de contraseña', () => {
  function lastResetToken(email: string): string {
    const mail = [...mailer.outbox].reverse().find((m) => m.to === email);
    const match = mail?.text.match(/token=([^\s]+)/);
    if (!match?.[1]) throw new Error('No se envió el correo de recuperación');
    return decodeURIComponent(match[1]);
  }

  it('responde de forma genérica aunque el correo no exista', async () => {
    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'nadie@test.local' });
    expect(res.status).toBe(202);
    expect(res.body.message).toMatch(/Si el correo está registrado/);
  });

  it('restablece la contraseña con un token de un solo uso y cierra todas las sesiones', async () => {
    const user = await createTestUser();
    const { accessToken } = await login(user);

    await request(app).post('/api/v1/auth/forgot-password').send({ email: user.email }).expect(202);
    await new Promise((r) => setTimeout(r, 20)); // el correo se envía en segundo plano
    const token = lastResetToken(user.email);

    const weak = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'corta' });
    expect(weak.status).toBe(400);

    const ok = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'NuevaClave2026x' });
    expect(ok.status).toBe(200);

    const reused = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'OtraClave2026x' });
    expect(reused.status).toBe(400);

    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${accessToken}`);
    expect(me.status).toBe(401);

    await login({ ...user, password: 'NuevaClave2026x' });
    expect(await auditActions(user.id)).toEqual(
      expect.arrayContaining(['AUTH_PASSWORD_RESET_REQUESTED', 'AUTH_PASSWORD_RESET']),
    );
  });

  it('un token expirado no sirve', async () => {
    const user = await createTestUser();
    await request(app).post('/api/v1/auth/forgot-password').send({ email: user.email }).expect(202);
    await new Promise((r) => setTimeout(r, 20));
    const token = lastResetToken(user.email);
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'NuevaClave2026x' });
    expect(res.status).toBe(400);
  });
});

describe('POST /auth/change-password', () => {
  it('valida la contraseña actual y cierra las demás sesiones', async () => {
    const user = await createTestUser();
    const a = await login(user);
    const b = await login(user);

    const wrong = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ currentPassword: 'incorrecta123', newPassword: 'CambioSeguro2026' });
    expect(wrong.status).toBe(400);

    const ok = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ currentPassword: user.password, newPassword: 'CambioSeguro2026' });
    expect(ok.status).toBe(200);

    const meA = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${a.accessToken}`);
    const meB = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${b.accessToken}`);
    expect(meA.status).toBe(200);
    expect(meB.status).toBe(401);
  });
});

describe('rate limiting', () => {
  it('limita intentos de login por IP y correo', async () => {
    const limited = createApp({ rateLimitEnabled: true });
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await request(limited)
        .post('/api/v1/auth/login')
        .send({ email: 'objetivo@test.local', password: 'adivinanza123' });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe('API', () => {
  it('health check', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('rutas inexistentes responden 404 JSON', async () => {
    const res = await request(app).get('/api/v1/no-existe');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('incluye cabeceras de seguridad y no expone la tecnología', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
  });
});
