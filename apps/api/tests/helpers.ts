import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { MAIN_BRANCH_CODE } from '../prisma/seed/core';
import type { UserStatus } from '../src/generated/prisma/client';
import { hashPassword } from '../src/lib/crypto';
import { prisma } from '../src/lib/prisma';

export const DEFAULT_PASSWORD = 'Prueba12345segura';

export interface TestUser {
  id: string;
  email: string;
  password: string;
}

/** Crea un usuario con correo único (las pruebas no dependen unas de otras). */
export async function createTestUser(
  opts: { roleCode?: string; password?: string; status?: UserStatus } = {},
): Promise<TestUser> {
  const password = opts.password ?? DEFAULT_PASSWORD;
  const role = await prisma.role.findUniqueOrThrow({ where: { code: opts.roleCode ?? 'OWNER' } });
  const branch = await prisma.branch.findUniqueOrThrow({ where: { code: MAIN_BRANCH_CODE } });
  const email = `user-${randomUUID()}@test.local`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      firstName: 'Usuario',
      lastName: 'Prueba',
      roleId: role.id,
      status: opts.status ?? 'ACTIVE',
      defaultBranchId: branch.id,
      branches: { create: { branchId: branch.id } },
    },
  });
  return { id: user.id, email, password };
}

/** Extrae cookies (nombre → {value, attrs}) de los headers Set-Cookie. */
export function parseSetCookies(res: Response): Record<string, { value: string; raw: string }> {
  const header = res.headers['set-cookie'] as unknown;
  const list = Array.isArray(header) ? (header as string[]) : typeof header === 'string' ? [header] : [];
  const out: Record<string, { value: string; raw: string }> = {};
  for (const raw of list) {
    const [pair] = raw.split(';');
    const idx = pair!.indexOf('=');
    out[pair!.slice(0, idx)] = { value: decodeURIComponent(pair!.slice(idx + 1)), raw };
  }
  return out;
}

export interface SessionCookies {
  rt: string;
  csrf: string;
}

export function sessionCookies(res: Response): SessionCookies {
  const cookies = parseSetCookies(res);
  return { rt: cookies.rt!.value, csrf: cookies.csrf_token!.value };
}

export function cookieHeader(c: SessionCookies): string {
  return `rt=${c.rt}; csrf_token=${c.csrf}`;
}
