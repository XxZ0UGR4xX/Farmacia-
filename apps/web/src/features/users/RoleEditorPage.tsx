import { canGrantRole, hasPermission, type PermissionKey } from '@farmacia/shared';
import { ArrowLeft, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { usePermissionGroups, useRoles, useDeleteRole, useSaveRole } from '../../api/admin';
import { ApiError } from '../../api/client';
import { useAuth } from '../../auth/useAuth';
import { Alert } from '../../components/ui/Alert';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { TextField } from '../../components/ui/FormField';
import { Spinner } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { PermissionMatrix } from './PermissionMatrix';

export function RoleEditorPage() {
  const { id } = useParams();
  const isNew = id === undefined;
  const navigate = useNavigate();
  const toast = useToast();
  const { user: actor, can } = useAuth();
  const roles = useRoles();
  const groups = usePermissionGroups();
  const saveRole = useSaveRole();
  const deleteRole = useDeleteRole();

  const role = isNew ? null : roles.data?.find((r) => r.id === id);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<Set<PermissionKey>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [loadedId, setLoadedId] = useState<string | null>(null);

  // Cargar el rol una sola vez: una recarga de la lista no debe borrar lo que se está editando
  useEffect(() => {
    if (role && role.id !== loadedId) {
      setName(role.name);
      setDescription(role.description ?? '');
      setSelected(new Set(role.permissions));
      setLoadedId(role.id);
    }
  }, [role, loadedId]);

  // Por qué el rol no se puede editar (mismas reglas que el servidor)
  const readOnlyReason = useMemo(() => {
    if (!actor) return null;
    if (!can('roles.manage')) return 'Puedes consultar este rol, pero no tienes permiso para modificar roles.';
    if (role?.isOwner) return 'El rol Propietario siempre tiene acceso total y no se puede modificar.';
    if (role && role.code === actor.role.code) return 'No puedes modificar tu propio rol. Pídeselo al propietario.';
    if (role && !canGrantRole(actor.role.code, actor.permissions, role)) {
      return 'Este rol tiene permisos que tú no tienes, por lo que no puedes modificarlo.';
    }
    return null;
  }, [actor, can, role]);
  const readOnly = readOnlyReason !== null;

  const grantable = (key: PermissionKey) => (actor ? hasPermission(actor.role.code, actor.permissions, key) : false);

  if (roles.isPending || groups.isPending) {
    return (
      <div className="flex justify-center py-16 text-brand-600">
        <Spinner />
      </div>
    );
  }
  if (!isNew && !role) {
    return <Alert tone="error">El rol no existe o fue eliminado.</Alert>;
  }

  const onSave = async () => {
    setErrors({});
    setFormError(null);
    if (name.trim().length < 2) {
      setErrors({ name: 'El nombre debe tener al menos 2 caracteres' });
      return;
    }
    try {
      const saved = await saveRole.mutateAsync({
        id: role?.id,
        input: { name: name.trim(), description: description.trim() || null, permissions: [...selected] },
      });
      toast.success(isNew ? `Rol "${saved.name}" creado` : `Se guardaron los cambios de "${saved.name}"`);
      navigate('/usuarios/roles');
    } catch (err) {
      if (err instanceof ApiError) {
        const fields = err.fieldErrors();
        if (fields.name) setErrors({ name: fields.name });
        else setFormError(err.message);
      } else {
        setFormError('No se pudo guardar el rol.');
      }
    }
  };

  const onDelete = async () => {
    if (!role) return;
    try {
      await deleteRole.mutateAsync(role.id);
      toast.success(`Rol "${role.name}" eliminado`);
      navigate('/usuarios/roles');
    } catch (err) {
      setConfirmDelete(false);
      toast.error(err instanceof ApiError ? err.message : 'No se pudo eliminar el rol');
    }
  };

  return (
    <div className="pb-24">
      <Link
        to="/usuarios/roles"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="size-4" /> Roles y permisos
      </Link>

      {readOnlyReason && (
        <Alert tone="info" className="mb-4">
          {readOnlyReason}
        </Alert>
      )}
      {formError && (
        <Alert tone="error" className="mb-4">
          {formError}
        </Alert>
      )}

      <Card className="mb-6 p-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
          <TextField
            label="Nombre del rol"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={readOnly}
            error={errors.name}
            placeholder="Ej. Auxiliar de mostrador"
          />
          <TextField
            label="Descripción"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={readOnly}
            placeholder="Qué hace este puesto"
          />
        </div>
        {role && (
          <p className="mt-3 text-xs text-slate-500">
            Asignado a {role.userCount} {role.userCount === 1 ? 'usuario' : 'usuarios'}. Los cambios de permisos se aplican
            de inmediato a sus sesiones abiertas.
          </p>
        )}
      </Card>

      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-base font-semibold text-slate-900">Permisos</h2>
        <p className="text-sm text-slate-500">{selected.size} seleccionados</p>
      </div>
      <PermissionMatrix
        groups={groups.data ?? []}
        selected={selected}
        onChange={setSelected}
        readOnly={readOnly}
        grantable={grantable}
      />

      {!readOnly && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur lg:left-64">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <div>
              {role && !role.isSystem && (
                <Button variant="ghost" className="text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => setConfirmDelete(true)} icon={<Trash2 className="size-4" />}>
                  Eliminar rol
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <ButtonLink to="/usuarios/roles" variant="secondary">
                Cancelar
              </ButtonLink>
              <Button onClick={onSave} loading={saveRole.isPending} icon={<Save className="size-4" />}>
                {isNew ? 'Crear rol' : 'Guardar cambios'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Eliminar rol"
        confirmLabel="Eliminar"
        tone="danger"
        loading={deleteRole.isPending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={onDelete}
      >
        {role && role.userCount > 0 ? (
          <>
            El rol <strong>{role.name}</strong> está asignado a {role.userCount} usuario(s). Debes reasignarlos a otro rol
            antes de eliminarlo.
          </>
        ) : (
          <>
            ¿Eliminar el rol <strong>{role?.name}</strong>? Esta acción queda registrada en la auditoría.
          </>
        )}
      </ConfirmDialog>
    </div>
  );
}
