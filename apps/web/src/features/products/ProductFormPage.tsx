import {
  computeMargin,
  PHARMACEUTICAL_FORMS,
  PRESENTATION_LABELS,
  PRESENTATIONS,
  PRODUCT_STATUS_LABELS,
  PRODUCT_STATUSES,
  suggestSalePrice,
  TAX_RATE_OPTIONS,
} from '@farmacia/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, ArrowLeft, ImagePlus, Lock, Save, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router';
import { z } from 'zod';
import {
  useCatalog,
  useCatalogDefaults,
  useDeleteProduct,
  useProduct,
  useProductImage,
  useSaveProduct,
  type Product,
  type ProductInput,
} from '../../api/catalog';
import { ApiError } from '../../api/client';
import { useAuth } from '../../auth/useAuth';
import { Alert } from '../../components/ui/Alert';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Checkbox, TextAreaField, TextField } from '../../components/ui/FormField';
import { SelectField } from '../../components/ui/SelectField';
import { Spinner } from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { formatMoney, formatPercent } from '../../lib/format';
import { productDetails, ProductThumb, StockBadge } from './product-display';

// -----------------------------------------------------------------------------
// Formulario (los números se capturan como texto: admite "35,50")
// -----------------------------------------------------------------------------

const toNumber = (v: string) => Number(v.trim().replace(',', '.'));
const money = (required: boolean) =>
  z
    .string()
    .trim()
    .refine((v) => (required ? v !== '' : true), 'Este precio es obligatorio')
    .refine((v) => v === '' || /^\d{1,8}([.,]\d{1,2})?$/.test(v), 'Monto inválido (ejemplo: 35.50)');
const integer = (required: boolean) =>
  z
    .string()
    .trim()
    .refine((v) => (required ? v !== '' : true), 'Obligatorio')
    .refine((v) => v === '' || /^\d{1,7}$/.test(v), 'Número entero sin decimales');

const schema = z
  .object({
    commercialName: z.string().trim().min(2, 'El nombre comercial es obligatorio').max(160),
    genericName: z.string().trim().max(160),
    activeIngredient: z.string().trim().max(200),
    barcode: z
      .string()
      .trim()
      .refine((v) => v === '' || /^[0-9A-Za-z-]{4,64}$/.test(v), 'Código inválido (4 a 64 letras, números o guiones)'),
    sku: z
      .string()
      .trim()
      .refine((v) => v === '' || /^[A-Za-z0-9-]{2,40}$/.test(v), 'SKU inválido'),
    categoryId: z.string().min(1, 'Selecciona una categoría'),
    laboratoryId: z.string(),
    presentation: z.string().min(1, 'Selecciona una presentación'),
    concentration: z.string().trim().max(60),
    pharmaceuticalForm: z.string().trim().max(60),
    contentQuantity: z.string().trim().max(60),
    manufacturer: z.string().trim().max(160),
    purchasePrice: money(false),
    salePrice: money(true),
    taxRate: z.string(),
    requiresPrescription: z.boolean(),
    isControlled: z.boolean(),
    status: z.enum(PRODUCT_STATUSES),
    minStock: integer(true),
    maxStock: integer(false),
    location: z.string().trim().max(80),
    description: z.string().trim().max(2000),
    indications: z.string().trim().max(2000),
    observations: z.string().trim().max(2000),
  })
  .refine((d) => d.maxStock === '' || toNumber(d.maxStock) >= toNumber(d.minStock), {
    message: 'Debe ser mayor o igual al stock mínimo',
    path: ['maxStock'],
  });
type FormValues = z.infer<typeof schema>;

