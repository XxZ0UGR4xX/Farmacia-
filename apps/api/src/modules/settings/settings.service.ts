import { MARGIN_BASES, MAX_PRICE_MARGIN, RFC_REGEX } from '@farmacia/shared';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../shared/errors';
import type { AuthContext, ClientInfo } from '../../shared/request-context';
import { optionalText } from '../../shared/schema-fields';
import { recordAudit } from '../audit/audit.service';
import { markAllAlertsStale } from '../notifications/alerts.service';

/**
 * Configuración de la farmacia (tabla settings). La lectura es tolerante: si una clave falta o
 * tiene un formato inesperado se usan valores predeterminados seguros. La escritura es estricta
 * y cada cambio queda en auditoría con el valor anterior y el nuevo.
 */
const schemas = {
  'pharmacy.taxes': z.object({
    defaultRate: z.number().min(0).max(1).default(0),
    pricesIncludeTax: z.boolean().default(true),
  }),
  'inventory.defaults': z.object({
    defaultMarginPercent: z.number().min(0).max(1000).default(30),
    marginBasis: z.enum(MARGIN_BASES).default('COST'),
    defaultMinStock: z.number().int().min(0).default(5),
  }),
  'pharmacy.currency': z.object({
    code: z.string().default('MXN'),
    symbol: z.string().default('$'),
    locale: z.string().default('es-MX'),
  }),
  'pharmacy.profile': z.object({
    name: z.string().default('Mi Farmacia'),
    phone: z.string().nullish(),
    email: z.string().nullish(),
    address: z.string().nullish(),
  }),
  'pharmacy.fiscal': z.object({
    rfc: z.string().nullish(),
    legalName: z.string().nullish(),
    taxRegime: z.string().nullish(),
    fiscalAddress: z.string().nullish(),
    zipCode: z.string().nullish(),
  }),
  'alerts.expiry': z.object({
    criticalDays: z.number().int().min(1).default(30),
    warningDays: z.number().int().min(1).default(90),
  }),
} as const;

type SettingKey = keyof typeof schemas;
export type SettingValue<K extends SettingKey> = z.infer<(typeof schemas)[K]>;

export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const row = await prisma.setting.findUnique({ where: { key } });
  const parsed = schemas[key].safeParse(row?.value ?? {});
  return (parsed.success ? parsed.data : schemas[key].parse({})) as SettingValue<K>;
}

/** Valores que necesita la interfaz para capturar productos y precios. */
export async function getCatalogDefaults() {
  const [taxes, inventory, currency] = await Promise.all([
    getSetting('pharmacy.taxes'),
    getSetting('inventory.defaults'),
    getSetting('pharmacy.currency'),
  ]);
  return { taxes, inventory, currency };
}

// -----------------------------------------------------------------------------
// Edición (Configuración)
// -----------------------------------------------------------------------------

const phone = optionalText(30).refine((v) => v === null || /^[\d\s()+-]{7,30}$/.test(v), 'Teléfono inválido');
const email = optionalText(160).refine((v) => v === null || z.email().safeParse(v).success, 'Correo inválido');

/** Lo que se puede cambiar desde la interfaz, con sus reglas. */
export const editableSchemas = {
  'pharmacy.profile': z.object({
    name: z.string().trim().min(2, 'El nombre es obligatorio').max(120),
    phone,
    email,
    address: optionalText(255),
  }),
  'pharmacy.fiscal': z.object({
    rfc: optionalText(13)
      .transform((v) => v?.toUpperCase() ?? null)
      .refine((v) => v === null || RFC_REGEX.test(v), 'RFC inválido (12 o 13 caracteres)'),
    legalName: optionalText(200),
    taxRegime: optionalText(120),
    fiscalAddress: optionalText(255),
    zipCode: optionalText(5).refine((v) => v === null || /^\d{5}$/.test(v), 'El código postal tiene 5 dígitos'),
  }),
  'pharmacy.taxes': z.object({
    defaultRate: z.union([z.literal(0), z.literal(0.08), z.literal(0.16)], { error: 'Tasa de IVA no válida' }),
    pricesIncludeTax: z.boolean(),
  }),
  'inventory.defaults': z
    .object({
      defaultMarginPercent: z.number({ error: 'Margen inválido' }).min(0, 'El margen no puede ser negativo').max(1000, 'Margen demasiado alto'),
      marginBasis: z.enum(MARGIN_BASES),
      defaultMinStock: z.number().int('Debe ser un número entero').min(0).max(100_000),
    })
    .refine((v) => v.marginBasis === 'COST' || v.defaultMarginPercent <= MAX_PRICE_MARGIN, {
      path: ['defaultMarginPercent'],
      message: `Sobre el precio de venta el margen máximo es ${MAX_PRICE_MARGIN} %`,
    }),
  'alerts.expiry': z
    .object({
      criticalDays: z.number().int().min(1, 'Mínimo 1 día').max(365),
      warningDays: z.number().int().min(1).max(730),
    })
    .refine((v) => v.warningDays > v.criticalDays, { path: ['warningDays'], message: 'Debe ser mayor que los días críticos' }),
} as const;

export type EditableSettingKey = keyof typeof editableSchemas;
export const EDITABLE_SETTING_KEYS = Object.keys(editableSchemas) as EditableSettingKey[];

