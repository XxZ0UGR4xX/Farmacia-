/** Catálogos y cálculos de productos compartidos por backend y frontend. */

export const PRESENTATIONS = ['BOX', 'BOTTLE', 'BLISTER', 'AMPOULE', 'TUBE', 'SACHET', 'PIECE', 'OTHER'] as const;
export type Presentation = (typeof PRESENTATIONS)[number];

export const PRESENTATION_LABELS: Record<Presentation, string> = {
  BOX: 'Caja',
  BOTTLE: 'Frasco',
  BLISTER: 'Blíster',
  AMPOULE: 'Ampolleta',
  TUBE: 'Tubo',
  SACHET: 'Sobre',
  PIECE: 'Pieza',
  OTHER: 'Otro',
};

export const PRODUCT_STATUSES = ['ACTIVE', 'INACTIVE', 'DISCONTINUED'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = {
  ACTIVE: 'Activo',
  INACTIVE: 'Inactivo',
  DISCONTINUED: 'Descontinuado',
};

/** Sugerencias para el campo libre "forma farmacéutica". */
export const PHARMACEUTICAL_FORMS = [
  'Tableta',
  'Tableta recubierta',
  'Cápsula',
  'Gragea',
  'Jarabe',
  'Suspensión',
  'Solución oral',
  'Solución inyectable',
  'Gotas',
  'Crema',
  'Ungüento',
  'Gel',
  'Óvulo',
  'Supositorio',
  'Polvo',
  'Aerosol',
  'Parche',
] as const;

/** Tasas de IVA habituales en México. */
export const TAX_RATE_OPTIONS = [
  { value: 0, label: 'IVA 0 % (medicamentos)' },
  { value: 0.16, label: 'IVA 16 %' },
] as const;

/**
 * Margen de ganancia por unidad.
 * - `netSalePrice`: precio de venta sin IVA (si los precios lo incluyen).
 * - `profit`: utilidad por unidad.
 * - `markupPercent`: utilidad sobre el costo (lo que se usa para "margen predeterminado").
 * - `marginPercent`: utilidad sobre el precio de venta.
 */
export function computeMargin(
  purchasePrice: number,
  salePrice: number,
  taxRate: number,
  pricesIncludeTax = true,
): { netSalePrice: number; profit: number; markupPercent: number | null; marginPercent: number | null } {
  const netSalePrice = pricesIncludeTax ? salePrice / (1 + taxRate) : salePrice;
  const profit = netSalePrice - purchasePrice;
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    netSalePrice: round(netSalePrice),
    profit: round(profit),
    markupPercent: purchasePrice > 0 ? round((profit / purchasePrice) * 100) : null,
    marginPercent: netSalePrice > 0 ? round((profit / netSalePrice) * 100) : null,
  };
}

/** Precio sugerido a partir del costo y un margen sobre el costo. */
export function suggestSalePrice(
  purchasePrice: number,
  markupPercent: number,
  taxRate: number,
  pricesIncludeTax = true,
): number {
  const net = purchasePrice * (1 + markupPercent / 100);
  const gross = pricesIncludeTax ? net * (1 + taxRate) : net;
  // Redondeo a 50 centavos hacia arriba: precios "de mostrador"
  return Math.ceil(gross * 2) / 2;
}

/** Texto normalizado para búsqueda: minúsculas y sin acentos ("Ácido" → "acido"). */
export function normalizeSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
