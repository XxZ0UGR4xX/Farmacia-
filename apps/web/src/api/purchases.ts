import type { PaymentMethod, PaymentStatus, Presentation, PurchaseStatus } from '@farmacia/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PageMeta } from '../components/ui/Pagination';
import { catalogKeys } from './catalog';
import { api } from './client';
import { inventoryKeys, toQuery } from './inventory';

// -----------------------------------------------------------------------------
// Proveedores
// -----------------------------------------------------------------------------

export interface Supplier {
  id: string;
  tradeName: string;
  legalName: string | null;
  rfc: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  contactName: string | null;
  paymentTerms: string | null;
  creditDays: number;
  isActive: boolean;
  notes: string | null;
  stats: { purchaseCount: number; totalPurchased: number; balanceDue: number; lastPurchaseDate: string | null };
}

export type SupplierInput = Omit<Supplier, 'id' | 'isActive' | 'stats'>;

export interface SupplierFilters {
  q?: string;
  status?: 'active' | 'inactive' | 'all';
  page: number;
  pageSize?: number;
}

export interface SupplierOption {
  id: string;
  tradeName: string;
  creditDays: number;
}

// -----------------------------------------------------------------------------
// Compras
// -----------------------------------------------------------------------------

export interface PurchaseItem {
  id: string;
  product: { id: string; sku: string; commercialName: string; concentration: string | null; presentation: Presentation };
  batchId: string | null;
  lotNumber: string | null;
  expiresAt: string | null;
  manufacturedAt: string | null;
  quantity: number;
  unitCost: number;
  discount: number;
  taxRate: number;
  taxAmount: number;
  subtotal: number;
  total: number;
}

export interface Purchase {
  id: string;
  number: number;
  folio: string;
  status: PurchaseStatus;
  supplier: { id: string; tradeName: string; rfc: string | null; creditDays: number };
  invoiceNumber: string | null;
  purchaseDate: string;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  paymentDueDate: string | null;
  overdue: boolean;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  balance: number;
  notes: string | null;
  items: PurchaseItem[];
  payments: { id: string; amount: number; method: PaymentMethod; reference: string | null; paidAt: string; user: { id: string; fullName: string } }[];
  createdBy: { id: string; fullName: string };
  receivedBy: { id: string; fullName: string } | null;
  receivedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
}

export interface PurchaseRow {
  id: string;
  folio: string;
  status: PurchaseStatus;
  supplier: { id: string; tradeName: string };
  invoiceNumber: string | null;
  purchaseDate: string;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  paymentDueDate: string | null;
  overdue: boolean;
  itemCount: number;
  total: number;
  balance: number;
  createdBy: { id: string; fullName: string };
}

export interface PurchasesSummary {
  pendingReception: number;
  balanceDue: number;
  overdueCount: number;
  overdueAmount: number;
  receivedThisMonth: number;
}

export interface PurchaseFilters {
  q?: string;
  supplierId?: string;
  status?: PurchaseStatus;
  paymentStatus?: PaymentStatus;
  overdue?: boolean;
  from?: string;
  to?: string;
  page: number;
  pageSize?: number;
}

export interface PurchaseItemInput {
  productId: string;
  lotNumber: string | null;
  expiresAt: string | null;
  manufacturedAt?: string | null;
  quantity: number;
  unitCost: number;
  discount: number;
  taxRate: number;
}

export interface PurchaseInput {
  supplierId: string;
  invoiceNumber: string | null;
  purchaseDate: string;
  paymentMethod: PaymentMethod;
  paymentDueDate: string | null;
  notes: string | null;
  items: PurchaseItemInput[];
}

export interface PaymentInput {
  amount: number;
  method: Exclude<PaymentMethod, 'CREDIT'>;
  reference: string | null;
  paidAt?: string;
}