function toFormValues(p: Product | undefined, defaultMinStock: number): FormValues {
  return {
    commercialName: p?.commercialName ?? '',
    genericName: p?.genericName ?? '',
    activeIngredient: p?.activeIngredient ?? '',
    barcode: p?.barcode ?? '',
    sku: p?.sku ?? '',
    categoryId: p?.category.id ?? '',
    laboratoryId: p?.laboratory?.id ?? '',
    presentation: p?.presentation ?? '',
    concentration: p?.concentration ?? '',
    pharmaceuticalForm: p?.pharmaceuticalForm ?? '',
    contentQuantity: p?.contentQuantity ?? '',
    manufacturer: p?.manufacturer ?? '',
    purchasePrice: p?.purchasePrice !== undefined ? p.purchasePrice.toFixed(2) : '',
    salePrice: p ? p.salePrice.toFixed(2) : '',
    taxRate: String(p?.taxRate ?? 0),
    requiresPrescription: p?.requiresPrescription ?? false,
    isControlled: p?.isControlled ?? false,
    status: p?.status ?? 'ACTIVE',
    minStock: String(p?.inventory.minStock ?? defaultMinStock),
    maxStock: p?.inventory.maxStock != null ? String(p.inventory.maxStock) : '',
    location: p?.inventory.location ?? '',
    description: p?.description ?? '',
    indications: p?.indications ?? '',
    observations: p?.observations ?? '',
  };
}

const orNull = (v: string) => (v.trim() ? v.trim() : null);

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <div className="space-y-4 p-5">{children}</div>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Página
// -----------------------------------------------------------------------------

