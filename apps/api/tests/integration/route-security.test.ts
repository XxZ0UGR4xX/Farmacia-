import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';

/**
 * Revisión automática de seguridad: lee TODAS las rutas declaradas en el código y comprueba
 * que ninguna responda sin sesión (salvo las públicas de autenticación). Si mañana se agrega
 * una ruta y se olvida `authenticate`, esta prueba falla.
 */
const SRC = join(__dirname, '../../src');
const app = createApp({ rateLimitEnabled: false });

/** Rutas que deben funcionar sin sesión (iniciar sesión, renovar con cookie, recuperar contraseña). */
const PUBLIC = new Set(['POST /api/v1/auth/login', 'POST /api/v1/auth/refresh', 'POST /api/v1/auth/logout', 'POST /api/v1/auth/forgot-password', 'POST /api/v1/auth/reset-password']);

function declaredRoutes(): { method: string; path: string }[] {
  const appSource = readFileSync(join(SRC, 'app.ts'), 'utf8');
  // función del router → archivo
  const files = new Map<string, string>();
  for (const m of appSource.matchAll(/import \{([^}]+)\} from '(\.\/modules\/[^']+\.routes)';/g)) {
    for (const name of m[1]!.split(',').map((s) => s.trim()).filter(Boolean)) files.set(name, join(SRC, `${m[2]}.ts`));
  }
  const routes: { method: string; path: string }[] = [];
  for (const m of appSource.matchAll(/app\.use\('(\/api\/v1\/[^']+)'[^;]*?(\w+Router)\(/g)) {
    const [, prefix, fn] = m;
    const file = files.get(fn!);
    if (!file) throw new Error(`No se encontró el archivo de ${fn}`);
    const source = readFileSync(file, 'utf8');
    // Sólo el cuerpo de esa función (un archivo puede declarar varios routers)
    const start = source.search(new RegExp(`export function ${fn}\\(`));
    const next = source.slice(start + 1).search(/\nexport function /);
    const body = next === -1 ? source.slice(start) : source.slice(start, start + 1 + next);
    for (const r of body.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)) {
      routes.push({ method: r[1]!.toUpperCase(), path: `${prefix}${r[2] === '/' ? '' : r[2]}`.replace(/:\w+/g, randomUUID()) });
    }
  }
  return routes;
}

describe('Seguridad de rutas', () => {
  const routes = declaredRoutes();

  it('se detectan las rutas de todos los módulos', () => {
    expect(routes.length).toBeGreaterThanOrEqual(90);
    for (const prefix of ['/api/v1/sales', '/api/v1/patients', '/api/v1/reports', '/api/v1/audit', '/api/v1/settings']) {
      expect(routes.some((r) => r.path.startsWith(prefix))).toBe(true);
    }
  });

  it('ninguna ruta privada responde sin sesión', async () => {
    const open: string[] = [];
    for (const r of routes) {
      const key = `${r.method} ${r.path.replace(/[0-9a-f-]{36}/g, ':id')}`;
      if (PUBLIC.has(key)) continue;
      const res = await request(app)[r.method.toLowerCase() as 'get'](r.path).send({});
      if (res.status !== 401) open.push(`${key} → ${res.status}`);
    }
    expect(open).toEqual([]);
  });

  it('un token falso o manipulado no da acceso', async () => {
    const fake = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4Iiwicm9sZSI6Ik9XTkVSIn0.firma-falsa';
    for (const path of ['/api/v1/reports/dashboard', '/api/v1/audit', '/api/v1/patients']) {
      expect((await request(app).get(path).set('Authorization', `Bearer ${fake}`)).status).toBe(401);
    }
  });

  it('errores sin detalles internos y cabeceras de seguridad', async () => {
    const res = await request(app).get('/api/v1/no-existe');
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/stack|at \w+ \(|node_modules/);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