export const purchaseKeys = {
  suppliers: ['suppliers'] as const,
  supplierList: (f: SupplierFilters) => ['suppliers', 'list', f] as const,
  supplierOptions: ['suppliers', 'options'] as const,
  purchases: ['purchases'] as const,
  purchaseList: (f: PurchaseFilters) => ['purchases', 'list', f] as const,
  purchase: (id: string) => ['purchases', 'detail', id] as const,
};

export function useSuppliers(filters: SupplierFilters, enabled = true) {
  return useQuery({
    queryKey: purchaseKeys.supplierList(filters),
    queryFn: ({ signal }) => api.get<{ data: Supplier[]; meta: PageMeta }>(`/suppliers?${toQuery(filters)}`, { signal }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useSupplierOptions(enabled = true) {
  return useQuery({
    queryKey: purchaseKeys.supplierOptions,
    queryFn: ({ signal }) => api.get<{ items: SupplierOption[] }>('/suppliers/options', { signal }).then((r) => r.items),
    enabled,
    staleTime: 60_000,
  });
}

export function useSaveSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: Partial<SupplierInput> }) =>
      (id ? api.patch<{ supplier: Supplier }>(`/suppliers/${id}`, input) : api.post<{ supplier: Supplier }>('/suppliers', input)).then(
        (r) => r.supplier,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: purchaseKeys.suppliers }),
  });
}

export function useSetSupplierActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch<{ supplier: Supplier }>(`/suppliers/${id}/status`, { isActive }).then((r) => r.supplier),
    onSuccess: () => qc.invalidateQueries({ queryKey: purchaseKeys.suppliers }),
  });
}

export function usePurchases(filters: PurchaseFilters) {
  return useQuery({
    queryKey: purchaseKeys.purchaseList(filters),
    queryFn: ({ signal }) =>
      api.get<{ data: PurchaseRow[]; meta: PageMeta; summary: PurchasesSummary }>(`/purchases?${toQuery(filters)}`, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function usePurchase(id: string | undefined) {
  return useQuery({
    queryKey: purchaseKeys.purchase(id ?? ''),
    queryFn: ({ signal }) => api.get<{ purchase: Purchase }>(`/purchases/${id}`, { signal }).then((r) => r.purchase),
    enabled: Boolean(id),
  });
}

/** Una compra afecta inventario, costos de productos, proveedores y el propio listado. */
function useInvalidatePurchases() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: purchaseKeys.purchases });
    void qc.invalidateQueries({ queryKey: purchaseKeys.suppliers });
    void qc.invalidateQueries({ queryKey: inventoryKeys.all });
    void qc.invalidateQueries({ queryKey: catalogKeys.products });
    // Las alertas (agotados, caducados, pagos) dependen de estos datos
    void qc.invalidateQueries({ queryKey: ['notifications'] });
  };
}

export function useSavePurchase() {
  const invalidate = useInvalidatePurchases();
  return useMutation({
    mutationFn: ({ id, input, receive }: { id?: string; input: PurchaseInput; receive?: boolean }) =>
      (id
        ? api.put<{ purchase: Purchase }>(`/purchases/${id}`, input)
        : api.post<{ purchase: Purchase }>('/purchases', { ...input, receive: Boolean(receive) })
      ).then((r) => r.purchase),
    onSuccess: invalidate,
  });
}

export function useReceivePurchase() {
  const invalidate = useInvalidatePurchases();
  return useMutation({
    mutationFn: (id: string) => api.post<{ purchase: Purchase }>(`/purchases/${id}/receive`).then((r) => r.purchase),
    onSuccess: invalidate,
  });
}

export function useCancelPurchase() {
  const invalidate = useInvalidatePurchases();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post<{ purchase: Purchase }>(`/purchases/${id}/cancel`, { reason }).then((r) => r.purchase),
    onSuccess: invalidate,
  });
}

export function useAddPayment() {
  const invalidate = useInvalidatePurchases();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: PaymentInput }) =>
      api.post<{ purchase: Purchase }>(`/purchases/${id}/payments`, input).then((r) => r.purchase),
    onSuccess: invalidate,
  });
}
