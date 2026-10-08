import { config } from 'dotenv';
import path from 'node:path';
import { defineConfig, env } from 'prisma/config';

// Variables de entorno desde la raíz del monorepo (si existe .env)
config({ path: path.resolve(import.meta.dirname, '../../.env'), quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed/index.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
