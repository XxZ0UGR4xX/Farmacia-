import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAIN_BRANCH_CODE } from '../../prisma/seed/core';
import { prisma } from '../../src/lib/prisma';
import { createTestUser } from '../helpers';

/**
 * Reglas de integridad garantizadas por PostgreSQL (CHECK + triggers),
 * independientes del código de la aplicación.
 */
let branchId: string;
let userId: string;
let batchId: string;
let productId: string;

beforeAll(async () => {
  branchId = (await prisma.branch.findUniqueOrThrow({ where: { code: MAIN_BRANCH_CODE } })).id;
  userId = (await createTestUser()).id;
  const category = await prisma.category.create({ data: { name: `Cat ${Date.now()}` } });
  const product = await prisma.product.create({
    data: {
      sku: `SKU-${Date.now()}`,
      commercialName: 'Paracetamol 500 mg',
      categoryId: category.id,
      presentation: 'BOX',
      salePrice: 45,
    },
  });
  productId = product.id;
  const batch = await prisma.productBatch.create({
    data: {
      productId,
      branchId,
      lotNumber: 'L-001',
      expiresAt: new Date('2028-01-31'),
      quantity: 10,
      initialQuantity: 10,
      unitCost: 20,
    },
  });
  batchId = batch.id;
});

afterAll(() => prisma.$disconnect());

describe('reglas de integridad en base de datos', () => {
  it('no permite stock negativo en un lote', async () => {
    await expect(
      prisma.productBatch.update({ where: { id: batchId }, data: { quantity: -1 } }),
    ).rejects.toThrow();
  });

  it('los movimientos deben cuadrar (después = antes + cambio)', async () => {
    await expect(
      prisma.inventoryMovement.create({
        data: {
          branchId,
          productId,
          batchId,
          userId,
          type: 'ADJUSTMENT_IN',
          quantityBefore: 10,
          quantityChange: 5,
          quantityAfter: 20,
        },
      }),
    ).rejects.toThrow();
  });

  it('los movimientos de inventario son inmutables', async () => {
    const movement = await prisma.inventoryMovement.create({
      data: {
        branchId,
        productId,
        batchId,
        userId,
        type: 'INITIAL_STOCK',
        quantityBefore: 0,
        quantityChange: 10,
        quantityAfter: 10,
      },
    });
    await expect(
      prisma.inventoryMovement.update({ where: { id: movement.id }, data: { notes: 'alterado' } }),
    ).rejects.toThrow(/inmutable/);
    await expect(prisma.inventoryMovement.delete({ where: { id: movement.id } })).rejects.toThrow(
      /inmutable/,
    );
  });

  it('la bitácora de auditoría es inmutable', async () => {
    const log = await prisma.auditLog.create({ data: { action: 'AUTH_LOGIN', userId } });
    await expect(
      prisma.auditLog.update({ where: { id: log.id }, data: { action: 'OTRA' } }),
    ).rejects.toThrow(/inmutable/);
    await expect(prisma.auditLog.deleteMany({})).rejects.toThrow(/inmutable/);
  });

  it('no permite lotes duplicados del mismo producto en la misma sucursal', async () => {
    await expect(
      prisma.productBatch.create({
        data: {
          productId,
          branchId,
          lotNumber: 'L-001',
          expiresAt: new Date('2029-01-31'),
          quantity: 1,
          initialQuantity: 1,
          unitCost: 20,
        },
      }),
    ).rejects.toThrow();
  });

  it('los correos de usuario se guardan en minúsculas', async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: 'CASHIER' } });
    await expect(
      prisma.user.create({
        data: {
          email: 'Mayusculas@Test.local',
          passwordHash: 'x',
          firstName: 'A',
          lastName: 'B',
          roleId: role.id,
        },
      }),
    ).rejects.toThrow();
  });
});
