import { computeMargin, normalizeSearch, suggestSalePrice } from '@farmacia/shared';
import { describe, expect, it } from 'vitest';
import { demoBarcode, DEMO_PRODUCTS } from '../../prisma/seed/demo-catalog';
import { createProductSchema } from '../../src/modules/products/products.schemas';

describe('normalizeSearch', () => {
  it('ignora acentos, mayúsculas y espacios repetidos', () => {
    expect(normalizeSearch('  Ácido   Fólico ')).toBe('acido folico');
    expect(normalizeSearch('LOSARTÁN')).toBe('losartan');
  });
});

describe('computeMargin', () => {
  it('calcula utilidad sobre el costo y sobre el precio (IVA 0 %)', () => {
    expect(computeMargin(18, 35, 0)).toEqual({ netSalePrice: 35, profit: 17, markupPercent: 94.44, marginPercent: 48.57 });
  });

  it('descuenta el IVA cuando el precio lo incluye', () => {
    const m = computeMargin(45, 116, 0.16);
    expect(m.netSalePrice).toBe(100);
    expect(m.profit).toBe(55);
  });

  it('sin costo no hay margen sobre el costo', () => {
    expect(computeMargin(0, 50, 0).markupPercent).toBeNull();
  });
});

describe('suggestSalePrice', () => {
  it('aplica el margen y redondea a 50 centavos', () => {
    expect(suggestSalePrice(18, 30, 0)).toBe(23.5);
    expect(suggestSalePrice(100, 30, 0.16)).toBe(151);
  });
});

describe('validación de productos', () => {
  const base = { commercialName: 'Paracetamol', categoryId: crypto.randomUUID(), presentation: 'BOX', salePrice: 35 };

  it('acepta montos con hasta 2 decimales (texto o número)', () => {
    expect(createProductSchema.parse({ ...base, salePrice: '45.10' }).salePrice).toBe(45.1);
    expect(createProductSchema.safeParse({ ...base, salePrice: 45.123 }).success).toBe(false);
    expect(createProductSchema.safeParse({ ...base, salePrice: -1 }).success).toBe(false);
  });

  it('aplica valores predeterminados seguros', () => {
    const dto = createProductSchema.parse(base);
    expect(dto).toMatchObject({ purchasePrice: 0, taxRate: 0, requiresPrescription: false, status: 'ACTIVE', barcode: null });
  });

  it('valida el rango de stock', () => {
    expect(createProductSchema.safeParse({ ...base, minStock: 10, maxStock: 5 }).success).toBe(false);
  });
});

describe('catálogo de demostración', () => {
  it('genera EAN-13 válidos del rango interno 200', () => {
    const code = demoBarcode(1);
    expect(code).toMatch(/^200\d{10}$/);
    const digits = [...code].map(Number);
    const sum = digits.slice(0, 12).reduce((a, d, i) => a + d * (i % 2 === 0 ? 1 : 3), 0);
    expect((10 - (sum % 10)) % 10).toBe(digits[12]);
  });

  it('tiene 30 medicamentos con precio mayor al costo', () => {
    expect(DEMO_PRODUCTS).toHaveLength(30);
    for (const p of DEMO_PRODUCTS) expect(p.price).toBeGreaterThan(p.cost);
  });
});
