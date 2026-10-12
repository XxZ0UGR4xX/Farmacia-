import type { MarginBasis } from '@farmacia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

export interface PharmacyProfile {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
}

export interface PharmacyFiscal {
  rfc: string | null;
  legalName: string | null;
  taxRegime: string | null;
  fiscalAddress: string | null;
  zipCode: string | null;
}

export interface SettingsValues {
  'pharmacy.profile': PharmacyProfile;
  'pharmacy.fiscal': PharmacyFiscal;
  'pharmacy.taxes': { defaultRate: number; pricesIncludeTax: boolean };
  'inventory.defaults': { defaultMarginPercent: number; marginBasis: MarginBasis; defaultMinStock: number };
  'alerts.expiry': { criticalDays: number; warningDays: number };
}

export type SettingKey = keyof SettingsValues;

export type SettingsMap = { [K in SettingKey]: { value: SettingsValues[K]; updatedAt: string | null; updatedBy: string | null } };

export interface BranchAdmin {
  id: string;
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  users: number;
}

export type BranchInput = Omit<BranchAdmin, 'id' | 'users'>;

export const settingsKeys = {
  all: ['settings'] as const,
  list: ['settings', 'all'] as const,
  branches: ['settings', 'branches'] as const,
};

export function useSettings() {
  return useQuery({
    queryKey: settingsKeys.list,
    queryFn: ({ signal }) => api.get<{ settings: SettingsMap }>('/settings', { signal }).then((r) => r.settings),
  });
}

export function useUpdateSetting<K extends SettingKey>(key: K) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (value: SettingsValues[K]) => api.put<{ settings: SettingsMap }>(`/settings/${key}`, value).then((r) => r.settings),
    onSuccess: (settings) => {
      qc.setQueryData(settingsKeys.list, settings);
      // Margen, IVA y stock mínimo predeterminados; días de caducidad (alertas y reportes)
      void qc.invalidateQueries({ queryKey: settingsKeys.all });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: ['reports'] });
    },
  });
}

export function useBranchesAdmin(enabled = true) {
  return useQuery({
    queryKey: settingsKeys.branches,
    queryFn: ({ signal }) => api.get<{ branches: BranchAdmin[] }>('/settings/branches', { signal }).then((r) => r.branches),
    enabled,
  });
}

export function useSaveBranch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: Partial<BranchInput> }) =>
      (id ? api.patch<{ branch: BranchAdmin }>(`/settings/branches/${id}`, input) : api.post<{ branch: BranchAdmin }>('/settings/branches', input)).then((r) => r.branch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: settingsKeys.branches });
      void qc.invalidateQueries({ queryKey: ['branches'] });
    },
  });
}
