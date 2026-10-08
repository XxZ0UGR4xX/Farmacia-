import type { Presentation, ProductStatus } from '@farmacia/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PageMeta } from '../components/ui/Pagination';
import { api } from './client';

// -----------------------------------------------------------------------------
// Tipos
// -----------------------------------------------------------------------------

export type StockStatus = 'OUT' | 'LOW' | 'OK';

export interface Product {
  id: string;
  sku: string;
  barcode: string | null;
  commercialName: string;
  genericName: string | null;
  activeIngredient: string | null;
  category: { id: string; name: string };
  presentation: Presentation;
  concentration: string | null;
  pharmaceuticalForm: string | null;
  contentQuantity: string | null;
  laboratory: { id: string; name: string } | null;
  manufacturer: string | null;
  salePrice: number;
  taxRate: number;
  purchasePrice?: number;
  margin?: { netSalePrice: number; profit: number; markupPercent: number | null; marginPercent: number | null };
  requiresPrescription: boolean;
  isControlled: boolean;
  status: ProductStatus;
  imageUrl: string | null;
  description: string | null;
  indications: string | null;
  observations: string | null;
  stock: number;
  stockStatus: StockStatus;
  inventory: { minStock: number; maxStock: number | null; location: string | null };
  createdAt: string;
  updatedAt: string;
}

export interface ProductInput {
  sku?: string;
  barcode: string | null;
  commercialName: string;
  genericName: string | null;
  activeIngredient: string | null;
  categoryId: string;
  presentation: Presentation;
  concentration: string | null;
  pharmaceuticalForm: string | null;
  contentQuantity: string | null;
  laboratoryId: string | null;
  manufacturer: string | null;
  purchasePrice?: number;
  salePrice?: number;
  taxRate?: number;
  requiresPrescription: boolean;
  isControlled: boolean;
  status: ProductStatus;
  description: string | null;
  indications: string | null;
  observations: string | null;
  minStock: number;
  maxStock: number | null;
  location: string | null;
}

export interface ProductFilters {
  q?: string;
  categoryId?: string;
  laboratoryId?: string;
  status?: ProductStatus;
  requiresPrescription?: boolean;
  sort?: 'name' | 'price_asc' | 'price_desc' | 'recent';
  page: number;
  pageSize?: number;
}

export type CatalogKind = 'categories' | 'laboratories';

export interface CatalogItem {
  id: string;
  name: string;
  productCount: number;
  description?: string | null;
  country?: string | null;
  website?: string | null;
}

export interface CatalogDefaults {
  taxes: { defaultRate: number; pricesIncludeTax: boolean };
  inventory: { defaultMarginPercent: number; defaultMinStock: number };
  currency: { code: string; symbol: string; locale: string };
}

// -----------------------------------------------------------------------------
// Consultas
// -----------------------------------------------------------------------------

export const catalogKeys = {
  products: ['products'] as const,
  productList: (f: ProductFilters) => ['products', 'list', f] as const,
  product: (id: string) => ['products', 'detail', id] as const,
  catalog: (kind: CatalogKind) => ['catalog', kind] as const,
  defaults: ['settings', 'defaults'] as const,
};

function toQuery(filters: object): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v !== undefined && v !== '') params.set(k, String(v));
  return params.toString();
}

export function useProducts(filters: ProductFilters) {
  return useQuery({
    queryKey: catalogKeys.productList(filters),
    queryFn: ({ signal }) => api.get<{ data: Product[]; meta: PageMeta }>(`/products?${toQuery(filters)}`, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function useProduct(id: string | undefined) {
  return useQuery({
    queryKey: catalogKeys.product(id ?? ''),
    queryFn: ({ signal }) => api.get<{ product: Product }>(`/products/${id}`, { signal }).then((r) => r.product),
    enabled: Boolean(id),
  });
}

/** Búsqueda exacta por código de barras (lector USB). */
export function findProductByBarcode(code: string): Promise<Product> {
  return api.get<{ product: Product }>(`/products/barcode/${encodeURIComponent(code)}`).then((r) => r.product);
}

export function useCatalog(kind: CatalogKind) {
  return useQuery({
    queryKey: catalogKeys.catalog(kind),
    queryFn: ({ signal }) => api.get<{ items: CatalogItem[] }>(`/${kind}`, { signal }).then((r) => r.items),
    staleTime: 60_000,
  });
}

export function useCatalogDefaults() {
  return useQuery({
    queryKey: catalogKeys.defaults,
    queryFn: ({ signal }) => api.get<CatalogDefaults>('/settings/defaults', { signal }),
    staleTime: 5 * 60_000,
  });
}

// -----------------------------------------------------------------------------
// Mutaciones
// -----------------------------------------------------------------------------

function useInvalidateCatalog() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: catalogKeys.products });
    void qc.invalidateQueries({ queryKey: ['catalog'] });
  };
}

export function useSaveProduct() {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: Partial<ProductInput> }) =>
      (id ? api.patch<{ product: Product }>(`/products/${id}`, input) : api.post<{ product: Product }>('/products', input)).then(
        (r) => r.product,
      ),
    onSuccess: invalidate,
  });
}

export function useDeleteProduct() {
  const invalidate = useInvalidateCatalog();
  return useMutation({ mutationFn: (id: string) => api.delete<void>(`/products/${id}`), onSuccess: invalidate });
}

export function useProductImage() {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: ({ id, file }: { id: string; file: File | null }) => {
      if (!file) return api.delete<void>(`/products/${id}/image`).then(() => null);
      const form = new FormData();
      form.append('image', file);
      return api.post<{ imageUrl: string }>(`/products/${id}/image`, form).then((r) => r.imageUrl);
    },
    onSuccess: invalidate,
  });
}

export function useSaveCatalogItem(kind: CatalogKind) {
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: Record<string, unknown> }) =>
      (id ? api.patch<{ item: CatalogItem }>(`/${kind}/${id}`, input) : api.post<{ item: CatalogItem }>(`/${kind}`, input)).then(
        (r) => r.item,
      ),
    onSuccess: invalidate,
  });
}

export function useDeleteCatalogItem(kind: CatalogKind) {
  const invalidate = useInvalidateCatalog();
  return useMutation({ mutationFn: (id: string) => api.delete<void>(`/${kind}/${id}`), onSuccess: invalidate });
}
