import type { PrismaClient } from '../../src/generated/prisma/client';

/** Usuarios ficticios de demostración (no son personas reales). */
export const DEMO_USERS = [
  { email: 'admin@farmacia.local', firstName: 'Laura', lastName: 'Méndez Ruiz', role: 'ADMIN' },
  { email: 'farmaceutico@farmacia.local', firstName: 'Carlos', lastName: 'Ortega Lima', role: 'PHARMACIST' },
  { email: 'caja@farmacia.local', firstName: 'Sofía', lastName: 'Ramírez Torres', role: 'CASHIER' },
  { email: 'almacen@farmacia.local', firstName: 'Jorge', lastName: 'Salinas Vega', role: 'WAREHOUSE' },
] as const;

/** Crea los usuarios de demostración que no existan. Devuelve los correos creados. */
export async function seedDemoUsers(prisma: PrismaClient, passwordHash: string, branchId: string): Promise<string[]> {
  const created: string[] = [];
  for (const demo of DEMO_USERS) {
    if (await prisma.user.findUnique({ where: { email: demo.email } })) continue;
    const role = await prisma.role.findUniqueOrThrow({ where: { code: demo.role } });
    await prisma.user.create({
      data: {
        email: demo.email,
        passwordHash,
        firstName: demo.firstName,
        lastName: demo.lastName,
        roleId: role.id,
        defaultBranchId: branchId,
        branches: { create: { branchId } },
      },
    });
    created.push(demo.email);
  }
  return created;
}
