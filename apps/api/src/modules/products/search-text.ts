import { normalizeSearch } from '@farmacia/shared';

/** Texto de búsqueda de un producto: todo lo que el usuario podría teclear o escanear. */
export function buildSearchText(p: {
  commercialName: string;
  genericName: string | null;
  activeIngredient: string | null;
  concentration: string | null;
  barcode: string | null;
  sku: string;
}): string {
  return normalizeSearch(
    [p.commercialName, p.genericName, p.activeIngredient, p.concentration, p.barcode, p.sku].filter(Boolean).join(' '),
  );
}
