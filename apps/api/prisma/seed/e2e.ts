/**
 * Preparación de la base para las pruebas de punta a punta (npm run test:e2e).
 * Después del seed de demostración, deja al propietario y a los usuarios de demostración con una contraseña
 * conocida, sin cambio obligatorio y sin bloqueos, para que cada corrida empiece igual.
 *
 * Sólo corre sobre una base cuyo nombre contiene "e2e": nunca toca una base real.
 */
import { hashPassword } from '../../src/lib/crypto';
import { prisma } from '../../src/lib/prisma';
import { DEMO_USERS } from './demo';

async function main() {
  const database = new URL(process.env.DATABASE_URL ?? '').pathname.slice(1);
  if (!/e2e/i.test(database)) {
    throw new Error(`La base "${database}" no parece de pruebas E2E (su nombre debe contener "e2e")`);
  }
  const password = process.env.E2E_PASSWORD;
  if (!password) throw new Error('Define E2E_PASSWORD');

  const passwordHash = await hashPassword(password);
  const emails = [...DEMO_USERS.map((u) => u.email), process.env.SEED_OWNER_EMAIL].filter((e): e is string => Boolean(e));
  const { count } = await prisma.user.updateMany({
    where: { email: { in: emails } },
    data: { passwordHash, mustChangePassword: false, failedLoginAttempts: 0, lockedUntil: null, status: 'ACTIVE' },
  });
  console.log(`🧪 E2E: ${count} usuario(s) de demostración listos`);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
