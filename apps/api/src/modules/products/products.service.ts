import { computeMargin, hasPermission, normalizeSearch, type PermissionKey } from '@farmacia/shared';
import type { Prisma } from '../../generated/prisma/client';
import { prisma, type DbClient } from '../../lib/prisma';
import { AppError } from '../../shared/errors';
import { paginated, toSkipTake, type Paginated } from '../../shared/pagination';
import type { AuthContext, ClientInfo } from '../../shared/request-context';
import { recordAudit } from '../audit/audit.service';
import { getSetting } from '../settings/settings.service';
import { buildSearchText } from './search-text';
import type { CreateProductDto, ListProductsDto, UpdateProductDto } from './products.schemas';

// -----------------------------------------------------------------------------
// DTO
// -----------------------------------------------------------------------------

const productInclude = {
  category: { select: { id: true, name: true } },
  laboratory: { select: { id: true, name: true } },
} satisfies Prisma.ProductInclude;

type ProductRow = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

export type StockStatus = 'OUT' | 'LOW' | 'OK';

export interface ProductDto {
  id: string;
  sku: string;
  barcode: string | null;
  commercialName: string;
  genericName: string | null;
  activeIngredient: string | null;
  category: { id: string; name: string };
  presentation: string;
  concentration: string | null;
  pharmaceuticalForm: string | null;
  contentQuantity: string | null;
  laboratory: { id: string; name: string } | null;
  manufacturer: string | null;
  salePrice: number;
  taxRate: number;
  /** Sólo para quien puede ver costos */
  purchasePrice?: number;
  margin?: ReturnType<typeof computeMargin>;
  requiresPrescription: boolean;
  isControlled: boolean;
  status: string;
  imageUrl: string | null;
  description: string | null;
  indications: string | null;
  observations: string | null;
  /** Existencias de la sucursal (suma de lotes disponibles) */
  stock: number;
  stockStatus: StockStatus;
  inventory: { minStock: number; maxStock: number | null; location: string | null };
  createdAt: string;
  updatedAt: string;
}

/** El costo y la utilidad son información sensible: no los ve, por ejemplo, un cajero. */
export function canSeeCosts(auth: AuthContext): boolean {
  const perms: PermissionKey[] = ['products.create', 'products.edit', 'reports.financial'];
  return perms.some((p) => hasPermission(auth.roleCode, auth.permissions, p));
}

interface BranchStock {
  stock: Map<string, number>;
  inventory: Map<string, { minStock: number; maxStock: number | null; location: string | null }>;
}

async function loadBranchStock(db: DbClient, productIds: string[], branchId: string): Promise<BranchStock> {
  if (productIds.length === 0) return { stock: new Map(), inventory: new Map() };
  const [batches, inventory] = await Promise.all([
    db.productBatch.groupBy({
      by: ['productId'],
      where: { productId: { in: productIds }, branchId, status: 'ACTIVE' },
      _sum: { quantity: true },
    }),
    db.inventory.findMany({ where: { productId: { in: productIds }, branchId } }),
  ]);
  return {
    stock: new Map(batches.map((b) => [b.productId, b._sum.quantity ?? 0])),
    inventory: new Map(
      inventory.map((i) => [i.productId, { minStock: i.minStock, maxStock: i.maxStock, location: i.location }]),
    ),
  };
}

function stockStatus(stock: number, minStock: number): StockStatus {
  if (stock <= 0) return 'OUT';
  if (stock <= minStock) return 'LOW';
  return 'OK';
}

