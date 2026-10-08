import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client';
import { prisma, type TxClient } from '../../lib/prisma';
import { AppError } from '../../shared/errors';
import type { AuthContext, ClientInfo } from '../../shared/request-context';
import { recordAudit } from '../audit/audit.service';

/**
 * Catálogos sencillos (categorías y laboratorios): mismo ciclo de vida.
 * - El nombre es único sin distinguir mayúsculas.
 * - La baja es lógica y sólo procede si ningún producto vigente lo usa.
 * - Dar de alta un nombre que se había dado de baja lo reactiva (conserva el historial).
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres`)
    .nullish()
    .transform((v) => (v ? v : null));

const name = (max: number) => z.string().trim().min(2, 'El nombre debe tener al menos 2 caracteres').max(max);

export const categorySchema = z.object({ name: name(100), description: optionalText(255) });
export const laboratorySchema = z.object({
  name: name(120),
  country: optionalText(80),
  website: z
    .union([z.literal(''), z.url('Sitio web inválido').max(200)])
    .nullish()
    .transform((v) => (v ? v : null)),
});

export type CatalogKind = 'category' | 'laboratory';

interface CatalogRow {
  id: string;
  name: string;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  [key: string]: unknown;
}

// Adaptador mínimo sobre los delegados de Prisma de cada catálogo
interface Delegate {
  findMany(args: object): Promise<CatalogRow[]>;
  findFirst(args: object): Promise<CatalogRow | null>;
  findUnique(args: object): Promise<CatalogRow | null>;
  create(args: object): Promise<CatalogRow>;
  update(args: object): Promise<CatalogRow>;
}

const config = {
  category: {
    notFound: 'La categoría no existe',
    schema: categorySchema,
    delegate: (db: typeof prisma | TxClient) => db.category as unknown as Delegate,
    productFilter: (id: string): Prisma.ProductWhereInput => ({ categoryId: id }),
    fields: ['description'] as const,
  },
  laboratory: {
    notFound: 'El laboratorio no existe',
    schema: laboratorySchema,
    delegate: (db: typeof prisma | TxClient) => db.laboratory as unknown as Delegate,
    productFilter: (id: string): Prisma.ProductWhereInput => ({ laboratoryId: id }),
    fields: ['country', 'website'] as const,
  },
} satisfies Record<CatalogKind, unknown>;

export interface CatalogItemDto {
  id: string;
  name: string;
  productCount: number;
  [field: string]: unknown;
}

function toDto(kind: CatalogKind, row: CatalogRow, productCount: number): CatalogItemDto {
  const extra = Object.fromEntries(config[kind].fields.map((f) => [f, row[f] ?? null]));
  return { id: row.id, name: row.name, ...extra, productCount };
}

async function countProducts(kind: CatalogKind, id: string): Promise<number> {
  return prisma.product.count({ where: { ...config[kind].productFilter(id), deletedAt: null } });
}

export async function listCatalog(kind: CatalogKind): Promise<CatalogItemDto[]> {
  const rows = await config[kind].delegate(prisma).findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } });
  const counts = await prisma.product.groupBy({
    by: [kind === 'category' ? 'categoryId' : 'laboratoryId'],
    where: { deletedAt: null },
    _count: { _all: true },
  });
  const countById = new Map(
    counts.map((c) => [(c as Record<string, unknown>)[kind === 'category' ? 'categoryId' : 'laboratoryId'] as string, c._count._all]),
  );
  return rows.map((r) => toDto(kind, r, countById.get(r.id) ?? 0));
}

async function findActiveOrThrow(kind: CatalogKind, id: string): Promise<CatalogRow> {
  const row = await config[kind].delegate(prisma).findFirst({ where: { id, deletedAt: null } });
  if (!row) throw AppError.notFound(config[kind].notFound);
  return row;
}

async function findByName(kind: CatalogKind, value: string, exceptId?: string): Promise<CatalogRow | null> {
  return config[kind].delegate(prisma).findFirst({
    where: { name: { equals: value, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
  });
}

const duplicate = (kind: CatalogKind) =>
  AppError.conflict(`Ya existe ${kind === 'category' ? 'una categoría' : 'un laboratorio'} con ese nombre`, [
    { path: 'name', message: 'Nombre en uso' },
  ]);

export async function createCatalogItem(
  kind: CatalogKind,
  actor: AuthContext,
  input: unknown,
  client: ClientInfo,
): Promise<CatalogItemDto> {
  const dto = config[kind].schema.parse(input) as Record<string, unknown> & { name: string };
  const existing = await findByName(kind, dto.name);
  if (existing && !existing.deletedAt) throw duplicate(kind);

  const row = await prisma.$transaction(async (tx) => {
    const delegate = config[kind].delegate(tx);
    // Un nombre dado de baja se reactiva en lugar de duplicarse
    const saved = existing
      ? await delegate.update({ where: { id: existing.id }, data: { ...dto, deletedAt: null } })
      : await delegate.create({ data: dto });
    await recordAudit(
      {
        action: 'CATALOG_CREATE',
        userId: actor.userId,
        entityType: kind,
        entityId: saved.id,
        metadata: { ...dto, reactivated: Boolean(existing) } as Prisma.InputJsonValue,
        client,
      },
      tx,
    );
    return saved;
  });
  return toDto(kind, row, existing ? await countProducts(kind, row.id) : 0);
}

export async function updateCatalogItem(
  kind: CatalogKind,
  actor: AuthContext,
  id: string,
  input: unknown,
  client: ClientInfo,
): Promise<CatalogItemDto> {
  const current = await findActiveOrThrow(kind, id);
  const dto = config[kind].schema.partial().parse(input) as Record<string, unknown>;
  if (typeof dto.name === 'string' && dto.name.toLowerCase() !== current.name.toLowerCase()) {
    if (await findByName(kind, dto.name, id)) throw duplicate(kind);
  }

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [field, value] of Object.entries(dto)) {
    if (value !== undefined && value !== current[field]) changes[field] = { from: current[field] ?? null, to: value };
  }
  if (Object.keys(changes).length === 0) return toDto(kind, current, await countProducts(kind, id));

  const row = await prisma.$transaction(async (tx) => {
    const saved = await config[kind].delegate(tx).update({ where: { id }, data: dto });
    await recordAudit(
      { action: 'CATALOG_UPDATE', userId: actor.userId, entityType: kind, entityId: id, metadata: changes as Prisma.InputJsonValue, client },
      tx,
    );
    return saved;
  });
  return toDto(kind, row, await countProducts(kind, id));
}

export async function deleteCatalogItem(kind: CatalogKind, actor: AuthContext, id: string, client: ClientInfo): Promise<void> {
  const current = await findActiveOrThrow(kind, id);
  const inUse = await countProducts(kind, id);
  if (inUse > 0) {
    throw AppError.businessRule(
      `No se puede eliminar: ${inUse} producto(s) usan ${kind === 'category' ? 'esta categoría' : 'este laboratorio'}. Reasígnalos primero.`,
    );
  }
  await prisma.$transaction(async (tx) => {
    await config[kind].delegate(tx).update({ where: { id }, data: { deletedAt: new Date() } });
    await recordAudit(
      { action: 'CATALOG_DELETE', userId: actor.userId, entityType: kind, entityId: id, metadata: { name: current.name }, client },
      tx,
    );
  });
}
