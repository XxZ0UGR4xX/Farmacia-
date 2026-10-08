import { config } from 'dotenv';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

// TEST_DATABASE_URL viene del .env de la raíz (local) o del entorno (CI)
config({ path: path.resolve(import.meta.dirname, '../../.env'), quiet: true });

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error('Define TEST_DATABASE_URL (base de datos de pruebas) en .env o en el entorno');
}

const testEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: testDatabaseUrl,
  JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
  APP_URL: 'http://localhost:5173',
  RATE_LIMIT_ENABLED: 'false',
  // Las imágenes subidas en pruebas no ensucian la carpeta del proyecto
  UPLOAD_DIR: path.join(tmpdir(), 'farmacia-test-uploads'),
  LOG_LEVEL: 'silent',
};

// globalSetup corre en el proceso principal: también necesita estas variables
Object.assign(process.env, testEnv);

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    // Las pruebas de integración comparten la base de datos de pruebas
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 120_000,
    env: testEnv,
  },
});
