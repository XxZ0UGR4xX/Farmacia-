import { randomBytes } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';
import { API_PORT, BASE_URL, E2E_PASSWORD, OWNER_EMAIL, WEB_PORT } from './e2e/support/constants';

/**
 * Pruebas de punta a punta: navegador real contra la API y la interfaz compiladas.
 *
 *   E2E_DATABASE_URL=postgresql://usuario:clave@localhost:5432/farmacia_e2e npm run test:e2e
 *
 * La base (su nombre debe contener "e2e") se migra, recibe los datos de demostración y las
 * contraseñas conocidas de abajo. La API corre en el puerto 4100 y la interfaz en 4174, así que
 * no choca con los servidores de desarrollo.
 */
const databaseUrl = process.env.E2E_DATABASE_URL;
if (!databaseUrl) throw new Error('Define E2E_DATABASE_URL (una base de datos exclusiva para estas pruebas)');

const apiEnv = {
  NODE_ENV: 'development',
  PORT: String(API_PORT),
  DATABASE_URL: databaseUrl,
  JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
  APP_URL: BASE_URL,
  CORS_ORIGIN: BASE_URL,
  COOKIE_SECURE: 'false',
  // Muchas pruebas inician sesión seguido: el límite por IP se prueba en las de integración
  RATE_LIMIT_ENABLED: 'false',
  LOG_LEVEL: 'warn',
  SEED_OWNER_EMAIL: OWNER_EMAIL,
  SEED_OWNER_PASSWORD: E2E_PASSWORD,
  SEED_DEMO_PASSWORD: E2E_PASSWORD,
  E2E_PASSWORD,
};

export default defineConfig({
  testDir: './e2e',
  // Comparten una base de datos (configuración global, existencias): una prueba a la vez
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    locale: 'es-MX',
    timezoneId: 'America/Mexico_City',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } } }],
  webServer: [
    {
      // Migraciones, datos de demostración y usuarios listos antes de arrancar la API
      command:
        'npx prisma generate && npx prisma migrate deploy && npx prisma db seed -- --demo && npx tsx prisma/seed/e2e.ts && npx tsx src/server.ts',
      cwd: 'apps/api',
      url: `http://localhost:${API_PORT}/api/health`,
      env: apiEnv,
      timeout: 180_000,
      reuseExistingServer: false,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: `npx vite build && npx vite preview --port ${WEB_PORT} --strictPort`,
      cwd: 'apps/web',
      url: BASE_URL,
      env: { API_PROXY_TARGET: `http://localhost:${API_PORT}` },
      timeout: 180_000,
      reuseExistingServer: false,
    },
  ],
});
