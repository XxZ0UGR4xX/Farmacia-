import { NOTIFICATION_PERMISSIONS, NOTIFICATION_TYPE_LABELS, NOTIFICATION_TYPES, type NotificationType } from '@farmacia/shared';
import { clsx } from 'clsx';
import { BellOff, CheckCheck } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications } from '../../api/notifications';
import { useAuth } from '../../auth/useAuth';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card, PageHeader } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Spinner } from '../../components/ui/Spinner';
import { formatRelative } from '../../lib/format';
import { NotificationIcon } from './notification-display';

export function NotificationsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [type, setType] = useState<NotificationType | undefined>();
  const [unread, setUnread] = useState(false);
  const list = useNotifications({ type, unread: unread || undefined });
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const rows = list.data?.data ?? [];
  // Sólo se ofrecen los filtros de alertas que el usuario puede ver
  const types = NOTIFICATION_TYPES.filter((t) => t !== 'SYSTEM' && NOTIFICATION_PERMISSIONS[t].some((p) => can(p)));

  return (
    <div>
      <PageHeader
        title="Notificaciones"
        description="Alertas activas de la sucursal. Se cierran solas cuando el problema se resuelve."
        actions={
          (list.data?.summary.unread ?? 0) > 0 && (
            <Button variant="secondary" onClick={() => markAll.mutate()} loading={markAll.isPending} icon={<CheckCheck className="size-4" />}>
              Marcar todo como leído
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filtrar por tipo">
        {[undefined, ...types].map((t) => (
          <button
            key={t ?? 'all'}
            type="button"
            aria-pressed={type === t}
            onClick={() => setType(t)}
            className={clsx(
              'rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset transition',
              type === t ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50',
            )}
          >
            {t ? NOTIFICATION_TYPE_LABELS[t] : 'Todas'}
          </button>
        ))}
        <label className="ml-auto inline-flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" className="size-4 accent-brand-600" checked={unread} onChange={(e) => setUnread(e.target.checked)} />
          Sólo sin leer
        </label>
      </div>

      {list.isError && <Alert tone="error">No se pudieron cargar las notificaciones.</Alert>}

      <Card className="overflow-hidden">
        {list.isPending ? (
          <div className="flex justify-center py-16 text-brand-600">
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={BellOff} title="Sin alertas" description="No hay alertas activas con estos filtros." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((n) => (
              <li key={n.id} className={clsx('flex items-start gap-3 px-4 py-4 sm:px-5', !n.read && 'bg-brand-50/40')}>
                <NotificationIcon type={n.type} severity={n.severity} />
                <div className="min-w-0 flex-1">
                  <p className={clsx('text-sm text-slate-900', !n.read && 'font-semibold')}>{n.title}</p>
                  <p className="text-sm text-slate-600">{n.message}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {NOTIFICATION_TYPE_LABELS[n.type]} · {formatRelative(n.createdAt)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center">
                  {n.link && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        if (!n.read) markRead.mutate(n.id);
                        navigate(n.link!);
                      }}
                    >
                      Ver
                    </Button>
                  )}
                  {!n.read && (
                    <Button size="sm" variant="ghost" onClick={() => markRead.mutate(n.id)}>
                      Marcar leída
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
