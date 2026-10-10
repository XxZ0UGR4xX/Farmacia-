import type { PrismaClient } from '../../src/generated/prisma/client';
import { demoBarcode } from './demo-catalog';

/**
 * 20 lotes de demostración repartidos para mostrar cada situación real:
 * varios lotes del mismo producto (FEFO), un lote caducado, lotes críticos (< 30 días),
 * próximos a caducar (30–90 días) y productos con stock bajo.
 * Cada lote nace con su movimiento de "carga inicial", igual que desde la aplicación.
 */

/** [índice del producto en DEMO_PRODUCTS (1-30), lote, cantidad, días para caducar] */
const DEMO_BATCHES: [number, string, number, number][] = [
  [1, 'PCT2504A', 15, 20], // Paracetamol 500: caduca pronto (crítico) → se vende primero
  [1, 'PCT2601B', 60, 400],
  [2, 'PCI2511', 12, 200],
  [3, 'MTZ2508', 8, 300], // Metamizol: bajo el mínimo (10)
  [4, 'IBU2502', 30, 45], // Ibuprofeno 400: próximo a caducar
  [4, 'IBU2609', 40, 500],
  [5, 'IBI2507', 5, 60], // Ibuprofeno infantil: bajo y próximo
  [6, 'NPX2603', 25, 365],
  [9, 'AMX2412', 6, -10], // Amoxicilina: lote caducado (no se vende)
  [9, 'AMX2510', 20, 250],
  [11, 'AZT2504', 10, 15], // Azitromicina: crítico
  [14, 'LRT2611', 35, 420],
  [16, 'OMP2705', 50, 600],
  [19, 'SRO2512', 80, 180],
  [20, 'LST2608', 24, 300],
  [23, 'MTF2601', 30, 100],
  [23, 'MTF2708', 40, 700],
  [25, 'CXB2505', 10, 80], // Complejo B: próximo
  [28, 'CLT2702', 8, 500],
  [30, 'AMB2506', 4, 70], // Ambroxol: bajo y próximo
];

function todayInMexico(): string {
  const tz = process.env.APP_TIMEZONE ?? 'America/Mexico_City';
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function addDays(iso: string, days: number): Date {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export async function seedDemoInventory(prisma: PrismaClient, branchId: string, userId: string): Promise<{ batches: number }> {
  const today = todayInMexico();
  let created = 0;
  for (const [index, lotNumber, quantity, days] of DEMO_BATCHES) {
    const product = await prisma.product.findUnique({ where: { barcode: demoBarcode(index) } });
    if (!product) continue;
    const exists = await prisma.productBatch.findUnique({
      where: { productId_branchId_lotNumber: { productId: product.id, branchId, lotNumber } },
    });
    if (exists) continue;

    await prisma.$transaction(async (tx) => {
      const expiresAt = addDays(today, days);
      const batch = await tx.productBatch.create({
        data: {
          productId: product.id,
          branchId,
          lotNumber,
          expiresAt,
          manufacturedAt: addDays(today, days - 730),
          quantity,
          initialQuantity: quantity,
          unitCost: product.purchasePrice,
          receivedAt: addDays(today, Math.min(-30, days - 700)),
        },
      });
      await tx.inventoryMovement.create({
        data: {
          branchId,
          productId: product.id,
          batchId: batch.id,
          type: 'INITIAL_STOCK',
          quantityBefore: 0,
          quantityChange: quantity,
          quantityAfter: quantity,
          unitCost: product.purchasePrice,
          referenceType: 'DEMO_SEED',
          notes: 'Carga inicial de demostración',
          userId,
          createdAt: batch.receivedAt,
        },
      });
    });
    created++;
  }
  return { batches: created };
}
