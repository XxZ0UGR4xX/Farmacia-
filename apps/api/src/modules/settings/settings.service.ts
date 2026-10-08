import { z } from 'zod';
import { prisma } from '../../lib/prisma';

/**
 * Lectura tipada de la configuración (tabla settings). Si una clave falta o tiene un
 * formato inesperado se usan valores predeterminados seguros. La edición llega en la Fase 10.
 */
const schemas = {
  'pharmacy.taxes': z.object({
    defaultRate: z.number().min(0).max(1).default(0),
    pricesIncludeTax: z.boolean().default(true),
  }),
  'inventory.defaults': z.object({
    defaultMarginPercent: z.number().min(0).max(1000).default(30),
    defaultMinStock: z.number().int().min(0).default(5),
  }),
  'pharmacy.currency': z.object({
    code: z.string().default('MXN'),
    symbol: z.string().default('$'),
    locale: z.string().default('es-MX'),
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
