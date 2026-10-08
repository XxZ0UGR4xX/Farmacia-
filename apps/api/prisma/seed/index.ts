/**
 * Seeder principal.
 *   npm run db:seed
 *
 * Credenciales del propietario: SEED_OWNER_EMAIL / SEED_OWNER_PASSWORD (variables
 * de entorno). Si no se define la contraseña se genera una aleatoria y se muestra
 * UNA sola vez en consola. Nunca hay contraseñas fijas en el código fuente.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { passwordPolicyErrors } from '@farmacia/shared';
import { config } from 'dotenv';
import path from 'node:path';
import { generateToken, hashPassword } from '../../src/lib/crypto';
import { PrismaClient } from '../../src/generated/prisma/client';
import { seedMainBranch, seedOwner, seedPermissions, seedRoles, seedSettings } from './core';

config({ path: path.resolve(import.meta.dirname, '../../../../.env'), quiet: true });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL no está definida');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

async function main() {
  console.log('🌱 Sembrando catálogo de permisos y roles...');
  await seedPermissions(prisma);
  await seedRoles(prisma);

  console.log('🏥 Sucursal principal y configuración...');
  const branch = await seedMainBranch(prisma);
  await seedSettings(prisma);

  const email = process.env.SEED_OWNER_EMAIL ?? 'propietario@farmacia.local';
  let password = process.env.SEED_OWNER_PASSWORD;
  const generated = !password;
  if (!password) password = `${generateToken(9)}9a`;

  const policy = passwordPolicyErrors(password);
  if (policy.length) throw new Error(`SEED_OWNER_PASSWORD no cumple la política: ${policy.join(', ')}`);

  const created = await seedOwner(
    prisma,
    {
      email,
      passwordHash: await hashPassword(password),
      firstName: process.env.SEED_OWNER_FIRST_NAME ?? 'Doctor',
      lastName: process.env.SEED_OWNER_LAST_NAME ?? 'Propietario',
    },
    branch.id,
  );

  if (created) {
    console.log(`👤 Usuario propietario creado: ${email}`);
    if (generated) {
      console.log(`🔑 Contraseña generada (guárdala, no se volverá a mostrar): ${password}`);
    }
  } else {
    console.log(`👤 El usuario propietario ${email} ya existía (sin cambios).`);
  }
  console.log('✅ Seed completado');
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
