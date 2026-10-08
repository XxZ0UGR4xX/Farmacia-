import { PrismaPg } from '@prisma/adapter-pg';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { PrismaClient } from '../src/generated/prisma/client';
import { seedMainBranch, seedPermissions, seedRoles, seedSettings } from '../prisma/seed/core';

/**
 * Aplica las migraciones pendientes a la base de datos de pruebas (no destructivo)
 * y siembra el catálogo base. Las pruebas crean datos únicos (correos aleatorios),
 * por lo que no dependen de una base vacía y pueden repetirse sin reiniciarla.
 */
export default async function setup() {
  const url = process.env.DATABASE_URL;
  if (!url || !/test/.test(url)) {
    throw new Error(`Las pruebas sólo pueden correr contra una base de datos de pruebas (url: ${url})`);
  }
  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    await seedPermissions(prisma);
    await seedRoles(prisma);
    await seedMainBranch(prisma);
    await seedSettings(prisma);
  } finally {
    await prisma.$disconnect();
  }
}
