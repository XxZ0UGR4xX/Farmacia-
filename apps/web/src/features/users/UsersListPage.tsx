import { canGrantRole } from '@farmacia/shared';
import { clsx } from 'clsx';
import {
  KeyRound,
  LockOpen,
  LogOut,
  Pencil,
  Search,
  UserCheck,
  UserPlus,
  Users,
  UserX,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import {
  useBranches,
  useRoles,
  useUserAction,
  useUsers,
  type AdminUser,
  type UserAction,
  type UserStatus,
} from '../../api/admin';
import { ApiError } from '../../api/client';
import { useAuth } from '../../auth/useAuth';
import { ActionMenu, type ActionItem } from '../../components/ui/ActionMenu';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { TextField } from '../../components/ui/FormField';
import { Pagination } from '../../components/ui/Pagination';
import { SelectField } from '../../components/ui/SelectField';
import { Spinner } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { formatDateTime, formatRelative, initials } from '../../lib/format';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { TemporaryPasswordDialog } from './TemporaryPasswordDialog';
import { UserFormDialog } from './UserFormDialog';

type PendingAction = { user: AdminUser; action: Exclude<UserAction, 'activate' | 'unlock'> };

const confirmCopy: Record<PendingAction['action'], { title: string; confirm: string; tone: 'primary' | 'danger'; body: (u: AdminUser) => ReactNode }> = {
  deactivate: {
    title: 'Desactivar usuario',
    confirm: 'Desactivar',
    tone: 'danger',
    body: (u) => (
      <>
        <strong>{u.fullName}</strong> no podrá iniciar sesión y se cerrarán sus sesiones abiertas. Su historial se
        conserva y podrás reactivarlo cuando quieras.
      </>
    ),
  },
  'reset-password': {
    title: 'Restablecer contraseña',
    confirm: 'Generar contraseña temporal',
    tone: 'primary',
    body: (u) => (
      <>
        Se generará una contraseña temporal para <strong>{u.fullName}</strong>, se cerrarán sus sesiones y deberá
        elegir una nueva al entrar.
      </>
    ),
  },
  'revoke-sessions': {
    title: 'Cerrar sesiones',
    confirm: 'Cerrar sesiones',
    tone: 'primary',
    body: (u) => (
      <>
        Se cerrarán todas las sesiones abiertas de <strong>{u.fullName}</strong> en cualquier equipo. Podrá volver a
        entrar con su contraseña.
      </>
    ),
  },
};

function StatusBadges({ user }: { user: AdminUser }) {
  return (
    <div className="flex flex-wrap gap-1">
      {user.status === 'ACTIVE' ? <Badge tone="green">Activo</Badge> : <Badge>Inactivo</Badge>}
      {user.isLocked && <Badge tone="red">Bloqueado</Badge>}
      {user.mustChangePassword && user.status === 'ACTIVE' && <Badge tone="amber">Contraseña temporal</Badge>}
    </div>
  );
}

function Avatar({ user }: { user: AdminUser }) {
  return (
    <span
      className={clsx(
        'flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
        user.status === 'ACTIVE' ? 'bg-brand-100 text-brand-800' : 'bg-slate-100 text-slate-500',
      )}
      aria-hidden
    >
      {initials(user.fullName)}
    </span>
  );
}

export function UsersListPage() {
  const { user: actor, can } = useAuth();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [roleId, setRoleId] = useState('');
  const [status, setStatus] = useState<UserStatus | ''>('');
  const [page, setPage] = useState(1);
  const q = useDebouncedValue(search.trim());

  const users = useUsers({ q, roleId: roleId || undefined, status: status || undefined, page, pageSize: 20 });
  const roles = useRoles();
  const branches = useBranches();
  const userAction = useUserAction();

  const [formUser, setFormUser] = useState<AdminUser | null | 'new'>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [tempPassword, setTempPassword] = useState<{ email: string; fullName: string; password: string; title: string } | null>(null);

  const canManageUsers = can('users.manage');
  const roleById = useMemo(() => new Map((roles.data ?? []).map((r) => [r.id, r])), [roles.data]);

  /** Mismas reglas que el servidor: sin permisos de más, y nunca acciones destructivas sobre uno mismo. */
  const canManage = (target: AdminUser) => {
    const role = roleById.get(target.role.id);
    return Boolean(canManageUsers && actor && role && canGrantRole(actor.role.code, actor.permissions, role));
  };

  const resetFilters = (fn: () => void) => {
    fn();
    setPage(1);
  };

  const runAction = async (user: AdminUser, action: UserAction) => {
    try {
      const result = await userAction.mutateAsync({ id: user.id, action });
      setPending(null);
      if (action === 'reset-password' && result.temporaryPassword) {
        setTempPassword({ email: user.email, fullName: user.fullName, password: result.temporaryPassword, title: 'Contraseña restablecida' });
        return;
      }
      const messages: Record<UserAction, string> = {
        deactivate: `${user.fullName} fue desactivado`,
        activate: `${user.fullName} fue reactivado`,
        unlock: `Se desbloqueó la cuenta de ${user.fullName}`,
        'revoke-sessions': `Se cerraron ${result.revokedSessions ?? 0} sesión(es) de ${user.fullName}`,
        'reset-password': '',
      };
      toast.success(messages[action]);
    } catch (err) {
      setPending(null);
      toast.error(err instanceof ApiError ? err.message : 'No se pudo completar la acción');
    }
  };

  const actionsFor = (u: AdminUser): ActionItem[] => {
    if (!canManage(u)) return [];
    const self = u.id === actor?.id;
    return [
      { label: 'Editar', icon: Pencil, onSelect: () => setFormUser(u) },
      { label: 'Restablecer contraseña', icon: KeyRound, onSelect: () => setPending({ user: u, action: 'reset-password' }), hidden: self },
      { label: 'Desbloquear cuenta', icon: LockOpen, onSelect: () => runAction(u, 'unlock'), hidden: !u.isLocked },
      { label: 'Cerrar sus sesiones', icon: LogOut, onSelect: () => setPending({ user: u, action: 'revoke-sessions' }), hidden: self },
      u.status === 'ACTIVE'
        ? { label: 'Desactivar', icon: UserX, tone: 'danger', onSelect: () => setPending({ user: u, action: 'deactivate' }), hidden: self }
        : { label: 'Reactivar', icon: UserCheck, onSelect: () => runAction(u, 'activate') },
    ];
  };

  const list = users.data?.data ?? [];
  const hasFilters = Boolean(q || roleId || status);

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end">
        <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-[1fr_auto_auto]">
          <TextField
            className="col-span-2 sm:col-span-1"
            label="Buscar"
            placeholder="Nombre o correo"
            icon={<Search className="size-4" />}
            value={search}
            onChange={(e) => resetFilters(() => setSearch(e.target.value))}
          />
          <SelectField label="Rol" value={roleId} onChange={(e) => resetFilters(() => setRoleId(e.target.value))}>
            <option value="">Todos los roles</option>
            {roles.data?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Estado"
            value={status}
            onChange={(e) => resetFilters(() => setStatus(e.target.value as UserStatus | ''))}
          >
            <option value="">Todos</option>
            <option value="ACTIVE">Activos</option>
            <option value="INACTIVE">Inactivos</option>
          </SelectField>
        </div>
        {canManageUsers && (
          <Button onClick={() => setFormUser('new')} icon={<UserPlus className="size-4" />} className="h-11">
            Nuevo usuario
          </Button>
        )}
      </div>

      {users.isError && <Alert tone="error">No se pudieron cargar los usuarios.</Alert>}

      <Card className="overflow-hidden">
        {users.isPending ? (
          <div className="flex justify-center py-16 text-brand-600">
            <Spinner />
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            icon={Users}
            title={hasFilters ? 'Sin resultados' : 'Aún no hay usuarios'}
            description={hasFilters ? 'Prueba con otra búsqueda o quita los filtros.' : undefined}
          />
        ) : (
          <>
            {/* Escritorio: tabla */}
            <table className="hidden w-full text-sm md:table">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Usuario</th>
                  <th className="px-4 py-3">Rol</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3">Último acceso</th>
                  <th className="px-4 py-3">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.map((u) => (
                  <tr key={u.id} className={clsx(u.status === 'INACTIVE' && 'bg-slate-50/60')}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar user={u} />
                        <div className="min-w-0">
                          <p className="flex items-center gap-2 font-medium text-slate-900">
                            <span className="truncate">{u.fullName}</span>
                            {u.id === actor?.id && <Badge tone="blue">Tú</Badge>}
                          </p>
                          <p className="truncate text-slate-500">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={u.role.code === 'OWNER' ? 'violet' : 'neutral'}>{u.role.name}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadges user={u} />
                    </td>
                    <td className="px-4 py-3 text-slate-500" title={formatDateTime(u.lastLoginAt)}>
                      {formatRelative(u.lastLoginAt)}
                    </td>
                    <td className="px-2 py-3 text-right">
                      <ActionMenu label={`Acciones para ${u.fullName}`} items={actionsFor(u)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Celular y tablet: tarjetas */}
            <ul className="divide-y divide-slate-100 md:hidden">
              {list.map((u) => (
                <li key={u.id} className="flex items-start gap-3 p-4">
                  <Avatar user={u} />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div>
                      <p className="flex items-center gap-2 font-medium text-slate-900">
                        <span className="truncate">{u.fullName}</span>
                        {u.id === actor?.id && <Badge tone="blue">Tú</Badge>}
                      </p>
                      <p className="truncate text-sm text-slate-500">{u.email}</p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={u.role.code === 'OWNER' ? 'violet' : 'neutral'}>{u.role.name}</Badge>
                      <StatusBadges user={u} />
                    </div>
                    <p className="text-xs text-slate-400">Último acceso: {formatRelative(u.lastLoginAt)}</p>
                  </div>
                  <ActionMenu label={`Acciones para ${u.fullName}`} items={actionsFor(u)} />
                </li>
              ))}
            </ul>
          </>
        )}
        {users.data && <Pagination meta={users.data.meta} onPageChange={setPage} />}
      </Card>

      <UserFormDialog
        open={formUser !== null}
        user={formUser === 'new' ? null : formUser}
        roles={roles.data ?? []}
        branches={branches.data ?? []}
        onClose={() => setFormUser(null)}
        onCreated={({ user, temporaryPassword }) => {
          setFormUser(null);
          setTempPassword({ email: user.email, fullName: user.fullName, password: temporaryPassword, title: 'Usuario creado' });
        }}
        onUpdated={(user) => {
          setFormUser(null);
          toast.success(`Se guardaron los cambios de ${user.fullName}`);
        }}
      />

      {pending && (
        <ConfirmDialog
          open
          title={confirmCopy[pending.action].title}
          confirmLabel={confirmCopy[pending.action].confirm}
          tone={confirmCopy[pending.action].tone}
          loading={userAction.isPending}
          onCancel={() => setPending(null)}
          onConfirm={() => runAction(pending.user, pending.action)}
        >
          {confirmCopy[pending.action].body(pending.user)}
        </ConfirmDialog>
      )}

      <TemporaryPasswordDialog data={tempPassword} onClose={() => setTempPassword(null)} />
    </>
  );
}