function toDto(p: ProductRow, branch: BranchStock, opts: { costs: boolean; pricesIncludeTax: boolean }): ProductDto {
  const salePrice = Number(p.salePrice);
  const purchasePrice = Number(p.purchasePrice);
  const taxRate = Number(p.taxRate);
  const inventory = branch.inventory.get(p.id) ?? { minStock: 0, maxStock: null, location: null };
  const stock = branch.stock.get(p.id) ?? 0;
  return {
    id: p.id,
    sku: p.sku,
    barcode: p.barcode,
    commercialName: p.commercialName,
    genericName: p.genericName,
    activeIngredient: p.activeIngredient,
    category: p.category,
    presentation: p.presentation,
    concentration: p.concentration,
    pharmaceuticalForm: p.pharmaceuticalForm,
    contentQuantity: p.contentQuantity,
    laboratory: p.laboratory,
    manufacturer: p.manufacturer,
    salePrice,
    taxRate,
    ...(opts.costs
      ? { purchasePrice, margin: computeMargin(purchasePrice, salePrice, taxRate, opts.pricesIncludeTax) }
      : {}),
    requiresPrescription: p.requiresPrescription,
    isControlled: p.isControlled,
    status: p.status,
    imageUrl: p.imageUrl,
    description: p.description,
    indications: p.indications,
    observations: p.observations,
    stock,
    stockStatus: stockStatus(stock, inventory.minStock),
    inventory,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

async function toDtos(rows: ProductRow[], auth: AuthContext, branchId: string): Promise<ProductDto[]> {
  const [branch, taxes] = await Promise.all([
    loadBranchStock(prisma, rows.map((r) => r.id), branchId),
    getSetting('pharmacy.taxes'),
  ]);
  const opts = { costs: canSeeCosts(auth), pricesIncludeTax: taxes.pricesIncludeTax };
  return rows.map((r) => toDto(r, branch, opts));
}

// -----------------------------------------------------------------------------
// Consultas
// -----------------------------------------------------------------------------

export async function listProducts(auth: AuthContext, branchId: string, query: ListProductsDto): Promise<Paginated<ProductDto>> {
  // Cada palabra debe aparecer (en cualquier orden): "para 500" encuentra "Paracetamol 500 mg"
  const terms = query.q ? normalizeSearch(query.q).split(' ').filter(Boolean).slice(0, 8) : [];
  const where: Prisma.ProductWhereInput = {
    deletedAt: null,
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.laboratoryId ? { laboratoryId: query.laboratoryId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.requiresPrescription !== undefined ? { requiresPrescription: query.requiresPrescription } : {}),
    ...(terms.length ? { AND: terms.map((t) => ({ searchText: { contains: t } })) } : {}),
  };
  const orderBy: Prisma.ProductOrderByWithRelationInput[] =
    query.sort === 'price_asc'
      ? [{ salePrice: 'asc' }]
      : query.sort === 'price_desc'
        ? [{ salePrice: 'desc' }]
        : query.sort === 'recent'
          ? [{ createdAt: 'desc' }]
          : [{ commercialName: 'asc' }, { concentration: 'asc' }];

  const [rows, total] = await prisma.$transaction([
    prisma.product.findMany({ where, include: productInclude, orderBy, ...toSkipTake(query) }),
    prisma.product.count({ where }),
  ]);
  return paginated(await toDtos(rows, auth, branchId), total, query);
}

async function findProductOrThrow(db: DbClient, id: string): Promise<ProductRow> {
  const product = await db.product.findFirst({ where: { id, deletedAt: null }, include: productInclude });
  if (!product) throw AppError.notFound('Producto no encontrado');
  return product;
}

export async function getProduct(auth: AuthContext, branchId: string, id: string): Promise<ProductDto> {
  const [dto] = await toDtos([await findProductOrThrow(prisma, id)], auth, branchId);
  return dto!;
}

/** Búsqueda exacta por código de barras (lector USB o cámara). */
export async function getProductByBarcode(auth: AuthContext, branchId: string, code: string): Promise<ProductDto> {
  const product = await prisma.product.findFirst({
    where: { barcode: code.trim(), deletedAt: null },
    include: productInclude,
  });
  if (!product) throw AppError.notFound('No hay ningún producto con ese código de barras');
  const [dto] = await toDtos([product], auth, branchId);
  return dto!;
}

// -----------------------------------------------------------------------------
// Validaciones
// -----------------------------------------------------------------------------

async function assertReferences(db: DbClient, categoryId?: string, laboratoryId?: string | null): Promise<void> {
  if (categoryId) {
    const ok = await db.category.count({ where: { id: categoryId, deletedAt: null } });
    if (!ok) throw AppError.badRequest('La categoría no existe', [{ path: 'categoryId', message: 'Categoría inválida' }]);
  }
  if (laboratoryId) {
    const ok = await db.laboratory.count({ where: { id: laboratoryId, deletedAt: null } });
    if (!ok) throw AppError.badRequest('El laboratorio no existe', [{ path: 'laboratoryId', message: 'Laboratorio inválido' }]);
  }
}

async function assertUnique(db: DbClient, field: 'barcode' | 'sku', value: string, exceptId?: string): Promise<void> {
  const existing = await db.product.findFirst({
    where: { [field]: value, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { commercialName: true },
  });
  if (existing) {
    const label = field === 'barcode' ? 'código de barras' : 'SKU';
    throw AppError.conflict(`El ${label} ya está asignado a "${existing.commercialName}"`, [
      { path: field, message: `Este ${label} ya existe` },
    ]);
  }
}

async function nextSku(db: DbClient): Promise<string> {
  const [row] = await db.$queryRaw<{ n: bigint }[]>`SELECT nextval('product_sku_seq') AS n`;
  return `MED-${String(row!.n).padStart(6, '0')}`;
}

const PRICE_FIELDS = ['salePrice', 'purchasePrice', 'taxRate'] as const;

// -----------------------------------------------------------------------------
// Comandos
// -----------------------------------------------------------------------------

export async function createProduct(
  auth: AuthContext,
  branchId: string,
  dto: CreateProductDto,
  client: ClientInfo,
): Promise<ProductDto> {
  await assertReferences(prisma, dto.categoryId, dto.laboratoryId);
  if (dto.barcode) await assertUnique(prisma, 'barcode', dto.barcode);
  if (dto.sku) await assertUnique(prisma, 'sku', dto.sku);
  const defaults = await getSetting('inventory.defaults');

  const product = await prisma.$transaction(async (tx) => {
    const sku = dto.sku ?? (await nextSku(tx));
    const { minStock, maxStock, location, ...fields } = dto;
    const created = await tx.product.create({
      data: {
        ...fields,
        sku,
        searchText: buildSearchText({ ...fields, sku }),
        createdById: auth.userId,
        updatedById: auth.userId,
      },
      include: productInclude,
    });
    await tx.inventory.create({
      data: {
        productId: created.id,
        branchId,
        minStock: minStock ?? defaults.defaultMinStock,
        maxStock: maxStock ?? null,
        location,
      },
    });
    await recordAudit(
      {
        action: 'PRODUCT_CREATE',
        userId: auth.userId,
        branchId,
        entityType: 'product',
        entityId: created.id,
        metadata: {
          sku,
          commercialName: created.commercialName,
          salePrice: dto.salePrice,
          purchasePrice: dto.purchasePrice,
          taxRate: dto.taxRate,
        },
        client,
      },
      tx,
    );
    return created;
  });
  const [result] = await toDtos([product], auth, branchId);
  return result!;
}

export async function updateProduct(
  auth: AuthContext,
  branchId: string,
  id: string,
  dto: UpdateProductDto,
  client: ClientInfo,
): Promise<ProductDto> {
  const current = await findProductOrThrow(prisma, id);
  await assertReferences(prisma, dto.categoryId, dto.laboratoryId);
  if (dto.barcode && dto.barcode !== current.barcode) await assertUnique(prisma, 'barcode', dto.barcode, id);

  const { minStock, maxStock, location, ...fields } = dto;

  // Cambios de precio: requieren permiso propio y se auditan por separado
  const priceChanges: Record<string, { from: number; to: number }> = {};
  for (const field of PRICE_FIELDS) {
    const to = fields[field];
    const from = Number(current[field]);
    if (to !== undefined && to !== from) priceChanges[field] = { from, to };
  }
  if (Object.keys(priceChanges).length && !hasPermission(auth.roleCode, auth.permissions, 'products.change_price')) {
    throw AppError.forbidden('No tienes permiso para cambiar precios');
  }

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [field, to] of Object.entries(fields)) {
    if (to === undefined || (PRICE_FIELDS as readonly string[]).includes(field)) continue;
    const from = (current as Record<string, unknown>)[field] ?? null;
    if (from !== to) changes[field] = { from, to };
  }

  const currentInventory = await prisma.inventory.findUnique({ where: { productId_branchId: { productId: id, branchId } } });
  const inventoryChanges: Record<string, { from: unknown; to: unknown }> = {};
  const nextInventory = {
    minStock: minStock ?? currentInventory?.minStock ?? 0,
    maxStock: maxStock !== undefined ? maxStock : (currentInventory?.maxStock ?? null),
    location: location !== undefined ? location : (currentInventory?.location ?? null),
  };
  if (nextInventory.maxStock !== null && nextInventory.maxStock < nextInventory.minStock) {
    throw AppError.badRequest('El stock máximo debe ser mayor o igual al mínimo', [
      { path: 'maxStock', message: 'Debe ser mayor o igual al mínimo' },
    ]);
  }
  for (const key of ['minStock', 'maxStock', 'location'] as const) {
    const from = currentInventory?.[key] ?? null;
    if (from !== nextInventory[key]) inventoryChanges[key] = { from, to: nextInventory[key] };
  }

  if (!Object.keys(changes).length && !Object.keys(priceChanges).length && !Object.keys(inventoryChanges).length) {
    return getProduct(auth, branchId, id);
  }

  await prisma.$transaction(async (tx) => {
    const merged = { ...current, ...fields };
    await tx.product.update({
      where: { id },
      data: { ...fields, searchText: buildSearchText(merged), updatedById: auth.userId },
    });
    if (Object.keys(inventoryChanges).length) {
      await tx.inventory.upsert({
        where: { productId_branchId: { productId: id, branchId } },
        create: { productId: id, branchId, ...nextInventory },
        update: nextInventory,
      });
    }
    if (Object.keys(changes).length || Object.keys(inventoryChanges).length) {
      await recordAudit(
        {
          action: 'PRODUCT_UPDATE',
          userId: auth.userId,
          branchId,
          entityType: 'product',
          entityId: id,
          metadata: { ...changes, ...(Object.keys(inventoryChanges).length ? { inventory: inventoryChanges } : {}) } as Prisma.InputJsonValue,
          client,
        },
        tx,
      );
    }
    if (Object.keys(priceChanges).length) {
      await recordAudit(
        {
          action: 'PRODUCT_PRICE_CHANGE',
          userId: auth.userId,
          branchId,
          entityType: 'product',
          entityId: id,
          metadata: { commercialName: current.commercialName, ...priceChanges },
          client,
        },
        tx,
      );
    }
  });
  return getProduct(auth, branchId, id);
}

export async function deleteProduct(auth: AuthContext, id: string, client: ClientInfo): Promise<void> {
  const current = await findProductOrThrow(prisma, id);
  const stock = await prisma.productBatch.aggregate({ where: { productId: id }, _sum: { quantity: true } });
  const units = stock._sum.quantity ?? 0;
  if (units > 0) {
    throw AppError.businessRule(
      `No se puede eliminar: tiene ${units} unidad(es) en inventario. Da de baja las existencias o márcalo como descontinuado.`,
    );
  }
  await prisma.$transaction(async (tx) => {
    // Baja lógica: el historial (ventas, movimientos) sigue apuntando al producto.
    // El código de barras se libera para que pueda usarse en un producto nuevo.
    await tx.product.update({
      where: { id },
      data: { deletedAt: new Date(), barcode: null, status: 'DISCONTINUED', updatedById: auth.userId },
    });
    await recordAudit(
      {
        action: 'PRODUCT_DELETE',
        userId: auth.userId,
        entityType: 'product',
        entityId: id,
        metadata: { sku: current.sku, commercialName: current.commercialName, barcode: current.barcode },
        client,
      },
      tx,
    );
  });
}

export async function setProductImage(
  auth: AuthContext,
  id: string,
  imageUrl: string | null,
  client: ClientInfo,
): Promise<string | null> {
  const current = await findProductOrThrow(prisma, id);
  await prisma.$transaction(async (tx) => {
    await tx.product.update({ where: { id }, data: { imageUrl, updatedById: auth.userId } });
    await recordAudit(
      {
        action: 'PRODUCT_IMAGE_CHANGE',
        userId: auth.userId,
        entityType: 'product',
        entityId: id,
        metadata: { from: current.imageUrl, to: imageUrl },
        client,
      },
      tx,
    );
  });
  return current.imageUrl; // la anterior, para borrar el archivo
}
