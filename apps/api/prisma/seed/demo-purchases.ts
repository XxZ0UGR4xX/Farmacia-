import { formatPurchaseNumber, paymentStatusFor, purchaseLineAmounts, purchaseTotals } from '@farmacia/shared';
import type { PaymentMethod, PrismaClient, PurchaseStatus } from '../../src/generated/prisma/client';
import { demoBarcode } from './demo-catalog';

/**
 * 10 proveedores ficticios y 20 compras de demostración que muestran cada situación:
 * compras recibidas de contado y a crédito, un crédito vencido, un pago parcial,
 * pedidos pendientes de recibir y una compra cancelada.
 * Las compras recibidas generan sus lotes y movimientos de "entrada por compra",
 * igual que desde la aplicación. Los RFC usan el prefijo DMO (de demostración).
 */

export const DEMO_SUPPLIERS = [
  { tradeName: 'Distribuidora Farmacéutica del Valle', legalName: 'Distribuidora Farmacéutica del Valle, S.A. de C.V.', rfc: 'DMO850101AA1', contactName: 'Mariana Ruiz', creditDays: 30 },
  { tradeName: 'Medicamentos Integrales del Centro', legalName: 'Medicamentos Integrales del Centro, S.A. de C.V.', rfc: 'DMO860202BB2', contactName: 'Roberto Díaz', creditDays: 15 },
  { tradeName: 'Farmadistribución Occidente', legalName: 'Farmadistribución Occidente, S. de R.L.', rfc: 'DMO870303CC3', contactName: 'Lucía Herrera', creditDays: 30 },
  { tradeName: 'Abastecedora Médica Nacional', legalName: 'Abastecedora Médica Nacional, S.A.', rfc: 'DMO880404DD4', contactName: 'Fernando Castillo', creditDays: 45 },
  { tradeName: 'Genéricos y Más', legalName: 'Genéricos y Más, S.A. de C.V.', rfc: 'DMO890505EE5', contactName: 'Patricia Morales', creditDays: 0 },
  { tradeName: 'Droguería La Esperanza', legalName: 'Droguería La Esperanza, S.A. de C.V.', rfc: 'DMO900606FF6', contactName: 'Jorge Navarro', creditDays: 30 },
  { tradeName: 'Suministros Hospitalarios del Bajío', legalName: 'Suministros Hospitalarios del Bajío, S.A.', rfc: 'DMO910707GG7', contactName: 'Elena Vargas', creditDays: 60 },
  { tradeName: 'Vitaminas y Naturales Express', legalName: 'Vitaminas y Naturales Express, S. de R.L.', rfc: 'DMO920808HH8', contactName: 'Andrés Peña', creditDays: 0 },
  { tradeName: 'Comercializadora Dermo Salud', legalName: 'Comercializadora Dermo Salud, S.A. de C.V.', rfc: 'DMO930909JJ9', contactName: 'Silvia Romero', creditDays: 20 },
  { tradeName: 'Farmacéutica Regional del Sur', legalName: 'Farmacéutica Regional del Sur, S.A. de C.V.', rfc: 'DMO941010KK1', contactName: 'Miguel Ángel Soto', creditDays: 30 },
] as const;

type Kind = 'CASH' | 'CREDIT_PAID' | 'CREDIT_PENDING' | 'CREDIT_PARTIAL' | 'ORDERED' | 'CANCELLED';