export async function listSettings() {
  const rows = await prisma.setting.findMany({
    where: { key: { in: EDITABLE_SETTING_KEYS } },
    include: { updatedBy: { select: { firstName: true, lastName: true } } },
  });
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const entries = await Promise.all(
    EDITABLE_SETTING_KEYS.map(async (key) => {
      const row = byKey.get(key);
      return [
        key,
        {
          value: await getSetting(key),
          updatedAt: row?.updatedAt.toISOString() ?? null,
          updatedBy: row?.updatedBy ? `${row.updatedBy.firstName} ${row.updatedBy.lastName}`.trim() : null,
        },
      ] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export async function updateSetting(auth: AuthContext, key: EditableSettingKey, input: unknown, client: ClientInfo) {
  const next = editableSchemas[key].parse(input) as Record<string, unknown>;
  const current = (await getSetting(key)) as Record<string, unknown>;
  const changes = Object.keys(next)
    .filter((field) => JSON.stringify(current[field] ?? null) !== JSON.stringify(next[field] ?? null))
    .map((field) => ({ field, before: current[field] ?? null, after: next[field] ?? null }));
  if (changes.length === 0) return listSettings();

  const existing = await prisma.setting.findUnique({ where: { key } });
  // Se conservan campos que la interfaz no edita (p. ej. el logotipo o las tasas disponibles)
  const value = { ...((existing?.value as Record<string, unknown> | null) ?? {}), ...next } as Prisma.InputJsonValue;
  await prisma.$transaction(async (tx) => {
    await tx.setting.upsert({ where: { key }, update: { value, updatedById: auth.userId }, create: { key, value, updatedById: auth.userId } });
    await recordAudit({ action: 'SETTINGS_UPDATE', userId: auth.userId, entityType: 'setting', entityId: key, metadata: { key, changes }, client }, tx);
  });
  // Los días de caducidad cambian qué lotes se avisan en todas las sucursales
  if (key === 'alerts.expiry') markAllAlertsStale();
  return listSettings();
}

// -----------------------------------------------------------------------------
// Sucursales
// -----------------------------------------------------------------------------

export const branchSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,20}$/, 'Clave de 2 a 20 letras, números o guiones'),
  name: z.string().trim().min(2, 'El nombre es obligatorio').max(120),
  address: optionalText(255),
  phone,
  email,
  // Sin valor por omisión: una edición parcial no debe reactivar la sucursal sin pedirlo
  isActive: z.boolean().optional(),
});
export type BranchDto = z.infer<typeof branchSchema>;

const branchSelect = {
  id: true,
  code: true,
  name: true,
  address: true,
  phone: true,
  email: true,
  isActive: true,
  _count: { select: { users: true } },
} as const;

const toBranch = (b: Prisma.BranchGetPayload<{ select: typeof branchSelect }>) => {
  const { _count, ...rest } = b;
  return { ...rest, users: _count.users };
};

export async function listBranches() {
  const rows = await prisma.branch.findMany({ select: branchSelect, orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });
  return rows.map(toBranch);
}

function uniqueCode(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    throw AppError.conflict('Ya existe una sucursal con esa clave', [{ path: 'code', message: 'Clave repetida' }]);
  }
  throw err;
}

export async function createBranch(auth: AuthContext, dto: BranchDto, client: ClientInfo) {
  const branch = await prisma
    .$transaction(async (tx) => {
      const created = await tx.branch.create({ data: dto, select: branchSelect });
      // Quien la crea queda asignado para poder operarla
      await tx.userBranch.create({ data: { userId: auth.userId, branchId: created.id } });
      await recordAudit({ action: 'BRANCH_CREATE', userId: auth.userId, branchId: created.id, entityType: 'branch', entityId: created.id, metadata: { code: dto.code, name: dto.name }, client }, tx);
      return created;
    })
    .catch(uniqueCode);
  return toBranch(await prisma.branch.findUniqueOrThrow({ where: { id: branch.id }, select: branchSelect }));
}

export async function updateBranch(auth: AuthContext, id: string, dto: Partial<BranchDto>, client: ClientInfo) {
  const current = await prisma.branch.findUnique({ where: { id } });
  if (!current) throw AppError.notFound('Sucursal no encontrada');
  if (current.isActive && dto.isActive === false) {
    const [active, defaultFor] = await Promise.all([
      prisma.branch.count({ where: { isActive: true } }),
      prisma.user.count({ where: { defaultBranchId: id, status: 'ACTIVE', deletedAt: null } }),
    ]);
    if (active <= 1) throw AppError.businessRule('Debe quedar al menos una sucursal activa');
    if (defaultFor > 0) throw AppError.businessRule(`Es la sucursal predeterminada de ${defaultFor} usuario(s) activo(s): cámbiales la sucursal antes de desactivarla`);
  }
  const fields = Object.keys(dto).filter((k) => JSON.stringify((current as Record<string, unknown>)[k] ?? null) !== JSON.stringify((dto as Record<string, unknown>)[k] ?? null));
  if (fields.length === 0) return toBranch(await prisma.branch.findUniqueOrThrow({ where: { id }, select: branchSelect }));
  await prisma
    .$transaction(async (tx) => {
      await tx.branch.update({ where: { id }, data: dto });
      await recordAudit({ action: 'BRANCH_UPDATE', userId: auth.userId, branchId: id, entityType: 'branch', entityId: id, metadata: { fields, ...(dto.isActive !== undefined && dto.isActive !== current.isActive ? { isActive: dto.isActive } : {}) }, client }, tx);
    })
    .catch(uniqueCode);
  return toBranch(await prisma.branch.findUniqueOrThrow({ where: { id }, select: branchSelect }));
}
