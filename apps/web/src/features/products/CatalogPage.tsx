import { Building2, FolderTree, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import {
  useCatalog,
  useDeleteCatalogItem,
  useSaveCatalogItem,
  type CatalogItem,
  type CatalogKind,
} from '../../api/catalog';
import { ApiError } from '../../api/client';
import { useAuth } from '../../auth/useAuth';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { TextField } from '../../components/ui/FormField';
import { Modal } from '../../components/ui/Modal';
import { Spinner } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';

interface FieldDef {
  name: 'description' | 'country' | 'website';
  label: string;
  placeholder?: string;
}

interface KindConfig {
  icon: typeof FolderTree;
  fields: FieldDef[];
  intro: string;
  newLabel: string;
  editTitle: string;
  deleteTitle: string;
  emptyTitle: string;
  confirmDelete: (name: string) => string;
  inUse: (name: string, count: number) => string;
}

// Frases completas por tipo (concordancia de género en español)
const CONFIG: Record<CatalogKind, KindConfig> = {
  categories: {
    icon: FolderTree,
    fields: [{ name: 'description', label: 'Descripción', placeholder: 'Ej. Dolor y fiebre' }],
    intro: 'Agrupa los productos para buscarlos, filtrarlos y ver reportes por categoría.',
    newLabel: 'Nueva categoría',
    editTitle: 'Editar categoría',
    deleteTitle: 'Eliminar categoría',
    emptyTitle: 'Aún no hay categorías',
    confirmDelete: (name) => `¿Eliminar la categoría "${name}"?`,
    inUse: (name, n) => `"${name}" tiene ${n} producto(s). Asígnalos a otra categoría antes de eliminarla.`,
  },
  laboratories: {
    icon: Building2,
    fields: [
      { name: 'country', label: 'País', placeholder: 'Ej. México' },
      { name: 'website', label: 'Sitio web', placeholder: 'https://' },
    ],
    intro: 'Laboratorios que fabrican o distribuyen los medicamentos.',
    newLabel: 'Nuevo laboratorio',
    editTitle: 'Editar laboratorio',
    deleteTitle: 'Eliminar laboratorio',
    emptyTitle: 'Aún no hay laboratorios',
    confirmDelete: (name) => `¿Eliminar el laboratorio "${name}"?`,
    inUse: (name, n) => `"${name}" tiene ${n} producto(s). Asígnalos a otro laboratorio antes de eliminarlo.`,
  },
};

export function CatalogPage({ kind }: { kind: CatalogKind }) {
  const cfg = CONFIG[kind];
  const { can } = useAuth();
  const toast = useToast();
  const items = useCatalog(kind);
  const save = useSaveCatalogItem(kind);
  const remove = useDeleteCatalogItem(kind);
  const canManage = can('catalogs.manage');

  const [editing, setEditing] = useState<CatalogItem | 'new' | null>(null);
  const [deleting, setDeleting] = useState<CatalogItem | null>(null);

  const onDelete = async () => {
    if (!deleting) return;
    try {
      await remove.mutateAsync(deleting.id);
      toast.success(`Se eliminó "${deleting.name}"`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo eliminar');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-slate-500">{cfg.intro}</p>
        {canManage && (
          <Button onClick={() => setEditing('new')} icon={<Plus className="size-4" />}>
            {cfg.newLabel}
          </Button>
        )}
      </div>

      {items.isError && <Alert tone="error">No se pudo cargar el catálogo.</Alert>}

      <Card className="overflow-hidden">
        {items.isPending ? (
          <div className="flex justify-center py-16 text-brand-600">
            <Spinner />
          </div>
        ) : items.data?.length === 0 ? (
          <EmptyState icon={cfg.icon} title={cfg.emptyTitle} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.data?.map((item) => (
              <li key={item.id} className="flex items-center gap-3 px-4 py-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                  <cfg.icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900">{item.name}</p>
                  <p className="truncate text-sm text-slate-500">
                    {cfg.fields
                      .map((f) => item[f.name])
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </p>
                </div>
                <span className="shrink-0 text-sm text-slate-500">
                  {item.productCount} {item.productCount === 1 ? 'producto' : 'productos'}
                </span>
                {canManage && (
                  <div className="flex shrink-0">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(item)} aria-label={`Editar ${item.name}`} icon={<Pencil className="size-4" />} />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:bg-red-50"
                      onClick={() => setDeleting(item)}
                      aria-label={`Eliminar ${item.name}`}
                      icon={<Trash2 className="size-4" />}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <CatalogItemDialog
        kind={kind}
        item={editing === 'new' ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
        onSaved={(saved, isNew) => {
          setEditing(null);
          toast.success(isNew ? `"${saved.name}" agregado` : `Se guardaron los cambios de "${saved.name}"`);
        }}
        saving={save.isPending}
        onSave={(input) => save.mutateAsync({ id: editing && editing !== 'new' ? editing.id : undefined, input })}
      />

      <ConfirmDialog
        open={deleting !== null}
        title={cfg.deleteTitle}
        confirmLabel="Eliminar"
        tone="danger"
        loading={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={onDelete}
      >
        {deleting &&
          (deleting.productCount > 0
            ? cfg.inUse(deleting.name, deleting.productCount)
            : cfg.confirmDelete(deleting.name))}
      </ConfirmDialog>
    </>
  );
}

function CatalogItemDialog({
  kind,
  item,
  open,
  saving,
  onClose,
  onSave,
  onSaved,
}: {
  kind: CatalogKind;
  item: CatalogItem | null;
  open: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (input: Record<string, unknown>) => Promise<CatalogItem>;
  onSaved: (item: CatalogItem, isNew: boolean) => void;
}) {
  const cfg = CONFIG[kind];
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setFormError(null);
    setValues({
      name: item?.name ?? '',
      ...Object.fromEntries(cfg.fields.map((f) => [f.name, (item?.[f.name] as string | null | undefined) ?? ''])),
    });
  }, [open, item, cfg.fields]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if ((values.name ?? '').trim().length < 2) {
      setErrors({ name: 'El nombre debe tener al menos 2 caracteres' });
      return;
    }
    try {
      onSaved(await onSave(values), item === null);
    } catch (err) {
      if (err instanceof ApiError) {
        const fields = err.fieldErrors();
        if (Object.keys(fields).length) setErrors(fields);
        else setFormError(err.message);
      } else {
        setFormError('No se pudo guardar.');
      }
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={saving}
      size="sm"
      title={item ? cfg.editTitle : cfg.newLabel}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" form="catalog-form" loading={saving}>
            Guardar
          </Button>
        </>
      }
    >
      <form id="catalog-form" onSubmit={submit} noValidate className="space-y-4">
        {formError && <Alert tone="error">{formError}</Alert>}
        <TextField
          label="Nombre"
          value={values.name ?? ''}
          onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
          error={errors.name}
        />
        {cfg.fields.map((f) => (
          <TextField
            key={f.name}
            label={`${f.label} (opcional)`}
            placeholder={f.placeholder}
            value={values[f.name] ?? ''}
            onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
            error={errors[f.name]}
          />
        ))}
      </form>
    </Modal>
  );
}