/** [proveedor (0-9), días atrás, tipo, partidas: [producto (1-30), cantidad, días para caducar]] */
const DEMO_PURCHASES: [number, number, Kind, [number, number, number][]][] = [
  [0, 88, 'CREDIT_PAID', [[2, 24, 420], [4, 30, 500]]],
  [1, 84, 'CASH', [[7, 20, 380], [8, 15, 450]]],
  [2, 80, 'CREDIT_PAID', [[10, 12, 300], [12, 18, 520]]],
  [4, 76, 'CASH', [[13, 25, 600]]],
  [7, 71, 'CASH', [[24, 30, 365], [26, 20, 400]]],
  [3, 66, 'CREDIT_PAID', [[14, 20, 480], [15, 16, 540], [16, 24, 610]]],
  [5, 60, 'CASH', [[17, 10, 330]]],
  [0, 55, 'CREDIT_PENDING', [[18, 14, 450], [19, 40, 200]]], // vencido (30 días de crédito)
  [8, 49, 'CASH', [[27, 12, 700], [28, 10, 650]]],
  [9, 43, 'CREDIT_PAID', [[21, 20, 400], [22, 15, 380]]],
  [6, 38, 'CREDIT_PARTIAL', [[20, 24, 500], [23, 30, 560]]],
  [1, 32, 'CASH', [[6, 20, 420]]],
  [2, 26, 'CREDIT_PENDING', [[29, 18, 480]]],
  [4, 20, 'CASH', [[2, 20, 520], [12, 10, 610]]],
  [7, 14, 'CASH', [[25, 15, 300]]],
  [3, 9, 'CREDIT_PENDING', [[7, 10, 640], [16, 12, 700]]],
  [5, 6, 'CANCELLED', [[8, 10, 0]]],
  [0, 4, 'ORDERED', [[3, 30, 0], [5, 24, 0]]], // pedido de lo que está bajo
  [9, 2, 'ORDERED', [[30, 20, 0]]],
  [6, 1, 'ORDERED', [[11, 20, 0], [9, 20, 0]]],
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

export async function seedDemoSuppliers(prisma: PrismaClient): Promise<string[]> {
  const ids: string[] = [];
  for (const [i, s] of DEMO_SUPPLIERS.entries()) {
    const existing = await prisma.supplier.findUnique({ where: { rfc: s.rfc } });
    const saved =
      existing ??
      (await prisma.supplier.create({
        data: {
          ...s,
          phone: `55 5${String(100 + i).padStart(3, '0')} ${String(2000 + i * 37).slice(0, 4)}`,
          email: `ventas${i + 1}@proveedor-demo.local`,
          paymentTerms: s.creditDays > 0 ? `Crédito a ${s.creditDays} días` : 'Contado',
          address: 'Dirección de demostración',
        },
      }));
    ids.push(saved.id);
  }
  return ids;
}

export async function seedDemoPurchases(
  prisma: PrismaClient,
  branchId: string,
  supplierIds: string[],
  userId: string,
): Promise<{ purchases: number }> {
  if ((await prisma.purchase.count({ where: { supplierId: { in: supplierIds } } })) > 0) return { purchases: 0 };
  const today = todayInMexico();
  let created = 0;

  for (const [index, [supplierIndex, daysAgo, kind, lines]] of DEMO_PURCHASES.entries()) {
    const supplier = await prisma.supplier.findUniqueOrThrow({ where: { id: supplierIds[supplierIndex]! } });
    const products = await Promise.all(lines.map(([p]) => prisma.product.findUnique({ where: { barcode: demoBarcode(p) } })));
    if (products.some((p) => !p)) continue;

    const purchaseDate = addDays(today, -daysAgo);
    const received = kind !== 'ORDERED' && kind !== 'CANCELLED';
    const status: PurchaseStatus = kind === 'ORDERED' ? 'ORDERED' : kind === 'CANCELLED' ? 'CANCELLED' : 'RECEIVED';
    const paymentMethod: PaymentMethod = kind === 'CASH' ? (index % 2 ? 'CASH' : 'TRANSFER') : 'CREDIT';
    const items = lines.map(([productIndex, quantity, expiryDays], i) => {
      const product = products[i]!;
      const unitCost = Number(product.purchasePrice);
      const taxRate = Number(product.taxRate);
      const amounts = purchaseLineAmounts({ quantity, unitCost, taxRate });
      return {
        position: i,
        product,
        quantity,
        unitCost,
        taxRate,
        amounts,
        lotNumber: received ? `C${String(index + 1).padStart(2, '0')}${String(productIndex).padStart(2, '0')}${daysAgo}` : null,
        expiresAt: received ? addDays(today, expiryDays) : null,
      };
    });
    const totals = purchaseTotals(items.map((i) => ({ quantity: i.quantity, unitCost: i.unitCost, taxRate: i.taxRate })));
    const paymentDueDate = paymentMethod === 'CREDIT' ? addDays(today, -daysAgo + supplier.creditDays) : null;
    const amountPaid =
      kind === 'CASH' || kind === 'CREDIT_PAID' ? totals.total : kind === 'CREDIT_PARTIAL' ? Math.round(totals.total * 40) / 100 : 0;

    await prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.create({
        data: {
          branchId,
          supplierId: supplier.id,
          invoiceNumber: kind === 'ORDERED' ? null : `FD-${String(5000 + index * 13)}`,
          purchaseDate,
          status,
          paymentMethod,
          paymentStatus: paymentStatusFor(totals.total, amountPaid),
          paymentDueDate,
          ...totals,
          amountPaid,
          notes: kind === 'CANCELLED' ? 'Cancelada: el proveedor no tenía existencia' : null,
          createdById: userId,
          receivedById: received ? userId : null,
          receivedAt: received ? new Date(purchaseDate.getTime() + 15 * 3600_000) : null,
          cancelledAt: kind === 'CANCELLED' ? new Date(purchaseDate.getTime() + 20 * 3600_000) : null,
          createdAt: new Date(purchaseDate.getTime() + 14 * 3600_000),
        },
      });
      const folio = formatPurchaseNumber(purchase.number);

      for (const item of items) {
        let batchId: string | null = null;
        if (received) {
          const batch = await tx.productBatch.create({
            data: {
              productId: item.product.id,
              branchId,
              supplierId: supplier.id,
              lotNumber: item.lotNumber!,
              expiresAt: item.expiresAt!,
              quantity: item.quantity,
              initialQuantity: item.quantity,
              unitCost: item.unitCost,
              receivedAt: purchase.receivedAt!,
            },
          });
          batchId = batch.id;
          await tx.inventoryMovement.create({
            data: {
              branchId,
              productId: item.product.id,
              batchId,
              type: 'PURCHASE_ENTRY',
              quantityBefore: 0,
              quantityChange: item.quantity,
              quantityAfter: item.quantity,
              unitCost: item.unitCost,
              notes: `Compra ${folio} · factura ${purchase.invoiceNumber}`,
              referenceType: 'PURCHASE',
              referenceId: purchase.id,
              userId,
              createdAt: purchase.receivedAt!,
            },
          });
        }
        await tx.purchaseItem.create({
          data: {
            purchaseId: purchase.id,
            position: item.position,
            productId: item.product.id,
            batchId,
            lotNumber: item.lotNumber,
            expiresAt: item.expiresAt,
            quantity: item.quantity,
            unitCost: item.unitCost,
            taxRate: item.taxRate,
            taxAmount: item.amounts.taxAmount,
            subtotal: item.amounts.subtotal,
            total: item.amounts.total,
          },
        });
      }

      if (amountPaid > 0) {
        await tx.purchasePayment.create({
          data: {
            purchaseId: purchase.id,
            amount: amountPaid,
            method: paymentMethod === 'CREDIT' ? 'TRANSFER' : paymentMethod,
            reference: paymentMethod === 'CREDIT' ? `SPEI ${100200 + index}` : 'Pago al recibir',
            paidAt: kind === 'CASH' ? purchase.receivedAt! : addDays(today, -Math.max(1, daysAgo - supplier.creditDays + 2)),
            userId,
          },
        });
      }
    });
    created++;
  }
  return { purchases: created };
}
