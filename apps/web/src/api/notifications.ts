import type { NotificationSeverity, NotificationType } from '@farmacia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { toQuery } from './inventory';

export interface AppNotification {
  id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  message: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

export interface NotificationsSummary {
  unread: number;
  total: number;
  critical: number;
}

export const notificationKeys = {
  all: ['notifications'] as const,
  list: (f: object) => ['notifications', 'list', f] as const,
  summary: ['notifications', 'summary'] as const,
};

/** Contador de la campana: se actualiza cada minuto. */
export function useNotificationsSummary(enabled = true) {
  return useQuery({
    queryKey: notificationKeys.summary,
    queryFn: ({ signal }) => api.get<NotificationsSummary>('/notifications/summary', { signal }),
    refetchInterval: 60_000,
    enabled,
  });
}

export function useNotifications(filters: { type?: NotificationType; unread?: boolean }, enabled = true) {
  return useQuery({
    queryKey: notificationKeys.list(filters),
    queryFn: ({ signal }) =>
      api.get<{ data: AppNotification[]; summary: NotificationsSummary }>(`/notifications?${toQuery(filters)}`, { signal }),
    enabled,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<void>(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ marked: number }>('/notifications/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}
