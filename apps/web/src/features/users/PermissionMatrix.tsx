import type { PermissionKey } from '@farmacia/shared';
import { clsx } from 'clsx';
import { ShieldAlert } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { PermissionGroup } from '../../api/admin';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';

function GroupCheckbox({
  checked,
  indeterminate,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  disabled: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={`Seleccionar todos los permisos de ${label}`}
      onChange={(e) => onChange(e.target.checked)}
      className="size-4 accent-brand-600 disabled:opacity-50"
    />
  );
}

/**
 * Matriz de permisos agrupada por módulo. `grantable` limita lo que el usuario actual
 * puede otorgar (nadie otorga permisos que no tiene).
 */
export function PermissionMatrix({
  groups,
  selected,
  onChange,
  readOnly,
  grantable,
}: {
  groups: PermissionGroup[];
  selected: ReadonlySet<PermissionKey>;
  onChange: (next: Set<PermissionKey>) => void;
  readOnly: boolean;
  grantable: (key: PermissionKey) => boolean;
}) {
  const toggle = (keys: PermissionKey[], on: boolean) => {
    const next = new Set(selected);
    for (const k of keys) {
      if (!grantable(k)) continue;
      if (on) next.add(k);
      else next.delete(k);
    }
    onChange(next);
  };

  return (
    // Columnas tipo "masonry": cada módulo ocupa sólo su altura
    <div className="gap-4 lg:columns-2">
      {groups.map((group) => {
        const keys = group.permissions.map((p) => p.key);
        const on = keys.filter((k) => selected.has(k)).length;
        const editable = !readOnly && keys.some(grantable);
        return (
          <Card key={group.module} className="mb-4 overflow-hidden break-inside-avoid">
            <label
              className={clsx(
                'flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3',
                editable && 'cursor-pointer',
              )}
            >
              <GroupCheckbox
                label={group.label}
                checked={on === keys.length}
                indeterminate={on > 0 && on < keys.length}
                disabled={!editable}
                onChange={(checked) => toggle(keys, checked)}
              />
              <span className="flex-1 text-sm font-semibold text-slate-900">{group.label}</span>
              <span className="text-xs text-slate-500">
                {on}/{keys.length}
              </span>
            </label>
            <ul className="divide-y divide-slate-100">
              {group.permissions.map((p) => {
                const disabled = readOnly || !grantable(p.key);
                return (
                  <li key={p.key}>
                    <label className={clsx('flex items-start gap-3 px-4 py-2.5', !disabled && 'cursor-pointer hover:bg-slate-50')}>
                      <input
                        type="checkbox"
                        checked={selected.has(p.key)}
                        disabled={disabled}
                        onChange={(e) => toggle([p.key], e.target.checked)}
                        className="mt-0.5 size-4 accent-brand-600 disabled:opacity-50"
                      />
                      <span className="flex-1">
                        <span className="block text-sm text-slate-800">{p.description}</span>
                        <span className="block font-mono text-[11px] text-slate-400">{p.key}</span>
                      </span>
                      {p.sensitive && (
                        <Badge tone="amber" className="mt-0.5">
                          <ShieldAlert className="size-3" /> Sensible
                        </Badge>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}
