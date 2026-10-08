import type { AdjustmentDirection, AdjustmentReason, ExpiryStatus, MovementType, Presentation } from '@farmacia/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PageMeta } from '../components/ui/Pagination';
import { catalogKeys } from './catalog';
import { api } from './client';

export type InventoryStockStatus = 'OUT' | 'LOW' | 'OK' | 'OVER';

export interface StockRow {
  productId: string;
  sku: string;
  barcode: string | null;
  commercialName: string;
  concentration: string | null;
  pharmaceuticalForm: string | null;
  presentation: Presentation;
  contentQuantity: string | null;
  category: string;
  productStatus: string;
  imageUrl: string | null;
  available: number;
  expired: number;
  quarantine: number;
  batches: number;
  nextExpiry: string | null;
  daysToExpiry: number | null;
  expiryStatus: ExpiryStatus | null;
  minStock: number;
  maxStock: number | null;
  location: string | null;
  stockStatus: InventoryStockStatus;
  value?: number;
}

export interface StockSummary {
  activeProducts: number;
  withStock: number;
  outOfStock: number;
  lowStock: number;
  expiredUnits: number;
  inventoryValue?: number;
}

export interface Batch {
  id: string;
  product: { id: string; sku: string; commercialName: string; concentration: string | null; presentation: Presentation; contentQuantity: string | null };
  lotNumber: string;
  quantity: number;
  initialQuantity: number;
  expiresAt: string;
  manufacturedAt: string | null;
  daysLeft: number;
  expiryStatus: ExpiryStatus;
  status: 'ACTIVE' | 'QUARANTINE' | 'DEPLETED' | 'DISCARDED';
  sellable: boolean;
  supplier: { id: string; name: string } | null;
  receivedAt: string;
  unitCost?: number;
  value?: number;
}

export interface Movement {
  id: string;
  createdAt: string;
  type: MovementType;
  reason: AdjustmentReason | null;
  quantityBefore: number;
  quantityChange: number;
  quantityAfter: number;
  notes: string | null;
  referenceType: string | null;
  referenceId: string | null;
  product: { id: string; sku: string; commercialName: string; concentration: string | null };
  batch: { id: string; lotNumber: string; expiresAt: string };
  user: { id: string; fullName: string };
  unitCost?: number | null;
}

export interface StockFilters {
  q?: string;
  categoryId?: string;
  stockStatus?: InventoryStockStatus;
  sort?: 'name' | 'stock' | 'expiry';
  page: number;
  pageSize?: number;
}

export interface BatchFilters {
  q?: string;
  productId?: string;
  expiry?: ExpiryStatus;
  status?: 'AVAILABLE' | 'DEPLETED' | 'QUARANTINE' | 'ALL';
  page: number;
  pageSize?: number;
}

export interface MovementFilters {
  q?: string;
  type?: MovementType;
  productId?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize?: number;
}

export interface EntryInput {
  productId: string;
  lotNumber: string;
  expiresAt: string;
  manufacturedAt?: string | null;
  quantity: number;
  unitCost?: number;
  type: 'INITIAL_STOCK' | 'ADJUSTMENT_IN';
  reason?: AdjustmentReason | null;
  notes?: string | null;
}

export interface AdjustmentInput {
  batchId: string;
  direction: AdjustmentDirection;
  quantity: number;
  reason: AdjustmentReason;
  notes?: string | null;
}

export function toQuery(filters: object): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v !== undefined && v !== '') params.set(k, String(v));
  return params.toString();
}

export const inventoryKeys = {
  all: ['inventory'] as const,
  stock: (f: StockFilters) => ['inventory', 'stock', f] as const,
  product: (id: string) => ['inventory', 'product', id] as const,
  batches: (f: BatchFilters) => ['inventory', 'batches', f] as const,
  movements: (f: MovementFilters) => ['inventory', 'movements', f] as const,
};

export function useStock(filters: StockFilters) {
  return useQuery({
    queryKey: inventoryKeys.stock(filters),
    queryFn: ({ signal }) =>
      api.get<{ data: StockRow[]; meta: PageMeta; summary: StockSummary }>(`/inventory/stock?${toQuery(filters)}`, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function useProductInventory(productId: string | undefined) {
  return useQuery({
    queryKey: inventoryKeys.product(productId ?? ''),
    queryFn: ({ signal }) => api.get<{ batches: Batch[]; movements: Movement[] }>(`/inventory/products/${productId}`, { signal }),
    enabled: Boolean(productId),
  });
}

export function useBatches(filters: BatchFilters) {
  return useQuery({
    queryKey: inventoryKeys.batches(filters),
    queryFn: ({ signal }) => api.get<{ data: Batch[]; meta: PageMeta }>(`/inventory/batches?${toQuery(filters)}`, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function useMovements(filters: MovementFilters, enabled = true) {
  return useQuery({
    queryKey: inventoryKeys.movements(filters),
    queryFn: ({ signal }) => api.get<{ data: Movement[]; meta: PageMeta }>(`/inventory/movements?${toQuery(filters)}`, { signal }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** Tras una entrada o un ajuste cambian existencias, lotes, movimientos y fichas de producto. */
function useInvalidateInventory() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: inventoryKeys.all });
    void qc.invalidateQueries({ queryKey: catalogKeys.products });
  };
}

export function useRegisterEntry() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: (input: EntryInput) => api.post<{ batch: Batch; createdBatch: boolean }>('/inventory/entries', input),
    onSuccess: invalidate,
  });
}

export function useAdjustBatch() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: (input: AdjustmentInput) => api.post<{ movement: Movement }>('/inventory/adjustments', input).then((r) => r.movement),
    onSuccess: invalidate,
  });
}
