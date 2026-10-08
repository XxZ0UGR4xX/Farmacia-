import type { PermissionKey, PermissionModule } from '@farmacia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PageMeta } from '../components/ui/Pagination';
import { api } from './client';

// -----------------------------------------------------------------------------
// Tipos
// -----------------------------------------------------------------------------

export type UserStatus = 'ACTIVE' | 'INACTIVE';

export interface Branch {
  id: string;
  code: string;
  name: string;
}

export interface AdminUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  phone: string | null;
  professionalLicense: string | null;
  status: UserStatus;
  isLocked: boolean;
  lockedUntil: string | null;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  role: { id: string; code: string; name: string };
  branches: Branch[];
  defaultBranchId: string | null;
  activeSessions?: number;
}

export interface Role {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isOwner: boolean;
  permissions: PermissionKey[];
  userCount: number;
}

export interface PermissionGroup {
  module: PermissionModule;
  label: string;
  permissions: { key: PermissionKey; description: string; sensitive: boolean }[];
}

export interface UserFilters {
  q?: string;
  roleId?: string;
  status?: UserStatus;
  page: number;
  pageSize?: number;
}

export interface UserInput {
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  professionalLicense: string | null;
  roleId: string;
  branchIds: string[];
  defaultBranchId: string | null;
  temporaryPassword?: string;
}

export interface RoleInput {
  name: string;
  description: string | null;
  permissions: PermissionKey[];
}

// -----------------------------------------------------------------------------
// Claves de caché
// -----------------------------------------------------------------------------

export const adminKeys = {
  users: ['users'] as const,
  userList: (f: UserFilters) => ['users', 'list', f] as const,
  user: (id: string) => ['users', 'detail', id] as const,
  roles: ['roles'] as const,
  role: (id: string) => ['roles', id] as const,
  permissions: ['permissions'] as const,
  branches: ['branches'] as const,
};

function toQuery(filters: UserFilters): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v !== undefined && v !== '') params.set(k, String(v));
  return params.toString();
}

// -----------------------------------------------------------------------------
// Consultas
// -----------------------------------------------------------------------------

export function useUsers(filters: UserFilters) {
  return useQuery({
    queryKey: adminKeys.userList(filters),
    queryFn: ({ signal }) =>
      api.get<{ data: AdminUser[]; meta: PageMeta }>(`/users?${toQuery(filters)}`, { signal }),
    placeholderData: (prev) => prev, // Conserva la tabla mientras carga la siguiente página
  });
}

export function useUser(id: string | null) {
  return useQuery({
    queryKey: adminKeys.user(id ?? ''),
    queryFn: ({ signal }) => api.get<{ user: AdminUser }>(`/users/${id}`, { signal }).then((r) => r.user),
    enabled: Boolean(id),
  });
}

export function useRoles() {
  return useQuery({
    queryKey: adminKeys.roles,
    queryFn: ({ signal }) => api.get<{ roles: Role[] }>('/roles', { signal }).then((r) => r.roles),
  });
}

export function usePermissionGroups() {
  return useQuery({
    queryKey: adminKeys.permissions,
    queryFn: ({ signal }) => api.get<{ groups: PermissionGroup[] }>('/permissions', { signal }).then((r) => r.groups),
    staleTime: Infinity, // El catálogo sólo cambia con una nueva versión
  });
}

export function useBranches() {
  return useQuery({
    queryKey: adminKeys.branches,
    queryFn: ({ signal }) => api.get<{ branches: Branch[] }>('/branches', { signal }).then((r) => r.branches),
    staleTime: 5 * 60_000,
  });
}

// -----------------------------------------------------------------------------
// Mutaciones
// -----------------------------------------------------------------------------

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: adminKeys.users });
    void qc.invalidateQueries({ queryKey: adminKeys.roles });
  };
}

export function useCreateUser() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: UserInput) =>
      api.post<{ user: AdminUser; temporaryPassword: string }>('/users', input),
    onSuccess: invalidate,
  });
}

export function useUpdateUser() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<UserInput> }) =>
      api.patch<{ user: AdminUser }>(`/users/${id}`, input).then((r) => r.user),
    onSuccess: invalidate,
  });
}

export type UserAction = 'deactivate' | 'activate' | 'unlock' | 'revoke-sessions' | 'reset-password';

export function useUserAction() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: UserAction }) =>
      api.post<{ user?: AdminUser; temporaryPassword?: string; revokedSessions?: number }>(
        `/users/${id}/${action}`,
        {},
      ),
    onSuccess: invalidate,
  });
}

export function useSaveRole() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: RoleInput }) =>
      (id ? api.patch<{ role: Role }>(`/roles/${id}`, input) : api.post<{ role: Role }>('/roles', input)).then(
        (r) => r.role,
      ),
    onSuccess: invalidate,
  });
}

export function useDeleteRole() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/roles/${id}`),
    onSuccess: invalidate,
  });
}
