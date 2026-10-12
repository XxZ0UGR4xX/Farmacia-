import type { AuditGroup } from '@farmacia/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, downloadFile } from './client';
import { toQuery } from './inventory';

export interface AuditEntry {
  id: string;
  createdAt: string;
  action: string;
  group: AuditGroup;
  user: { id: string; fullName: string; email: string } | null;
  branch: { id: string; name: string } | null;
  entityType: string | null;
  entityId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: unknown;
}

export interface AuditFilters {
  from?: string;
  to?: string;
  userId?: string;
  group?: AuditGroup;
  action?: string;
  security?: boolean;
  page?: number;
  pageSize?: number;
}

interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function useAuditLog(filters: AuditFilters, enabled = true) {
  return useQuery({
    queryKey: ['audit', 'list', filters],
    queryFn: ({ signal }) => api.get<{ data: AuditEntry[]; meta: PageMeta; summary: { total: number; security: number } }>(`/audit?${toQuery(filters)}`, { signal }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useAuditUsers() {
  return useQuery({
    queryKey: ['audit', 'users'],
    queryFn: ({ signal }) => api.get<{ users: { id: string; fullName: string; email: string }[] }>('/audit/users', { signal }).then((r) => r.users),
    staleTime: 5 * 60_000,
  });
}

export function exportAudit(filters: AuditFilters) {
  const { page: _p, pageSize: _s, ...rest } = filters;
  return downloadFile(`/audit/export?${toQuery(rest)}`, 'auditoria.csv');
}
