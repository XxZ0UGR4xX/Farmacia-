import { AUDIT_ACTIONS, AUDIT_GROUPS, auditGroup, type AuditGroup } from '@farmacia/shared';
import { clsx } from 'clsx';
import { Download, ScrollText, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { exportAudit, useAuditLog, useAuditUsers, type AuditEntry, type AuditFilters } from '../../api/audit';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, PageHeader } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Checkbox, TextField } from '../../components/ui/FormField';
import { Modal } from '../../components/ui/Modal';
import { Pagination } from '../../components/ui/Pagination';
import { SelectField } from '../../components/ui/SelectField';
import { Spinner } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { formatDateTime } from '../../lib/format';
import { actionLabel, deviceLabel, formatValue, GROUP_TONES, keyLabel, summarize } from './audit-display';

const GROUPS = Object.keys(AUDIT_GROUPS) as AuditGroup[];

export function AuditPage() {
  const toast = useToast();
  const users = useAuditUsers();
  const [filters, setFilters] = useState<AuditFilters>({});
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const [exporting, setExporting] = useState(false);
  const invalidRange = Boolean(filters.from && filters.to && filters.from > filters.to);
  const log = useAuditLog({ ...filters, page, pageSize: 50 }, !invalidRange);
  const rows = log.data?.data ?? [];
  const set = (patch: Partial<AuditFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };
  const actions = Object.keys(AUDIT_ACTIONS).filter((a) => !filters.group || auditGroup(a) === filters.group);

  const download = async () => {
    setExporting(true);
    try {
      await exportAudit(filters);
    } catch {
      toast.error('No se pudo exportar la bitácora');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Auditoría"
        description="Bitácora de lo que hace cada usuario: quién, qué, cuándo y desde dónde. Nadie puede modificarla ni borrarla."
        actions={
          <Button variant="secondary" icon={<Download className="size-4" />} loading={exporting} disabled={invalidRange} onClick={download}>
            Exportar CSV
          </Button>
        }
      />

      <Card className="mb-4 p-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-[1fr_1fr_1.4fr_1.2fr_1.6fr]">
          <TextField label="Desde" type="date" value={filters.from ?? ''} max={filters.to} onChange={(e) => set({ from: e.target.value || undefined })} />
          <TextField label="Hasta" type="date" value={filters.to ?? ''} min={filters.from} onChange={(e) => set({ to: e.target.value || undefined })} />
          <SelectField label="Usuario" value={filters.userId ?? ''} onChange={(e) => set({ userId: e.target.value || undefined })}>
            <option value="">Todos</option>
            {users.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName}
              </option>
            ))}
          </SelectField>
          <SelectField label="Área" value={filters.group ?? ''} onChange={(e) => set({ group: (e.target.value || undefined) as AuditGroup | undefined, action: undefined })}>
            <option value="">Todas</option>
            {GROUPS.map((g) => (
              <option key={g} value={g}>
                {AUDIT_GROUPS[g]}
              </option>
            ))}
          </SelectField>
          <SelectField className="col-span-2 md:col-span-1" label="Acción" value={filters.action ?? ''} onChange={(e) => set({ action: e.target.value || undefined })}>
            <option value="">Todas</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {actionLabel(a)}
              </option>
            ))}
          </SelectField>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <Checkbox label="Sólo eventos de seguridad (intentos fallidos, bloqueos, accesos negados)" checked={Boolean(filters.security)} onChange={(e) => set({ security: e.target.checked || undefined })} />
          {log.data && (
            <p className="flex items-center gap-3 text-sm text-slate-600">
              <span className="tabular-nums">{log.data.summary.total.toLocaleString('es-MX')} eventos</span>
              {log.data.summary.security > 0 && !filters.security && (
                <button type="button" onClick={() => set({ security: true })} className="flex items-center gap-1 font-medium text-red-700 hover:underline">
                  <ShieldAlert className="size-4" /> {log.data.summary.security.toLocaleString('es-MX')} de seguridad
                </button>
              )}
            </p>
          )}
        </div>
      </Card>

      {invalidRange && <Alert tone="warning" className="mb-4">La fecha "Desde" debe ser anterior a "Hasta".</Alert>}
      {log.isError && <Alert tone="error" className="mb-4">No se pudo cargar la bitácora.</Alert>}

      <Card className="overflow-hidden">
        {log.isPending ? (
          <div className="flex justify-center py-16 text-brand-600">
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={ScrollText} title="Sin eventos" description="No hay registros con estos filtros." />
        ) : (
          <div className={clsx(log.isPlaceholderData && 'opacity-60')}>
            <table className="hidden w-full text-sm lg:table">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Fecha y hora</th>
                  <th className="px-4 py-3">Usuario</th>
                  <th className="px-4 py-3">Acción</th>
                  <th className="px-4 py-3">Detalle</th>
                  <th className="px-4 py-3">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setSelected(r)}>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDateTime(r.createdAt)}</td>
                    <td className="px-4 py-3">
                      <span className="block font-medium text-slate-900">{r.user?.fullName ?? 'Sin sesión'}</span>
                      {r.branch && <span className="text-xs text-slate-500">{r.branch.name}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <button type="button" className="text-left font-medium text-slate-900 hover:underline" onClick={() => setSelected(r)}>
                        {actionLabel(r.action)}
                      </button>
                      <span className="mt-0.5 block">
                        <Badge tone={GROUP_TONES[r.group]}>{AUDIT_GROUPS[r.group]}</Badge>
                      </span>
                    </td>
                    <td className="max-w-md px-4 py-3 text-slate-600">
                      <span className="line-clamp-2 break-words">{summarize(r.action, r.metadata) || '—'}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-500">{r.ipAddress ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y divide-slate-100 lg:hidden">
              {rows.map((r) => (
                <li key={r.id}>
                  <button type="button" className="block w-full px-4 py-3 text-left hover:bg-slate-50" onClick={() => setSelected(r)}>
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-900">{actionLabel(r.action)}</span>
                      <Badge tone={GROUP_TONES[r.group]}>{AUDIT_GROUPS[r.group]}</Badge>
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {formatDateTime(r.createdAt)} · {r.user?.fullName ?? 'Sin sesión'}
                    </span>
                    {summarize(r.action, r.metadata) && <span className="mt-1 block truncate text-xs text-slate-600">{summarize(r.action, r.metadata)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {log.data && <Pagination meta={log.data.meta} onPageChange={setPage} />}
      </Card>

      <AuditDetail entry={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function AuditDetail({ entry, onClose }: { entry: AuditEntry | null; onClose: () => void }) {
  const metadata = entry?.metadata && typeof entry.metadata === 'object' && !Array.isArray(entry.metadata) ? (entry.metadata as Record<string, unknown>) : null;
  const changes = metadata && Array.isArray(metadata.changes) ? (metadata.changes as { field: string; before: unknown; after: unknown }[]) : null;
  return (
    <Modal open={entry !== null} onClose={onClose} title={entry ? actionLabel(entry.action) : ''} size="lg">
      {entry && (
        <div className="space-y-4 text-sm">
          <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2">
            <dt className="text-slate-500">Fecha y hora</dt>
            <dd className="text-slate-900">{formatDateTime(entry.createdAt)}</dd>
            <dt className="text-slate-500">Usuario</dt>
            <dd className="text-slate-900">{entry.user ? `${entry.user.fullName} (${entry.user.email})` : 'Sin sesión'}</dd>
            <dt className="text-slate-500">Sucursal</dt>
            <dd className="text-slate-900">{entry.branch?.name ?? '—'}</dd>
            <dt className="text-slate-500">Registro</dt>
            <dd className="break-all text-slate-900">{entry.entityType ? `${entry.entityType} · ${formatValue(entry.entityId)}` : '—'}</dd>
            <dt className="text-slate-500">Origen</dt>
            <dd className="text-slate-900">
              <span className="font-mono">{entry.ipAddress ?? '—'}</span> · {deviceLabel(entry.userAgent)}
            </dd>
          </dl>

          {changes && (
            <div>
              <p className="mb-2 font-medium text-slate-900">Cambios</p>
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="py-1 pr-3">Dato</th>
                    <th className="py-1 pr-3">Antes</th>
                    <th className="py-1">Después</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {changes.map((c) => (
                    <tr key={c.field}>
                      <td className="py-1.5 pr-3 text-slate-600">{keyLabel(c.field)}</td>
                      <td className="py-1.5 pr-3 break-words text-slate-500">{formatValue(c.before)}</td>
                      <td className="py-1.5 break-words text-slate-900">{formatValue(c.after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {metadata && (
            <div>
              <p className="mb-2 font-medium text-slate-900">Detalle</p>
              <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-1.5 rounded-lg bg-slate-50 p-3">
                {Object.entries(metadata)
                  .filter(([k]) => !(changes && k === 'changes'))
                  .map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-slate-500">{keyLabel(k)}</dt>
                      <dd className="break-words text-slate-900">{formatValue(v)}</dd>
                    </div>
                  ))}
              </dl>
            </div>
          )}
          <p className="text-xs text-slate-500">Los registros de auditoría son de sólo lectura: la base de datos impide modificarlos o borrarlos.</p>
        </div>
      )}
    </Modal>
  );
}
