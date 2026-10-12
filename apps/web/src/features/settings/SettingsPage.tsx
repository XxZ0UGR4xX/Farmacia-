import { MARGIN_BASIS_LABELS, MARGIN_BASES, MAX_PRICE_MARGIN, RFC_REGEX, suggestSalePrice, type MarginBasis } from '@farmacia/shared';
import { clsx } from 'clsx';
import { Calculator, Save } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError } from '../../api/client';
import { useSettings, useUpdateSetting, type SettingKey, type SettingsMap, type SettingsValues } from '../../api/settings';
import { useAuth } from '../../auth/useAuth';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader, PageHeader } from '../../components/ui/Card';
import { Checkbox, TextField } from '../../components/ui/FormField';
import { SelectField } from '../../components/ui/SelectField';
import { Spinner } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { formatDateTime, formatMoney } from '../../lib/format';
import { BranchesSection } from './BranchesSection';

type Values = Record<string, string | boolean>;

const text = (v: string | null | undefined) => v ?? '';
const orNull = (v: string | boolean | undefined) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Una sección editable: guarda sólo su clave, valida en el navegador lo evidente y muestra
 * los errores que devuelve el servidor junto a cada campo.
 */
function SettingSection<K extends SettingKey>({
  settingKey,
  settings,
  title,
  description,
  toValues,
  toPayload,
  validate,
  children,
}: {
  settingKey: K;
  settings: SettingsMap;
  title: string;
  description: string;
  toValues: (v: SettingsValues[K]) => Values;
  toPayload: (v: Values) => SettingsValues[K];
  validate?: (v: Values) => Record<string, string>;
  children: (field: FieldApi) => ReactNode;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const readOnly = !can('settings.manage');
  const entry = settings[settingKey];
  const save = useUpdateSetting(settingKey);
  const [values, setValues] = useState<Values>(() => toValues(entry.value));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const initial = JSON.stringify(toValues(entry.value));
  const dirty = JSON.stringify(values) !== initial;

  // Al guardar (o si el valor vigente cambió en el servidor) el formulario toma el valor guardado
  useEffect(() => setValues(JSON.parse(initial) as Values), [initial]);

  const field: FieldApi = {
    values,
    readOnly,
    text: (name) => ({
      value: String(values[name] ?? ''),
      error: errors[name],
      disabled: readOnly,
      onChange: (e: { target: { value: string } }) => setValues((v) => ({ ...v, [name]: e.target.value })),
    }),
    set: (name, value) => setValues((v) => ({ ...v, [name]: value })),
    error: (name) => errors[name],
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const errs = validate?.(values) ?? {};
    setErrors(errs);
    if (Object.keys(errs).length) return;
    try {
      await save.mutateAsync(toPayload(values));
      toast.success(`${title}: cambios guardados`);
    } catch (err) {
      if (err instanceof ApiError) {
        const fields = err.fieldErrors();
        if (Object.keys(fields).length) setErrors(fields);
        else setFormError(err.message);
      } else setFormError('No se pudo guardar.');
    }
  };

  return (
    <Card>
      <CardHeader title={title} description={description} />
      <form onSubmit={submit} noValidate className="space-y-4 p-5">
        {formError && <Alert tone="error">{formError}</Alert>}
        {children(field)}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <p className="text-xs text-slate-500">
            {entry.updatedAt ? `Última modificación: ${formatDateTime(entry.updatedAt)}${entry.updatedBy ? ` por ${entry.updatedBy}` : ''}` : 'Valores iniciales del sistema'}
          </p>
          {!readOnly && (
            <div className="ml-auto flex gap-2">
              {dirty && (
                <Button variant="ghost" onClick={() => setValues(JSON.parse(initial) as Values)} disabled={save.isPending}>
                  Descartar
                </Button>
              )}
              <Button type="submit" icon={<Save className="size-4" />} loading={save.isPending} disabled={!dirty}>
                Guardar
              </Button>
            </div>
          )}
        </div>
      </form>
    </Card>
  );
}

interface FieldApi {
  values: Values;
  readOnly: boolean;
  text: (name: string) => { value: string; error?: string; disabled: boolean; onChange: (e: { target: { value: string } }) => void };
  set: (name: string, value: string | boolean) => void;
  error: (name: string) => string | undefined;
}

const intIn = (v: string | boolean | undefined, min: number, max: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max;
};

export function SettingsPage() {
  const { can } = useAuth();
  const settings = useSettings();

  return (
    <div>
      <PageHeader title="Configuración" description="Datos de la farmacia, precios, impuestos, alertas y sucursales." />
      {!can('settings.manage') && (
        <Alert tone="info" className="mb-6">
          Puedes consultar la configuración, pero sólo el propietario o el administrador la modifican.
        </Alert>
      )}
      {settings.isError && <Alert tone="error">No se pudo cargar la configuración.</Alert>}
      {settings.isPending ? (
        <div className="flex justify-center py-16 text-brand-600">
          <Spinner />
        </div>
      ) : (
        settings.data && (
          <div className="grid gap-6 xl:grid-cols-2">
            <SettingSection
              settingKey="pharmacy.profile"
              settings={settings.data}
              title="Datos de la farmacia"
              description="Aparecen en el encabezado del ticket de venta."
              toValues={(v) => ({ name: v.name, phone: text(v.phone), email: text(v.email), address: text(v.address) })}
              toPayload={(v) => ({ name: String(v.name).trim(), phone: orNull(v.phone), email: orNull(v.email), address: orNull(v.address) })}
              validate={(v): Record<string, string> => (String(v.name).trim().length < 2 ? { name: 'El nombre es obligatorio' } : {})}
            >
              {(f) => (
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField label="Nombre comercial" className="sm:col-span-2" {...f.text('name')} />
                  <TextField label="Teléfono (opcional)" type="tel" {...f.text('phone')} />
                  <TextField label="Correo (opcional)" type="email" {...f.text('email')} />
                  <TextField label="Dirección (opcional)" className="sm:col-span-2" {...f.text('address')} />
                </div>
              )}
            </SettingSection>

            <SettingSection
              settingKey="pharmacy.fiscal"
              settings={settings.data}
              title="Datos fiscales"
              description="RFC y razón social que se imprimen en el ticket."
              toValues={(v) => ({ rfc: text(v.rfc), legalName: text(v.legalName), taxRegime: text(v.taxRegime), fiscalAddress: text(v.fiscalAddress), zipCode: text(v.zipCode) })}
              toPayload={(v) => ({
                rfc: orNull(v.rfc)?.toUpperCase() ?? null,
                legalName: orNull(v.legalName),
                taxRegime: orNull(v.taxRegime),
                fiscalAddress: orNull(v.fiscalAddress),
                zipCode: orNull(v.zipCode),
              })}
              validate={(v) => {
                const errs: Record<string, string> = {};
                const rfc = String(v.rfc).trim().toUpperCase();
                if (rfc && !RFC_REGEX.test(rfc)) errs.rfc = 'RFC inválido (12 o 13 caracteres)';
                if (String(v.zipCode).trim() && !/^\d{5}$/.test(String(v.zipCode).trim())) errs.zipCode = 'El código postal tiene 5 dígitos';
                return errs;
              }}
            >
              {(f) => (
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField label="RFC (opcional)" autoComplete="off" {...f.text('rfc')} />
                  <TextField label="Código postal (opcional)" inputMode="numeric" {...f.text('zipCode')} />
                  <TextField label="Razón social (opcional)" className="sm:col-span-2" {...f.text('legalName')} />
                  <TextField label="Régimen fiscal (opcional)" placeholder="Ej. 601 General de Ley Personas Morales" className="sm:col-span-2" {...f.text('taxRegime')} />
                  <TextField label="Domicilio fiscal (opcional)" className="sm:col-span-2" {...f.text('fiscalAddress')} />
                </div>
              )}
            </SettingSection>

            <SettingSection
              settingKey="inventory.defaults"
              settings={settings.data}
              title="Precios y margen"
              description="Cómo se sugiere el precio de venta de un producto nuevo a partir de su costo."
              toValues={(v) => ({ marginBasis: v.marginBasis, defaultMarginPercent: String(v.defaultMarginPercent), defaultMinStock: String(v.defaultMinStock) })}
              toPayload={(v) => ({ marginBasis: v.marginBasis as MarginBasis, defaultMarginPercent: Number(v.defaultMarginPercent), defaultMinStock: Number(v.defaultMinStock) })}
              validate={(v) => {
                const errs: Record<string, string> = {};
                const pct = Number(v.defaultMarginPercent);
                const max = v.marginBasis === 'PRICE' ? MAX_PRICE_MARGIN : 1000;
                if (!(String(v.defaultMarginPercent).trim() && pct >= 0 && pct <= max)) errs.defaultMarginPercent = `Escribe un porcentaje entre 0 y ${max}`;
                if (!intIn(v.defaultMinStock, 0, 100_000)) errs.defaultMinStock = 'Número entero de 0 en adelante';
                return errs;
              }}
            >
              {(f) => <PricingFields f={f} />}
            </SettingSection>

            <SettingSection
              settingKey="pharmacy.taxes"
              settings={settings.data}
              title="Impuestos"
              description="IVA de los productos nuevos y cómo se capturan los precios."
              toValues={(v) => ({ defaultRate: String(v.defaultRate), pricesIncludeTax: v.pricesIncludeTax })}
              toPayload={(v) => ({ defaultRate: Number(v.defaultRate), pricesIncludeTax: Boolean(v.pricesIncludeTax) })}
            >
              {(f) => (
                <div className="space-y-4">
                  <SelectField label="IVA predeterminado de productos nuevos" disabled={f.readOnly} value={String(f.values.defaultRate)} onChange={(e) => f.set('defaultRate', e.target.value)} error={f.error('defaultRate')}>
                    <option value="0">0 % (medicamentos)</option>
                    <option value="0.08">8 % (región fronteriza)</option>
                    <option value="0.16">16 %</option>
                  </SelectField>
                  <Checkbox
                    label="Los precios de venta ya incluyen el IVA"
                    disabled={f.readOnly}
                    checked={Boolean(f.values.pricesIncludeTax)}
                    onChange={(e) => f.set('pricesIncludeTax', e.target.checked)}
                  />
                  {f.values.pricesIncludeTax !== settings.data!['pharmacy.taxes'].value.pricesIncludeTax && (
                    <Alert tone="warning" title="Cambia cómo se leen todos los precios">
                      {f.values.pricesIncludeTax
                        ? 'Los precios capturados se tomarán como precio final: el IVA saldrá de ahí.'
                        : 'Al cobrar se sumará el IVA a los precios capturados de productos con tasa mayor a 0 %.'}{' '}
                      Las ventas ya registradas no cambian.
                    </Alert>
                  )}
                </div>
              )}
            </SettingSection>

            <SettingSection
              settingKey="alerts.expiry"
              settings={settings.data}
              title="Alertas de caducidad"
              description="Cuándo se avisa que un lote está por caducar (alertas, dashboard y reportes)."
              toValues={(v) => ({ criticalDays: String(v.criticalDays), warningDays: String(v.warningDays) })}
              toPayload={(v) => ({ criticalDays: Number(v.criticalDays), warningDays: Number(v.warningDays) })}
              validate={(v) => {
                const errs: Record<string, string> = {};
                if (!intIn(v.criticalDays, 1, 365)) errs.criticalDays = 'De 1 a 365 días';
                if (!intIn(v.warningDays, 1, 730)) errs.warningDays = 'De 1 a 730 días';
                else if (Number(v.warningDays) <= Number(v.criticalDays)) errs.warningDays = 'Debe ser mayor que los días críticos';
                return errs;
              }}
            >
              {(f) => (
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField label="Crítico (días antes de caducar)" inputMode="numeric" hint="Alerta en la campana y en el dashboard" {...f.text('criticalDays')} />
                  <TextField label="Aviso anticipado (días)" inputMode="numeric" hint="Para planear devoluciones o promociones" {...f.text('warningDays')} />
                </div>
              )}
            </SettingSection>

            <BranchesSection />
          </div>
        )
      )}
    </div>
  );
}

function PricingFields({ f }: { f: FieldApi }) {
  const basis = f.values.marginBasis as MarginBasis;
  const pct = Number(f.values.defaultMarginPercent);
  const example = Number.isFinite(pct) && pct >= 0 ? suggestSalePrice(100, pct, 0, true, basis) : null;
  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-slate-700">El margen se calcula</legend>
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
          {MARGIN_BASES.map((b) => (
            <label
              key={b}
              className={clsx(
                'flex cursor-pointer items-start gap-2 rounded-lg p-3 text-sm ring-1 ring-inset',
                basis === b ? 'bg-brand-50/50 ring-brand-500' : 'ring-slate-200',
                f.readOnly && 'cursor-default',
              )}
            >
              <input type="radio" name="marginBasis" className="mt-0.5 accent-brand-600" checked={basis === b} disabled={f.readOnly} onChange={() => f.set('marginBasis', b)} />
              <span>
                <span className="block font-medium text-slate-900">{MARGIN_BASIS_LABELS[b]}</span>
                <span className="text-xs text-slate-500">
                  {b === 'COST' ? 'La utilidad es un porcentaje de lo que costó.' : 'La utilidad es un porcentaje del precio al público.'}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Margen predeterminado (%)" inputMode="decimal" {...f.text('defaultMarginPercent')} />
        <TextField label="Stock mínimo predeterminado" inputMode="numeric" hint="Para productos nuevos" {...f.text('defaultMinStock')} />
      </div>
      {example !== null && (
        <p className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
          <Calculator className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden />
          <span>
            Ejemplo: un producto que cuesta {formatMoney(100)} se sugiere en <strong className="tabular-nums text-slate-900">{formatMoney(example)}</strong> (sin IVA,
            redondeado a 50 centavos). Siempre puedes cambiar el precio al dar de alta el producto.
          </span>
        </p>
      )}
    </div>
  );
}
