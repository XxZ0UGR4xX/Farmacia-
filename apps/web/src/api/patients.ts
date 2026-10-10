import type { SaleStatus } from '@farmacia/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PageMeta } from '../components/ui/Pagination';
import { api } from './client';
import { toQuery } from './inventory';

export interface PatientSummary {
  id: string;
  fullName: string;
  age: number | null;
  /** Enmascarado en listados: "•••• 4321" */
  phone: string | null;
}

export interface PatientRow extends PatientSummary {
  prescriptions: number;
  purchases: number;
  lastVisit: string | null;
}

export interface PatientDetail {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  birthDate: string | null;
  age: number | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  createdAt: string;
  prescriptions: { id: string; folio: string; doctorName: string; issuedAt: string; medications: string[]; sales: number; voided: boolean }[];
  purchases: { id: string; folio: string; status: SaleStatus; createdAt: string; total: number; products: string[] }[];
}

export interface PatientInput {
  firstName: string;
  lastName: string;
  birthDate: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
}

export interface PrescriptionItemInput {
  productId?: string | null;
  medicationName: string;
  dose: string | null;
  frequency: string | null;
  duration: string | null;
  instructions: string | null;
}

export interface PrescriptionInput {
  patientId: string;
  doctorName: string;
  doctorLicense: string | null;
  issuedAt: string;
  notes: string | null;
  items: PrescriptionItemInput[];
}

export interface Prescription {
  id: string;
  folio: string;
  patient: { id: string; fullName: string; birthDate: string | null };
  doctorName: string;
  doctorLicense: string | null;
  issuedAt: string;
  notes: string | null;
  items: (PrescriptionItemInput & { id: string; product: { id: string; commercialName: string } | null })[];
  sales: { id: string; folio: string; createdAt: string; total: number; status: SaleStatus }[];
  createdBy: string | null;
  createdAt: string;
  voided: boolean;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
}

export interface PrescriptionRow {
  id: string;
  folio: string;
  patient: { id: string; fullName: string };
  doctorName: string;
  doctorLicense: string | null;
  issuedAt: string;
  medications: string[];
  sales: number;
  voided: boolean;
}

export interface PrescriptionFilters {
  q?: string;
  patientId?: string;
  from?: string;
  to?: string;
  includeVoided?: boolean;
  page: number;
  pageSize?: number;
}

export const patientKeys = {
  patients: ['patients'] as const,
  list: (f: object) => ['patients', 'list', f] as const,
  search: (q: string) => ['patients', 'search', q] as const,
  patient: (id: string) => ['patients', 'detail', id] as const,
  prescriptions: ['prescriptions'] as const,
  prescriptionList: (f: object) => ['prescriptions', 'list', f] as const,
  prescription: (id: string) => ['prescriptions', 'detail', id] as const,
};

export function usePatients(filters: { q?: string; page: number; pageSize?: number }) {
  return useQuery({
    queryKey: patientKeys.list(filters),
    queryFn: ({ signal }) => api.get<{ data: PatientRow[]; meta: PageMeta }>(`/patients?${toQuery(filters)}`, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function usePatientSearch(q: string) {
  return useQuery<PatientSummary[]>({
    queryKey: patientKeys.search(q),
    queryFn: ({ signal }) => api.get<{ items: PatientSummary[] }>(`/patients/search?${toQuery({ q })}`, { signal }).then((r) => r.items),
    enabled: q.trim().length >= 2,
    placeholderData: keepPreviousData,
  });
}

export function usePatient(id: string | undefined) {
  return useQuery({
    queryKey: patientKeys.patient(id ?? ''),
    queryFn: ({ signal }) => api.get<{ patient: PatientDetail }>(`/patients/${id}`, { signal }).then((r) => r.patient),
    enabled: Boolean(id),
  });
}

export function useSavePatient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: Partial<PatientInput> }) =>
      (id ? api.patch<{ patient: PatientSummary }>(`/patients/${id}`, input) : api.post<{ patient: PatientSummary }>('/patients', input)).then((r) => r.patient),
    onSuccess: () => qc.invalidateQueries({ queryKey: patientKeys.patients }),
  });
}

export function usePrescriptions(filters: PrescriptionFilters, enabled = true) {
  return useQuery({
    queryKey: patientKeys.prescriptionList(filters),
    queryFn: ({ signal }) => api.get<{ data: PrescriptionRow[]; meta: PageMeta }>(`/prescriptions?${toQuery(filters)}`, { signal }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function usePrescription(id: string | undefined) {
  return useQuery({
    queryKey: patientKeys.prescription(id ?? ''),
    queryFn: ({ signal }) => api.get<{ prescription: Prescription }>(`/prescriptions/${id}`, { signal }).then((r) => r.prescription),
    enabled: Boolean(id),
  });
}

function useInvalidatePatients() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: patientKeys.patients });
    void qc.invalidateQueries({ queryKey: patientKeys.prescriptions });
  };
}

export function useCreatePrescription() {
  const invalidate = useInvalidatePatients();
  return useMutation({
    mutationFn: (input: PrescriptionInput) => api.post<{ prescription: Prescription }>('/prescriptions', input).then((r) => r.prescription),
    onSuccess: invalidate,
  });
}

export function useVoidPrescription() {
  const invalidate = useInvalidatePatients();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post<{ prescription: Prescription }>(`/prescriptions/${id}/void`, { reason }).then((r) => r.prescription),
    onSuccess: invalidate,
  });
}
