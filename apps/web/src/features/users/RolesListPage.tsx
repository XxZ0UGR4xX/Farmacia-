import { ALL_PERMISSIONS } from '@farmacia/shared';
import { ChevronRight, Crown, KeyRound, Plus, Users } from 'lucide-react';
import { Link } from 'react-router';
import { useRoles } from '../../api/admin';
import { useAuth } from '../../auth/useAuth';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { ButtonLink } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Spinner } from '../../components/ui/Spinner';

export function RolesListPage() {
  const { can } = useAuth();
  const roles = useRoles();
  const total = ALL_PERMISSIONS.length;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-slate-500">
          Cada usuario tiene un rol, y el rol define qué puede ver y hacer. Puedes ajustar los roles existentes o crear
          roles nuevos para puestos específicos.
        </p>
        {can('roles.manage') && (
          <ButtonLink to="/usuarios/roles/nuevo" icon={<Plus className="size-4" />}>
            Nuevo rol
          </ButtonLink>
        )}
      </div>

      {roles.isError && <Alert tone="error">No se pudieron cargar los roles.</Alert>}
      {roles.isPending && (
        <div className="flex justify-center py-16 text-brand-600">
          <Spinner />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {roles.data?.map((role) => {
          const count = role.permissions.length;
          return (
            <Link key={role.id} to={`/usuarios/roles/${role.id}`} className="group">
              <Card className="flex h-full flex-col p-5 transition group-hover:border-brand-300 group-hover:shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span
                      className={
                        role.isOwner
                          ? 'flex size-10 items-center justify-center rounded-lg bg-violet-50 text-violet-700'
                          : 'flex size-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700'
                      }
                    >
                      {role.isOwner ? <Crown className="size-5" /> : <KeyRound className="size-5" />}
                    </span>
                    <div>
                      <h3 className="font-semibold text-slate-900">{role.name}</h3>
                      {role.isSystem ? <Badge>Del sistema</Badge> : <Badge tone="blue">Personalizado</Badge>}
                    </div>
                  </div>
                  <ChevronRight className="size-5 text-slate-300 transition group-hover:text-brand-600" />
                </div>
                <p className="mt-3 line-clamp-2 flex-1 text-sm text-slate-500">{role.description ?? 'Sin descripción'}</p>
                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>{role.isOwner ? 'Acceso total' : `${count} de ${total} permisos`}</span>
                    <span className="inline-flex items-center gap-1">
                      <Users className="size-3.5" />
                      {role.userCount} {role.userCount === 1 ? 'usuario' : 'usuarios'}
                    </span>
                  </div>
                  <div
                    className="h-1.5 overflow-hidden rounded-full bg-slate-100"
                    role="progressbar"
                    aria-label={`Permisos de ${role.name}`}
                    aria-valuemin={0}
                    aria-valuemax={total}
                    aria-valuenow={count}
                  >
                    <div
                      className={role.isOwner ? 'h-full bg-violet-500' : 'h-full bg-brand-500'}
                      style={{ width: `${(count / total) * 100}%` }}
                    />
                  </div>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </>
  );
}