export function ProductFormPage() {
  const { id } = useParams();
  const isNew = id === undefined;
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useAuth();

  const product = useProduct(id);
  const categories = useCatalog('categories');
  const laboratories = useCatalog('laboratories');
  const defaults = useCatalogDefaults();
  const saveProduct = useSaveProduct();
  const deleteProduct = useDeleteProduct();

  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const canEdit = isNew ? can('products.create') : can('products.edit');
  const canChangePrice = isNew || can('products.change_price');
  // El costo sólo llega del servidor a quien puede verlo
  const showCosts = isNew || product.data?.purchasePrice !== undefined;
  const pricesIncludeTax = defaults.data?.taxes.pricesIncludeTax ?? true;

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: toFormValues(undefined, 5),
  });

  // Cargar valores una sola vez por producto (una recarga no debe borrar lo que se edita)
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    const key = isNew ? 'new' : product.data?.id;
    if (!key || loadedFor.current === key || (isNew && !defaults.data)) return;
    reset(toFormValues(product.data, defaults.data?.inventory.defaultMinStock ?? 5));
    loadedFor.current = key;
  }, [isNew, product.data, defaults.data, reset]);

  const [purchase, sale, tax] = watch(['purchasePrice', 'salePrice', 'taxRate']);
  const cost = purchase ? toNumber(purchase) : 0;
  const price = sale ? toNumber(sale) : NaN;
  const margin = Number.isFinite(price) && price > 0 ? computeMargin(cost, price, Number(tax), pricesIncludeTax) : null;

  const suggest = () => {
    const markup = defaults.data?.inventory.defaultMarginPercent ?? 30;
    setValue('salePrice', suggestSalePrice(cost, markup, Number(tax), pricesIncludeTax).toFixed(2), { shouldDirty: true });
  };

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    const input: Partial<ProductInput> = {
      commercialName: v.commercialName.trim(),
      genericName: orNull(v.genericName),
      activeIngredient: orNull(v.activeIngredient),
      barcode: orNull(v.barcode),
      categoryId: v.categoryId,
      laboratoryId: orNull(v.laboratoryId),
      presentation: v.presentation as ProductInput['presentation'],
      concentration: orNull(v.concentration),
      pharmaceuticalForm: orNull(v.pharmaceuticalForm),
      contentQuantity: orNull(v.contentQuantity),
      manufacturer: orNull(v.manufacturer),
      requiresPrescription: v.requiresPrescription,
      isControlled: v.isControlled,
      status: v.status,
      minStock: toNumber(v.minStock),
      maxStock: v.maxStock ? toNumber(v.maxStock) : null,
      location: orNull(v.location),
      description: orNull(v.description),
      indications: orNull(v.indications),
      observations: orNull(v.observations),
    };
    if (canChangePrice) {
      input.salePrice = toNumber(v.salePrice);
      input.taxRate = Number(v.taxRate);
      if (showCosts) input.purchasePrice = v.purchasePrice ? toNumber(v.purchasePrice) : 0;
    }
    if (isNew && v.sku) input.sku = v.sku.toUpperCase();

    try {
      const saved = await saveProduct.mutateAsync({ id, input });
      if (isNew) {
        toast.success(`"${saved.commercialName}" registrado. Ahora puedes agregar su imagen.`);
        navigate(`/inventario/productos/${saved.id}`, { replace: true });
      } else {
        toast.success(`Se guardaron los cambios de "${saved.commercialName}"`);
        navigate('/inventario/productos');
      }
    } catch (err) {
      if (err instanceof ApiError) {
        let mapped = false;
        for (const [path, message] of Object.entries(err.fieldErrors())) {
          if (path in v) {
            setError(path as keyof FormValues, { message });
            mapped = true;
          }
        }
        if (!mapped) setFormError(err.message);
      } else {
        setFormError('No se pudo guardar el producto.');
      }
    }
  });

  const onDelete = async () => {
    if (!product.data) return;
    try {
      await deleteProduct.mutateAsync(product.data.id);
      toast.success(`"${product.data.commercialName}" eliminado`);
      navigate('/inventario/productos');
    } catch (err) {
      setConfirmDelete(false);
      toast.error(err instanceof ApiError ? err.message : 'No se pudo eliminar');
    }
  };

  if (!isNew && product.isPending) {
    return (
      <div className="flex justify-center py-16 text-brand-600">
        <Spinner />
      </div>
    );
  }
  if (!isNew && product.isError) {
    return (
      <Alert tone="error" title="Producto no encontrado">
        Es posible que haya sido eliminado.{' '}
        <ButtonLink to="/inventario/productos" variant="ghost" size="sm">
          Volver a productos
        </ButtonLink>
      </Alert>
    );
  }

  const disabled = !canEdit;
  const p = product.data;

  return (
    <form onSubmit={onSubmit} noValidate className="pb-24">
      <ButtonLink to="/inventario/productos" variant="ghost" size="sm" className="-ml-2 mb-3" icon={<ArrowLeft className="size-4" />}>
        Productos
      </ButtonLink>

      <div className="mb-6 flex flex-wrap items-start gap-4">
        {p && <ProductThumb product={p} size="lg" />}
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{p ? p.commercialName : 'Nuevo producto'}</h1>
          {p ? (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
              <span>{productDetails(p)}</span>
              <span className="font-mono text-xs">{p.sku}</span>
              <StockBadge product={p} />
            </div>
          ) : (
            <p className="mt-1 text-sm text-slate-500">
              Los lotes y fechas de caducidad se registran al recibir una compra o desde Inventario › Lotes.
            </p>
          )}
        </div>
      </div>

      {disabled && (
        <Alert tone="info" className="mb-4">
          Estás viendo este producto en modo consulta. Tu rol no permite modificarlo.
        </Alert>
      )}
      {formError && (
        <Alert tone="error" className="mb-4">
          {formError}
        </Alert>
      )}

      <fieldset disabled={disabled} className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Section title="Identificación">
            <TextField label="Nombre comercial" placeholder="Ej. Paracetamol 500 mg" error={errors.commercialName?.message} {...register('commercialName')} />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Nombre genérico" placeholder="Ej. Paracetamol" error={errors.genericName?.message} {...register('genericName')} />
              <TextField label="Principio activo" error={errors.activeIngredient?.message} {...register('activeIngredient')} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Código de barras"
                inputMode="numeric"
                autoComplete="off"
                hint="Escanéalo con el lector o escríbelo."
                error={errors.barcode?.message}
                // El lector envía Enter al terminar: no debe enviar el formulario
                onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
                {...register('barcode')}
              />
              <TextField
                label="SKU (código interno)"
                placeholder={isNew ? 'Se genera automáticamente' : undefined}
                disabled={!isNew}
                error={errors.sku?.message}
                {...register('sku')}
              />
            </div>
          </Section>

          <Section title="Clasificación y presentación">
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField label="Categoría" error={errors.categoryId?.message} {...register('categoryId')}>
                <option value="">Selecciona…</option>
                {categories.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </SelectField>
              <SelectField label="Laboratorio" error={errors.laboratoryId?.message} {...register('laboratoryId')}>
                <option value="">Sin laboratorio</option>
                {laboratories.data?.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </SelectField>
              <SelectField label="Presentación" error={errors.presentation?.message} {...register('presentation')}>
                <option value="">Selecciona…</option>
                {PRESENTATIONS.map((value) => (
                  <option key={value} value={value}>
                    {PRESENTATION_LABELS[value]}
                  </option>
                ))}
              </SelectField>
              <TextField label="Contenido" placeholder="Ej. 20 tabletas, 120 ml" error={errors.contentQuantity?.message} {...register('contentQuantity')} />
              <TextField label="Concentración" placeholder="Ej. 500 mg" error={errors.concentration?.message} {...register('concentration')} />
              <TextField
                label="Forma farmacéutica"
                list="pharmaceutical-forms"
                placeholder="Ej. Tableta"
                error={errors.pharmaceuticalForm?.message}
                {...register('pharmaceuticalForm')}
              />
              <datalist id="pharmaceutical-forms">
                {PHARMACEUTICAL_FORMS.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
              <TextField label="Fabricante" className="sm:col-span-2" error={errors.manufacturer?.message} {...register('manufacturer')} />
            </div>
          </Section>

          <Section title="Información" description="Datos de referencia para el personal. El sistema no sugiere tratamientos.">
            <TextAreaField label="Descripción" error={errors.description?.message} {...register('description')} />
            <TextAreaField label="Indicaciones" error={errors.indications?.message} {...register('indications')} />
            <TextAreaField label="Observaciones internas" error={errors.observations?.message} {...register('observations')} />
          </Section>
        </div>

        <div className="space-y-6">
          {p && <ImageCard product={p} canEdit={canEdit} />}

          <Section title="Precio">
            {!canChangePrice && (
              <p className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <Lock className="size-3.5" /> Tu rol no permite cambiar precios.
              </p>
            )}
            {showCosts && (
              <TextField
                label="Precio de compra (costo)"
                inputMode="decimal"
                icon={<span className="text-sm">$</span>}
                disabled={!canChangePrice}
                error={errors.purchasePrice?.message}
                {...register('purchasePrice')}
              />
            )}
            <TextField
              label="Precio de venta"
              inputMode="decimal"
              icon={<span className="text-sm">$</span>}
              disabled={!canChangePrice}
              hint={pricesIncludeTax ? 'Precio final al cliente (incluye IVA).' : 'Precio antes de IVA.'}
              error={errors.salePrice?.message}
              {...register('salePrice')}
            />
            <SelectField label="IVA" disabled={!canChangePrice} {...register('taxRate')}>
              {TAX_RATE_OPTIONS.map((t) => (
                <option key={t.value} value={String(t.value)}>
                  {t.label}
                </option>
              ))}
            </SelectField>

            {showCosts && (
              <div className="rounded-lg bg-slate-50 p-3 text-sm" aria-live="polite">
                {margin ? (
                  <dl className="grid grid-cols-2 gap-y-1">
                    <dt className="text-slate-500">Utilidad por unidad</dt>
                    <dd className={`text-right font-semibold tabular-nums ${margin.profit < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                      {formatMoney(margin.profit)}
                    </dd>
                    <dt className="text-slate-500">Margen sobre costo</dt>
                    <dd className="text-right tabular-nums text-slate-700">{formatPercent(margin.markupPercent)}</dd>
                    <dt className="text-slate-500">Margen sobre venta</dt>
                    <dd className="text-right tabular-nums text-slate-700">{formatPercent(margin.marginPercent)}</dd>
                  </dl>
                ) : (
                  <p className="text-slate-500">Captura el precio para ver la utilidad.</p>
                )}
                {margin && margin.profit < 0 && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-red-600">
                    <AlertTriangle className="size-3.5" /> El precio de venta está por debajo del costo.
                  </p>
                )}
                {canChangePrice && cost > 0 && (
                  <Button type="button" variant="secondary" size="sm" className="mt-3 w-full" onClick={suggest} icon={<Sparkles className="size-4" />}>
                    Sugerir precio ({defaults.data?.inventory.defaultMarginPercent ?? 30} % sobre costo)
                  </Button>
                )}
              </div>
            )}
          </Section>

          <Section title="Inventario" description="Parámetros de esta sucursal.">
            <div className="grid grid-cols-2 gap-4">
              <TextField label="Stock mínimo" inputMode="numeric" error={errors.minStock?.message} {...register('minStock')} />
              <TextField label="Stock máximo" inputMode="numeric" placeholder="Opcional" error={errors.maxStock?.message} {...register('maxStock')} />
            </div>
            <TextField label="Ubicación" placeholder="Ej. Anaquel A-3" error={errors.location?.message} {...register('location')} />
          </Section>

          <Section title="Control">
            <Checkbox label="Requiere receta médica" {...register('requiresPrescription')} />
            <Checkbox label="Retiene receta (antibióticos y controlados)" {...register('isControlled')} />
            <SelectField label="Estado" {...register('status')}>
              {PRODUCT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PRODUCT_STATUS_LABELS[s]}
                </option>
              ))}
            </SelectField>
          </Section>
        </div>
      </fieldset>

      {canEdit && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur lg:left-64">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <div>
              {p && can('products.delete') && (
                <Button
                  variant="ghost"
                  className="text-red-600 hover:bg-red-50 hover:text-red-700"
                  onClick={() => setConfirmDelete(true)}
                  icon={<Trash2 className="size-4" />}
                >
                  <span className="hidden sm:inline">Eliminar</span>
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <ButtonLink to="/inventario/productos" variant="secondary">
                Cancelar
              </ButtonLink>
              <Button type="submit" loading={isSubmitting} disabled={!isNew && !isDirty} icon={<Save className="size-4" />}>
                {isNew ? 'Registrar producto' : 'Guardar cambios'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Eliminar producto"
        confirmLabel="Eliminar"
        tone="danger"
        loading={deleteProduct.isPending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={onDelete}
      >
        ¿Eliminar <strong>{p?.commercialName}</strong>? Dejará de aparecer en el catálogo, pero su historial de ventas y
        movimientos se conserva. Si sólo ya no lo vendes, puedes marcarlo como "Descontinuado".
      </ConfirmDialog>
    </form>
  );
}

// -----------------------------------------------------------------------------
// Imagen
// -----------------------------------------------------------------------------

function ImageCard({ product, canEdit }: { product: Product; canEdit: boolean }) {
  const toast = useToast();
  const upload = useProductImage();
  const inputRef = useRef<HTMLInputElement>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error('La imagen no debe pesar más de 5 MB');
      return;
    }
    try {
      await upload.mutateAsync({ id: product.id, file });
      toast.success('Imagen actualizada');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo subir la imagen');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <Card>
      <CardHeader title="Imagen" />
      <div className="flex items-center gap-4 p-5">
        <ProductThumb product={product} size="lg" />
        {canEdit ? (
          <div className="space-y-2">
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              id="product-image"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={upload.isPending}
              onClick={() => inputRef.current?.click()}
              icon={<ImagePlus className="size-4" />}
            >
              {product.imageUrl ? 'Cambiar imagen' : 'Subir imagen'}
            </Button>
            {product.imageUrl && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="block text-red-600 hover:bg-red-50"
                onClick={() => upload.mutate({ id: product.id, file: null })}
              >
                Quitar
              </Button>
            )}
            <p className="text-xs text-slate-500">JPG, PNG o WebP, máx. 5 MB.</p>
          </div>
        ) : (
          !product.imageUrl && <p className="text-sm text-slate-500">Sin imagen</p>
        )}
      </div>
    </Card>
  );
}
