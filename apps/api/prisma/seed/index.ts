/**
 * Seeder principal.
 *   npm run db:seed          catálogo base + propietario
 *   npm run db:seed:demo     además, datos ficticios de demostración (nunca en producción)
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
import { seedDemoCatalog } from './demo-catalog';
import { seedDemoInventory } from './demo-inventory';
import { seedDemoPatients } from './demo-patients';
import { seedDemoPurchases, seedDemoSuppliers } from './demo-purchases';
import { seedDemoSales } from './demo-sales';
import { DEMO_USERS, seedDemoUsers } from './demo';

config({ path: path.resolve(import.meta.dirname, '../../../../.env'), quiet: true });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL no está definida');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

async function main() {
  console.log('🌱 Sembrando catálogo de permisos y roles...');
  const newPermissions = await seedPermissions(prisma);
  await seedRoles(prisma, newPermissions);

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
  if (process.argv.includes('--demo') || process.env.SEED_DEMO === 'true') {
    await seedDemo(branch.id);
  }
  console.log('✅ Seed completado');
}

async function seedDemo(branchId: string) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Los datos de demostración no se pueden cargar en producción');
  }
  console.log('🧪 Datos de demostración...');
  let password = process.env.SEED_DEMO_PASSWORD;
  const generated = !password;
  if (!password) password = `${generateToken(9)}7d`;
  const policy = passwordPolicyErrors(password);
  if (policy.length) throw new Error(`SEED_DEMO_PASSWORD no cumple la política: ${policy.join(', ')}`);

  const created = await seedDemoUsers(prisma, await hashPassword(password), branchId);
  if (created.length === 0) {
    console.log('   Los usuarios de demostración ya existían (sin cambios).');
  } else {
    for (const email of created) {
      const demo = DEMO_USERS.find((d) => d.email === email)!;
      console.log(`   👤 ${email.padEnd(30)} ${demo.role}`);
    }
    if (generated) console.log(`   🔑 Contraseña de los usuarios demo (no se volverá a mostrar): ${password}`);
  }

  const catalog = await seedDemoCatalog(prisma, branchId);
  console.log(`   💊 Catálogo: 10 categorías, 10 laboratorios, ${catalog.products} medicamento(s) nuevo(s)`);

  // Los movimientos de la carga inicial quedan a nombre del propietario
  const owner = await prisma.user.findFirst({ where: { role: { code: 'OWNER' }, deletedAt: null }, orderBy: { createdAt: 'asc' } });
  if (owner) {
    const inventory = await seedDemoInventory(prisma, branchId, owner.id);
    console.log(`   📦 Inventario: ${inventory.batches} lote(s) nuevo(s) con su movimiento de carga inicial`);

    const supplierIds = await seedDemoSuppliers(prisma);
    // Las compras las captura el almacenista de demostración (o el propietario)
    const warehouse = await prisma.user.findUnique({ where: { email: 'almacen@farmacia.local' } });
    const purchases = await seedDemoPurchases(prisma, branchId, supplierIds, warehouse?.id ?? owner.id);
    console.log(`   🚚 Compras: ${supplierIds.length} proveedores, ${purchases.purchases} compra(s) nueva(s)`);

    // Ventas a nombre del propietario, la cajera y el farmacéutico de demostración
    const sellers = await prisma.user.findMany({
      where: { email: { in: ['caja@farmacia.local', 'farmaceutico@farmacia.local'] } },
      select: { id: true },
    });
    const sales = await seedDemoSales(prisma, branchId, [owner.id, ...sellers.map((s) => s.id)]);
    console.log(`   🧾 Ventas: ${sales.sales} venta(s) nueva(s) (con 2 cancelaciones y 2 devoluciones)`);

    const patients = await seedDemoPatients(prisma, branchId, owner.id);
    console.log(`   🩺 Pacientes ficticios: ${patients.patients} nuevo(s), ${patients.prescriptions} receta(s)`);
  }
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
