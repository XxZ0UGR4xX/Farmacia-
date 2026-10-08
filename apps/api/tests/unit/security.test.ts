import {
  ALL_PERMISSIONS,
  hasPermission,
  isPermissionKey,
  passwordPolicyErrors,
  SYSTEM_ROLES,
} from '@farmacia/shared';
import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { generateToken, hashPassword, safeEqual, sha256, verifyPassword } from '../../src/lib/crypto';
import { signAccessToken, verifyAccessToken } from '../../src/modules/auth/tokens';

describe('contraseñas', () => {
  it('genera hashes Argon2id que no contienen la contraseña y verifican correctamente', async () => {
    const hash = await hashPassword('MiClaveSegura123');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain('MiClaveSegura123');
    expect(await verifyPassword(hash, 'MiClaveSegura123')).toBe(true);
    expect(await verifyPassword(hash, 'otraClave123')).toBe(false);
  });

  it('dos hashes de la misma contraseña son distintos (sal aleatoria)', async () => {
    expect(await hashPassword('MiClaveSegura123')).not.toBe(await hashPassword('MiClaveSegura123'));
  });

  it('verifyPassword no lanza con un hash corrupto', async () => {
    expect(await verifyPassword('no-es-un-hash', 'x')).toBe(false);
  });

  it('aplica la política de contraseñas', () => {
    expect(passwordPolicyErrors('corta1')).not.toHaveLength(0);
    expect(passwordPolicyErrors('sinnumerosaqui')).toContain('Debe incluir al menos un número');
    expect(passwordPolicyErrors('1234567890123')).toContain('Debe incluir al menos una letra');
    expect(passwordPolicyErrors('Farmacia2026ok')).toHaveLength(0);
  });
});

describe('tokens opacos', () => {
  it('genera tokens únicos de alta entropía', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateToken()));
    expect(tokens.size).toBe(100);
    expect(generateToken().length).toBeGreaterThanOrEqual(43); // 32 bytes en base64url
  });

  it('sha256 es determinista y safeEqual compara correctamente', () => {
    expect(sha256('abc')).toBe(sha256('abc'));
    expect(sha256('abc')).toHaveLength(64);
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('access tokens JWT', () => {
  it('firma y verifica', () => {
    const token = signAccessToken({ sub: 'user-1', sid: 'session-1' });
    expect(verifyAccessToken(token)).toEqual({ sub: 'user-1', sid: 'session-1' });
  });

  it('rechaza un token alterado', () => {
    const token = signAccessToken({ sub: 'user-1', sid: 'session-1' });
    const [h, , s] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'admin', sid: 'x' })).toString('base64url');
    expect(() => verifyAccessToken(`${h}.${forged}.${s}`)).toThrowError(/inválido/);
  });

  it('rechaza tokens sin firma (alg: none)', () => {
    const unsigned = jwt.sign({ sid: 's' }, '', {
      algorithm: 'none',
      subject: 'u',
      issuer: 'farmacia-api',
      audience: 'farmacia-web',
    });
    expect(() => verifyAccessToken(unsigned)).toThrowError(/inválido/);
  });

  it('rechaza tokens firmados con otro secreto', () => {
    const other = jwt.sign({ sid: 's' }, 'otro-secreto-cualquiera-de-32-caracteres!!', {
      subject: 'u',
      issuer: 'farmacia-api',
      audience: 'farmacia-web',
    });
    expect(() => verifyAccessToken(other)).toThrowError(/inválido/);
  });

  it('reporta TOKEN_EXPIRED en tokens vencidos', () => {
    const expired = jwt.sign(
      { sid: 's', exp: Math.floor(Date.now() / 1000) - 10 },
      process.env.JWT_ACCESS_SECRET!,
      { subject: 'u', issuer: 'farmacia-api', audience: 'farmacia-web' },
    );
    expect(() => verifyAccessToken(expired)).toThrowError(expect.objectContaining({ code: 'TOKEN_EXPIRED' }));
  });
});

describe('roles y permisos', () => {
  it('todos los roles del sistema usan permisos existentes', () => {
    for (const role of Object.values(SYSTEM_ROLES)) {
      for (const p of role.permissions) expect(isPermissionKey(p)).toBe(true);
    }
  });

  it('el propietario tiene acceso a todo, incluso sin permisos explícitos', () => {
    for (const p of ALL_PERMISSIONS) expect(hasPermission('OWNER', [], p)).toBe(true);
  });

  it('un cajero no puede ajustar inventario ni gestionar usuarios', () => {
    const cashier = SYSTEM_ROLES.CASHIER.permissions;
    expect(hasPermission('CASHIER', cashier, 'sales.create')).toBe(true);
    expect(hasPermission('CASHIER', cashier, 'inventory.adjust')).toBe(false);
    expect(hasPermission('CASHIER', cashier, 'users.manage')).toBe(false);
    expect(hasPermission('CASHIER', new Set(cashier), 'audit.view')).toBe(false);
  });

  it('el administrador no puede gestionar roles', () => {
    expect(SYSTEM_ROLES.ADMIN.permissions).not.toContain('roles.manage');
  });
});
