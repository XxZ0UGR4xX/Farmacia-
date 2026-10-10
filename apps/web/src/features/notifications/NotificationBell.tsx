import { clsx } from 'clsx';
import { Bell, CheckCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications, useNotificationsSummary, type AppNotification } from '../../api/notifications';
import { formatRelative } from '../../lib/format';
import { NotificationIcon } from './notification-display';

/** Campana del encabezado: contador de no leídas y las alertas más importantes. */
export function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const summary = useNotificationsSummary();
  const list = useNotifications({}, open);
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const unread = summary.data?.unread ?? 0;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const openItem = (n: AppNotification) => {
    if (!n.read) markRead.mutate(n.id);
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  const items = list.data?.data.slice(0, 8) ?? [];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unread ? `Notificaciones: ${unread} sin leer` : 'Notificaciones'}
        className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
      >
        <Bell className="size-5" />
        {unread > 0 && (
          <span
            className={clsx(
              'absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold text-white',
              (summary.data?.critical ?? 0) > 0 ? 'bg-red-600' : 'bg-amber-500',
            )}
            data-testid="notification-count"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-label="Notificaciones" className="fixed inset-x-2 top-16 z-30 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-96">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="font-semibold text-slate-900">Notificaciones</p>
            {unread > 0 && (
              <button type="button" onClick={() => markAll.mutate()} className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
                <CheckCheck className="size-3.5" /> Marcar todo como leído
              </button>
            )}
          </div>
          {list.isPending ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500">Cargando…</p>
          ) : items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">Todo en orden: no hay alertas activas.</p>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <button type="button" onClick={() => openItem(n)} className={clsx('flex w-full gap-3 px-4 py-3 text-left hover:bg-slate-50', !n.read && 'bg-brand-50/40')}>
                    <NotificationIcon type={n.type} severity={n.severity} />
                    <span className="min-w-0 flex-1">
                      <span className={clsx('block text-sm text-slate-900', !n.read && 'font-semibold')}>{n.title}</span>
                      <span className="block text-xs text-slate-500">{n.message}</span>
                      <span className="mt-0.5 block text-[11px] text-slate-400">{formatRelative(n.createdAt)}</span>
                    </span>
                    {!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-500" aria-label="Sin leer" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Link to="/notificaciones" onClick={() => setOpen(false)} className="block border-t border-slate-100 px-4 py-2.5 text-center text-sm font-medium text-brand-700 hover:bg-slate-50">
            Ver todas{summary.data ? ` (${summary.data.total})` : ''}
          </Link>
        </div>
      )}
    </div>
  );
}
