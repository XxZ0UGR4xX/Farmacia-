import { cashChange, saleLineAmounts, saleTotals } from '@farmacia/shared';
import type { PaymentMethod, PrismaClient } from '../../src/generated/prisma/client';
import { demoBarcode } from './demo-catalog';

/**
 * 50 ventas de demostración en los últimos 30 días (algunas de hoy), surtidas con FEFO
 * igual que el punto de venta: nunca de lotes caducados ni de lotes que aún no llegaban.
 * Incluye 2 ventas canceladas y 2 devoluciones (una en revisión y una que regresó al inventario).
 * Se generan con un aleatorio con semilla: siempre salen iguales.
 */

const SALES = 50;
const DEMO_PREFIX = 'demo-sale-';

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mexicoParts(d = new Date()) {
  const tz = process.env.APP_TIMEZONE ?? 'America/Mexico_City';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Hora local de la farmacia (México no usa horario de verano: UTC−6). */
const localTime = (date: string, minutes: number) =>
  new Date(`${date}T${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00-06:00`);

export async function seedDemoSales(prisma: PrismaClient, branchId: string, sellerIds: string[]): Promise<{ sales: number }> {
  if (await prisma.sale.findUnique({ where: { clientRequestId: `${DEMO_PREFIX}1` } })) return { sales: 0 };
  const rand = mulberry32(20261008);
  const pick = <T,>(list: T[]) => list[Math.floor(rand() * list.length)]!;
  const { date: today, minutes: nowMinutes } = mexicoParts();
  const taxes = await prisma.setting.findUnique({ where: { key: 'pharmacy.taxes' } });
  const pricesIncludeTax = (taxes?.value as { pricesIncludeTax?: boolean } | null)?.pricesIncludeTax ?? true;

  // Momentos de venta en orden cronológico: 46 en los últimos 30 días y 4 de hoy
  const moments: Date[] = [];
  for (let i = 0; i < SALES - 4; i++) moments.push(localTime(addDays(today, -1 - Math.floor(rand() * 30)), 9 * 60 + Math.floor(rand() * 12 * 60)));
  const todayEnd = Math.max(9 * 60 + 30, nowMinutes - 15);
  for (let i = 0; i < 4; i++) moments.push(localTime(today, Math.min(todayEnd, 9 * 60 + Math.floor(rand() * Math.max(30, todayEnd - 9 * 60)))));
  moments.sort((a, b) => a.getTime() - b.getTime());
  const now = new Date();
  for (const [i, m] of moments.entries()) if (m > now) moments[i] = new Date(now.getTime() - (moments.length - i) * 60_000);

  // Se conservan los casos de demostración del inventario: stock bajo (Metamizol, Ibuprofeno
  // infantil, Ambroxol) y el lote caducado, que no se toca porque sólo se vende lo vigente hoy
  const keepAsIs = [3, 5, 30].map(demoBarcode);
  const products = await prisma.product.findMany({
    where: { deletedAt: null, status: 'ACTIVE', barcode: { startsWith: '200', notIn: keepAsIs } },
    select: { id: true, salePrice: true, taxRate: true, requiresPrescription: true, isControlled: true },
  });

  let created = 0;
  for (const [index, at] of moments.entries()) {
    // Lotes vendibles en ese momento: activos, con existencia, sin caducar y ya recibidos
    const batches = await prisma.productBatch.findMany({
      where: { branchId, status: 'ACTIVE', quantity: { gt: 0 }, expiresAt: { gte: new Date(`${today}T00:00:00Z`) }, receivedAt: { lte: at } },
      orderBy: [{ expiresAt: 'asc' }, { receivedAt: 'asc' }],
    });
    const stockByProduct = new Map<string, typeof batches>();
    for (const b of batches) stockByProduct.set(b.productId, [...(stockByProduct.get(b.productId) ?? []), b]);
    const candidates = products.filter((p) => stockByProduct.has(p.id));
    if (candidates.length === 0) continue;

    const lineCount = 1 + Math.floor(rand() * 3);
    const chosen = [...new Set(Array.from({ length: lineCount }, () => pick(candidates)))];
    const lines = chosen.map((p) => {
      const available = stockByProduct.get(p.id)!.reduce((s, b) => s + b.quantity, 0);
      return { product: p, quantity: Math.min(available, 1 + Math.floor(rand() * 3)) };
    });
    const priced = lines.map((l) => ({ quantity: l.quantity, unitPrice: Number(l.product.salePrice), taxRate: Number(l.product.taxRate) }));
    const totals = saleTotals(priced, pricesIncludeTax);
    const roll = rand();
    const method: PaymentMethod = roll < 0.6 ? 'CASH' : roll < 0.9 ? 'CARD' : 'TRANSFER';
    const received = method === 'CASH' ? ([50, 100, 200, 500].find((bill) => bill >= totals.total) ?? Math.ceil(totals.total)) : null;
    const sellerId = sellerIds[index % sellerIds.length]!;

    const result = await prisma.$transaction(async (tx) => {
      const sale = await tx.sale.create({
        data: {
          branchId,
          subtotal: totals.subtotal,
          discountTotal: 0,
          taxTotal: totals.taxTotal,
          total: totals.total,
          costTotal: 0,
          prescriptionChecked: lines.some((l) => l.product.requiresPrescription || l.product.isControlled),
          clientRequestId: `${DEMO_PREFIX}${index + 1}`,
          createdById: sellerId,
          createdAt: at,
        },
      });
      let costTotal = 0;
      const items: SeededItem[] = [];
      for (const [position, line] of lines.entries()) {
        let pending = line.quantity;
        const used: { batchId: string; quantity: number; unitCost: number }[] = [];
        for (const b of stockByProduct.get(line.product.id)!) {
          if (pending === 0) break;
          const take = Math.min(b.quantity, pending);
          pending -= take;
          used.push({ batchId: b.id, quantity: take, unitCost: Number(b.unitCost) });
          const after = b.quantity - take;
          await tx.productBatch.update({ where: { id: b.id }, data: { quantity: after, status: after === 0 ? 'DEPLETED' : 'ACTIVE' } });
          await tx.inventoryMovement.create({
            data: {
              branchId,
              productId: line.product.id,
              batchId: b.id,
              type: 'SALE',
              quantityBefore: b.quantity,
              quantityChange: -take,
              quantityAfter: after,
              unitCost: b.unitCost,
              notes: `Venta V-${String(sale.number).padStart(6, '0')}`,
              referenceType: 'SALE',
              referenceId: sale.id,
              userId: sellerId,
              createdAt: at,
            },
          });
          b.quantity = after;
        }
        const lineCost = used.reduce((s, u) => s + u.quantity * u.unitCost, 0);
        costTotal += lineCost;
        const amounts = saleLineAmounts(priced[position]!, pricesIncludeTax);
        const saleItem = await tx.saleItem.create({
          data: {
            saleId: sale.id,
            position,
            productId: line.product.id,
            quantity: line.quantity,
            unitPrice: priced[position]!.unitPrice,
            taxRate: priced[position]!.taxRate,
            taxAmount: amounts.taxAmount,
            subtotal: amounts.subtotal,
            total: amounts.total,
            unitCost: Math.round((lineCost / line.quantity) * 10_000) / 10_000,
            batches: { create: used.map((u) => ({ batchId: u.batchId, quantity: u.quantity, unitCost: u.unitCost })) },
          },
        });
        items.push({ id: saleItem.id, productId: line.product.id, quantity: line.quantity, total: amounts.total, used });
      }
      await tx.sale.update({ where: { id: sale.id }, data: { costTotal: Math.round(costTotal * 100) / 100 } });
      await tx.salePayment.create({
        data: {
          saleId: sale.id,
          method,
          amount: totals.total,
          received,
          change: received === null ? null : cashChange(received, totals.total),
          reference: method === 'CARD' ? `****${String(1000 + index * 37).slice(-4)}` : method === 'TRANSFER' ? `SPEI ${880000 + index}` : null,
          createdAt: at,
        },
      });
      return { id: sale.id, number: sale.number, items };
    });
    created++;

    // Cancelaciones y devoluciones ocurren antes de la siguiente venta (el historial queda en orden)
    const next = moments[index + 1]?.getTime() ?? Date.now();
    const after = new Date(Math.min(at.getTime() + 10 * 60_000, next - 30_000, Date.now() - 30_000));
    if (CANCEL_AT.has(index)) await cancelDemoSale(prisma, branchId, sellerIds[0]!, result, after);
    if (RETURN_AT.has(index)) await returnDemoSale(prisma, branchId, sellerIds[0]!, result, after, RETURN_AT.get(index)!);
  }
  return { sales: created };
}

interface SeededItem {
  id: string;
  productId: string;
  quantity: number;
  total: number;
  used: { batchId: string; quantity: number; unitCost: number }[];
}
interface SeededSale {
  id: string;
  number: number;
  items: SeededItem[];
}

/** Ventas (por posición cronológica) que se cancelan o devuelven: 2 y 2. */
const CANCEL_AT = new Set([5, 17]);
const RETURN_AT = new Map<number, 'RESTOCKED' | 'QUARANTINE'>([
  [24, 'RESTOCKED'],
  [33, 'QUARANTINE'],
]);

const folio = (prefix: string, n: number) => `${prefix}-${String(n).padStart(6, '0')}`;

async function cancelDemoSale(prisma: PrismaClient, branchId: string, userId: string, sale: SeededSale, at: Date) {
  await prisma.$transaction(async (tx) => {
    for (const item of sale.items) {
      for (const u of item.used) {
        const batch = await tx.productBatch.findUniqueOrThrow({ where: { id: u.batchId } });
        await tx.productBatch.update({ where: { id: batch.id }, data: { quantity: batch.quantity + u.quantity, status: batch.status === 'DEPLETED' ? 'ACTIVE' : batch.status } });
        await tx.inventoryMovement.create({
          data: {
            branchId,
            productId: item.productId,
            batchId: batch.id,
            type: 'SALE_CANCELLATION',
            quantityBefore: batch.quantity,
            quantityChange: u.quantity,
            quantityAfter: batch.quantity + u.quantity,
            unitCost: batch.unitCost,
            notes: `Cancelación de la venta ${folio('V', sale.number)}: cobro duplicado`,
            referenceType: 'SALE_CANCEL',
            referenceId: sale.id,
            userId,
            createdAt: at,
          },
        });
      }
    }
    await tx.sale.update({ where: { id: sale.id }, data: { status: 'CANCELLED', cancelledById: userId, cancelledAt: at, cancelReason: 'Cobro duplicado' } });
  });
}

async function returnDemoSale(prisma: PrismaClient, branchId: string, userId: string, sale: SeededSale, at: Date, disposition: 'RESTOCKED' | 'QUARANTINE') {
  const item = sale.items[0]!;
  const used = item.used.at(-1)!;
  const restock = disposition === 'RESTOCKED';
  const refund = item.quantity === 1 ? item.total : Math.round((item.total / item.quantity) * 100) / 100;
  await prisma.$transaction(async (tx) => {
    const ret = await tx.return.create({
      data: {
        saleId: sale.id,
        branchId,
        userId,
        reason: restock ? 'El cliente compró de más; empaque sellado' : 'El cliente reporta empaque dañado',
        refundTotal: refund,
        refundMethod: 'CASH',
        createdAt: at,
      },
    });
    await tx.returnItem.create({
      data: {
        returnId: ret.id,
        saleItemId: item.id,
        batchId: used.batchId,
        quantity: 1,
        refundAmount: refund,
        disposition,
        ...(restock ? { reviewedAt: at, reviewedById: userId, reviewNotes: 'Empaque sellado, regresa a la venta' } : {}),
      },
    });
    if (restock) {
      const batch = await tx.productBatch.findUniqueOrThrow({ where: { id: used.batchId } });
      await tx.productBatch.update({ where: { id: batch.id }, data: { quantity: batch.quantity + 1, status: batch.status === 'DEPLETED' ? 'ACTIVE' : batch.status } });
      await tx.inventoryMovement.create({
        data: {
          branchId,
          productId: item.productId,
          batchId: batch.id,
          type: 'CUSTOMER_RETURN',
          quantityBefore: batch.quantity,
          quantityChange: 1,
          quantityAfter: batch.quantity + 1,
          unitCost: batch.unitCost,
          notes: `Devolución ${folio('D', ret.number)}: regresa al inventario`,
          referenceType: 'RETURN',
          referenceId: ret.id,
          userId,
          createdAt: at,
        },
      });
    }
    await tx.saleItem.update({ where: { id: item.id }, data: { returnedQty: 1 } });
    const allReturned = sale.items.length === 1 && item.quantity === 1;
    await tx.sale.update({ where: { id: sale.id }, data: { status: allReturned ? 'RETURNED' : 'PARTIALLY_RETURNED' } });
  });
}
