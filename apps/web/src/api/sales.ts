import type { Presentation, ReturnDisposition, SalePaymentMethod, SaleStatus } from '@farmacia/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PageMeta } from '../components/ui/Pagination';
import { catalogKeys } from './catalog';
import { api } from './client';
import { inventoryKeys, toQuery } from './inventory';

export interface SaleItem {
  id: string;
  product: {
    id: string;
    sku: string;
    barcode: string | null;
    commercialName: string;
    concentration: string | null;
    presentation: Presentation;
    requiresPrescription: boolean;
    isControlled: boolean;
  };
  quantity: number;
  returnedQty: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  taxAmount: number;
  subtotal: number;
  total: number;
  unitCost?: number;
  batches: { batchId: string; lotNumber: string; expiresAt: string; quantity: number }[];
}

export interface SalePayment {
  id: string;
  method: SalePaymentMethod;
  amount: number;
  received: number | null;
  change: number | null;
  reference: string | null;
}

export interface SaleReturn {
  id: string;
  folio: string;
  reason: string;
  refundTotal: number;
  refundMethod: SalePaymentMethod;
  createdAt: string;
  user: { id: string; fullName: string };
  items: { saleItemId: string; lotNumber: string; quantity: number; disposition: ReturnDisposition; refundAmount: number }[];
}

export interface TicketHeader {
  name: string;
  address: string | null;
  phone: string | null;
  rfc: string | null;
  legalName: string | null;
}

export interface Sale {
  id: string;
  number: number;
  folio: string;
  status: SaleStatus;
  branch: { id: string; name: string; address: string | null; phone: string | null };
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  refunded: number;
  costTotal?: number;
  profit?: number;
  prescriptionChecked: boolean;
  notes: string | null;
  items: SaleItem[];
  payments: SalePayment[];
  returns: SaleReturn[];
  createdBy: { id: string; fullName: string };
  cancelledBy: { id: string; fullName: string } | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  header?: TicketHeader;
}

export interface SaleRow {
  id: string;
  folio: string;
  status: SaleStatus;
  createdAt: string;
  total: number;
  units: number;
  paymentMethods: SalePaymentMethod[];
  createdBy: { id: string; fullName: string };
}

export interface SalesSummary {
  count: number;
  total: number;
  averageTicket: number;
  cancelled: number;
  byMethod: Partial<Record<SalePaymentMethod, number>>;
  refunds: Partial<Record<SalePaymentMethod, number>>;
}

export interface SaleFilters {
  q?: string;
  status?: SaleStatus;
  paymentMethod?: SalePaymentMethod;
  from?: string;
  to?: string;
  page: number;
  pageSize?: number;
}

export interface CreateSaleInput {
  clientRequestId: string;
  items: { productId: string; quantity: number; discount: number }[];
  payments: { method: SalePaymentMethod; amount: number; received?: number; reference?: string | null }[];
  prescriptionChecked: boolean;
  expectedTotal: number;
  notes?: string | null;
}

export interface CreateReturnInput {
  reason: string;
  refundMethod: SalePaymentMethod;
  notes?: string | null;
  items: { saleItemId: string; quantity: number; disposition: ReturnDisposition }[];
}

export interface ReturnRow {
  id: string;
  folio: string;
  sale: { id: string; folio: string };
  reason: string;
  refundTotal: number;
  refundMethod: SalePaymentMethod;
  notes: string | null;
  createdAt: string;
  user: { id: string; fullName: string };
  items: {
    id: string;
    product: { id: string; commercialName: string; concentration: string | null };
    lotNumber: string;
    expiresAt: string;
    expired: boolean;
    quantity: number;
    refundAmount: number;
    disposition: ReturnDisposition;
    pendingReview: boolean;
    reviewedAt: string | null;
    reviewedBy: string | null;
    reviewNotes: string | null;
  }[];
}

export const salesKeys = {
  sales: ['sales'] as const,
  list: (f: SaleFilters) => ['sales', 'list', f] as const,
  sale: (id: string) => ['sales', 'detail', id] as const,
  returns: ['returns'] as const,
  returnList: (f: object) => ['returns', 'list', f] as const,
};

export function useSales(filters: SaleFilters, enabled = true) {
  return useQuery({
    queryKey: salesKeys.list(filters),
    queryFn: ({ signal }) =>
      api.get<{ data: SaleRow[]; meta: PageMeta; summary: SalesSummary; scope: 'own' | 'branch' }>(`/sales?${toQuery(filters)}`, { signal }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useSale(id: string | undefined) {
  return useQuery({
    queryKey: salesKeys.sale(id ?? ''),
    queryFn: ({ signal }) => api.get<{ sale: Sale }>(`/sales/${id}`, { signal }).then((r) => r.sale),
    enabled: Boolean(id),
  });
}

export function useReturns(filters: { q?: string; pending?: boolean; page: number; pageSize?: number }) {
  return useQuery({
    queryKey: salesKeys.returnList(filters),
    queryFn: ({ signal }) =>
      api.get<{ data: ReturnRow[]; meta: PageMeta; summary: { pendingItems: number; pendingUnits: number } }>(`/returns?${toQuery(filters)}`, {
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}

/** Una venta, cancelación o devolución cambia existencias, lotes y el historial. */
function useInvalidateSales() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: salesKeys.sales });
    void qc.invalidateQueries({ queryKey: salesKeys.returns });
    void qc.invalidateQueries({ queryKey: inventoryKeys.all });
    void qc.invalidateQueries({ queryKey: catalogKeys.products });
  };
}

export function useCreateSale() {
  const invalidate = useInvalidateSales();
  return useMutation({
    mutationFn: (input: CreateSaleInput) => api.post<{ sale: Sale }>('/sales', input).then((r) => r.sale),
    onSuccess: invalidate,
  });
}

export function useCancelSale() {
  const invalidate = useInvalidateSales();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post<{ sale: Sale }>(`/sales/${id}/cancel`, { reason }).then((r) => r.sale),
    onSuccess: invalidate,
  });
}

export function useCreateReturn() {
  const invalidate = useInvalidateSales();
  return useMutation({
    mutationFn: ({ saleId, input }: { saleId: string; input: CreateReturnInput }) =>
      api.post<{ sale: Sale }>(`/sales/${saleId}/returns`, input).then((r) => r.sale),
    onSuccess: invalidate,
  });
}

export function useReviewReturnItem() {
  const invalidate = useInvalidateSales();
  return useMutation({
    mutationFn: ({ returnId, itemId, decision, notes }: { returnId: string; itemId: string; decision: 'RESTOCK' | 'DISCARD'; notes?: string | null }) =>
      api.post<void>(`/returns/${returnId}/items/${itemId}/review`, { decision, notes: notes ?? null }),
    onSuccess: invalidate,
  });
}
