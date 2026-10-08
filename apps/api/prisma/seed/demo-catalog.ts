import type { Presentation, PrismaClient } from '../../src/generated/prisma/client';
import { buildSearchText } from '../../src/modules/products/search-text';

/**
 * Catálogo ficticio de demostración: 10 categorías, 10 laboratorios (nombres inventados)
 * y 30 medicamentos con su nombre genérico (sin marcas comerciales reales).
 * Los códigos de barras usan el prefijo 200, reservado para uso interno, y no
 * coinciden con productos reales.
 */

export const DEMO_CATEGORIES = [
  ['Analgésicos y antipiréticos', 'Dolor y fiebre'],
  ['Antiinflamatorios', 'AINEs y antiinflamatorios'],
  ['Antibióticos', 'Requieren receta médica (se retiene)'],
  ['Antihistamínicos', 'Alergias'],
  ['Gastrointestinales', 'Acidez, diarrea, cólicos e hidratación'],
  ['Cardiovasculares', 'Hipertensión y corazón'],
  ['Antidiabéticos', 'Control de glucosa'],
  ['Vitaminas y suplementos', 'Vitaminas, minerales y complementos'],
  ['Dermatológicos', 'Cremas y ungüentos'],
  ['Respiratorios', 'Tos, gripe y vías respiratorias'],
] as const;

export const DEMO_LABORATORIES = [
  'Laboratorios Salvia',
  'Farmacéutica Andina',
  'BioNova Pharma',
  'Laboratorios Ceiba',
  'Medika del Norte',
  'Quimpharma',
  'Laboratorios Altamar',
  'Genéricos Aurora',
  'Vitalis Labs',
  'Dermagen',
] as const;

type Category = (typeof DEMO_CATEGORIES)[number][0];
type Lab = (typeof DEMO_LABORATORIES)[number];

interface DemoProduct {
  name: string;
  generic: string;
  concentration: string;
  form: string;
  presentation: Presentation;
  content: string;
  category: Category;
  lab: Lab;
  cost: number;
  price: number;
  tax?: number;
  rx?: boolean;
  controlled?: boolean;
  min: number;
  max: number;
  location: string;
}

const P = (p: DemoProduct) => p;

export const DEMO_PRODUCTS: DemoProduct[] = [
  P({ name: 'Paracetamol 500 mg', generic: 'Paracetamol', concentration: '500 mg', form: 'Tableta', presentation: 'BOX', content: '20 tabletas', category: 'Analgésicos y antipiréticos', lab: 'Genéricos Aurora', cost: 18, price: 35, min: 20, max: 120, location: 'Anaquel A-1' }),
  P({ name: 'Paracetamol infantil 120 mg/5 ml', generic: 'Paracetamol', concentration: '120 mg/5 ml', form: 'Jarabe', presentation: 'BOTTLE', content: '120 ml', category: 'Analgésicos y antipiréticos', lab: 'Laboratorios Salvia', cost: 28, price: 52, min: 8, max: 40, location: 'Anaquel A-1' }),
  P({ name: 'Metamizol 500 mg', generic: 'Metamizol sódico', concentration: '500 mg', form: 'Tableta', presentation: 'BOX', content: '10 tabletas', category: 'Analgésicos y antipiréticos', lab: 'Quimpharma', cost: 15, price: 32, min: 10, max: 60, location: 'Anaquel A-2' }),
  P({ name: 'Ibuprofeno 400 mg', generic: 'Ibuprofeno', concentration: '400 mg', form: 'Tableta', presentation: 'BOX', content: '10 tabletas', category: 'Antiinflamatorios', lab: 'Genéricos Aurora', cost: 22, price: 45, min: 15, max: 80, location: 'Anaquel A-3' }),
  P({ name: 'Ibuprofeno infantil 100 mg/5 ml', generic: 'Ibuprofeno', concentration: '100 mg/5 ml', form: 'Suspensión', presentation: 'BOTTLE', content: '120 ml', category: 'Antiinflamatorios', lab: 'Laboratorios Salvia', cost: 35, price: 68, min: 6, max: 30, location: 'Anaquel A-3' }),
  P({ name: 'Naproxeno 550 mg', generic: 'Naproxeno sódico', concentration: '550 mg', form: 'Tableta', presentation: 'BOX', content: '12 tabletas', category: 'Antiinflamatorios', lab: 'Medika del Norte', cost: 30, price: 62, min: 10, max: 50, location: 'Anaquel A-3' }),
  P({ name: 'Diclofenaco 100 mg', generic: 'Diclofenaco sódico', concentration: '100 mg', form: 'Tableta de liberación prolongada', presentation: 'BOX', content: '20 tabletas', category: 'Antiinflamatorios', lab: 'Quimpharma', cost: 25, price: 55, min: 10, max: 50, location: 'Anaquel A-4' }),
  P({ name: 'Ketorolaco 10 mg', generic: 'Ketorolaco trometamina', concentration: '10 mg', form: 'Tableta', presentation: 'BOX', content: '10 tabletas', category: 'Antiinflamatorios', lab: 'BioNova Pharma', cost: 20, price: 48, rx: true, min: 8, max: 40, location: 'Anaquel A-4' }),
  P({ name: 'Amoxicilina 500 mg', generic: 'Amoxicilina', concentration: '500 mg', form: 'Cápsula', presentation: 'BOX', content: '12 cápsulas', category: 'Antibióticos', lab: 'Laboratorios Ceiba', cost: 45, price: 89, rx: true, controlled: true, min: 10, max: 50, location: 'Mostrador R-1' }),
  P({ name: 'Amoxicilina / Ácido clavulánico 875/125 mg', generic: 'Amoxicilina, ácido clavulánico', concentration: '875 mg / 125 mg', form: 'Tableta', presentation: 'BOX', content: '14 tabletas', category: 'Antibióticos', lab: 'BioNova Pharma', cost: 120, price: 235, rx: true, controlled: true, min: 5, max: 25, location: 'Mostrador R-1' }),
  P({ name: 'Azitromicina 500 mg', generic: 'Azitromicina', concentration: '500 mg', form: 'Tableta', presentation: 'BOX', content: '3 tabletas', category: 'Antibióticos', lab: 'Laboratorios Ceiba', cost: 60, price: 125, rx: true, controlled: true, min: 5, max: 25, location: 'Mostrador R-1' }),
  P({ name: 'Ciprofloxacino 500 mg', generic: 'Ciprofloxacino', concentration: '500 mg', form: 'Tableta', presentation: 'BOX', content: '14 tabletas', category: 'Antibióticos', lab: 'Medika del Norte', cost: 55, price: 110, rx: true, controlled: true, min: 5, max: 25, location: 'Mostrador R-2' }),
  P({ name: 'Cefalexina 500 mg', generic: 'Cefalexina', concentration: '500 mg', form: 'Cápsula', presentation: 'BOX', content: '20 cápsulas', category: 'Antibióticos', lab: 'Farmacéutica Andina', cost: 70, price: 140, rx: true, controlled: true, min: 5, max: 25, location: 'Mostrador R-2' }),
  P({ name: 'Loratadina 10 mg', generic: 'Loratadina', concentration: '10 mg', form: 'Tableta', presentation: 'BOX', content: '20 tabletas', category: 'Antihistamínicos', lab: 'Genéricos Aurora', cost: 20, price: 45, min: 10, max: 60, location: 'Anaquel B-1' }),
  P({ name: 'Cetirizina 10 mg', generic: 'Cetirizina', concentration: '10 mg', form: 'Tableta', presentation: 'BOX', content: '10 tabletas', category: 'Antihistamínicos', lab: 'Farmacéutica Andina', cost: 18, price: 40, min: 10, max: 60, location: 'Anaquel B-1' }),
  P({ name: 'Omeprazol 20 mg', generic: 'Omeprazol', concentration: '20 mg', form: 'Cápsula', presentation: 'BOX', content: '14 cápsulas', category: 'Gastrointestinales', lab: 'Quimpharma', cost: 25, price: 58, min: 15, max: 80, location: 'Anaquel B-2' }),
  P({ name: 'Loperamida 2 mg', generic: 'Loperamida', concentration: '2 mg', form: 'Tableta', presentation: 'BOX', content: '12 tabletas', category: 'Gastrointestinales', lab: 'Genéricos Aurora', cost: 15, price: 35, min: 8, max: 40, location: 'Anaquel B-2' }),
  P({ name: 'Butilhioscina 10 mg', generic: 'Butilhioscina', concentration: '10 mg', form: 'Gragea', presentation: 'BOX', content: '20 grageas', category: 'Gastrointestinales', lab: 'Laboratorios Altamar', cost: 30, price: 65, min: 8, max: 40, location: 'Anaquel B-3' }),
  P({ name: 'Suero oral sabor naranja', generic: 'Sales de rehidratación oral', concentration: '27.9 g', form: 'Polvo', presentation: 'SACHET', content: '1 sobre', category: 'Gastrointestinales', lab: 'Laboratorios Altamar', cost: 6, price: 14, min: 20, max: 150, location: 'Anaquel B-3' }),
  P({ name: 'Losartán 50 mg', generic: 'Losartán potásico', concentration: '50 mg', form: 'Tableta', presentation: 'BOX', content: '30 tabletas', category: 'Cardiovasculares', lab: 'Medika del Norte', cost: 40, price: 95, rx: true, min: 10, max: 50, location: 'Mostrador R-3' }),
  P({ name: 'Enalapril 10 mg', generic: 'Enalapril', concentration: '10 mg', form: 'Tableta', presentation: 'BOX', content: '30 tabletas', category: 'Cardiovasculares', lab: 'Farmacéutica Andina', cost: 25, price: 60, rx: true, min: 10, max: 50, location: 'Mostrador R-3' }),
  P({ name: 'Amlodipino 5 mg', generic: 'Amlodipino', concentration: '5 mg', form: 'Tableta', presentation: 'BOX', content: '30 tabletas', category: 'Cardiovasculares', lab: 'BioNova Pharma', cost: 30, price: 72, rx: true, min: 10, max: 50, location: 'Mostrador R-3' }),
  P({ name: 'Metformina 850 mg', generic: 'Metformina', concentration: '850 mg', form: 'Tableta', presentation: 'BOX', content: '30 tabletas', category: 'Antidiabéticos', lab: 'Genéricos Aurora', cost: 22, price: 55, rx: true, min: 15, max: 80, location: 'Mostrador R-4' }),
  P({ name: 'Glibenclamida 5 mg', generic: 'Glibenclamida', concentration: '5 mg', form: 'Tableta', presentation: 'BOX', content: '50 tabletas', category: 'Antidiabéticos', lab: 'Quimpharma', cost: 18, price: 42, rx: true, min: 8, max: 40, location: 'Mostrador R-4' }),
  P({ name: 'Complejo B', generic: 'Tiamina, piridoxina, cianocobalamina', concentration: '100/5/0.05 mg', form: 'Tableta', presentation: 'BOTTLE', content: '30 tabletas', category: 'Vitaminas y suplementos', lab: 'Vitalis Labs', cost: 45, price: 95, tax: 0.16, min: 6, max: 30, location: 'Anaquel C-1' }),
  P({ name: 'Vitamina C 1 g efervescente', generic: 'Ácido ascórbico', concentration: '1 g', form: 'Tableta efervescente', presentation: 'TUBE', content: '10 tabletas', category: 'Vitaminas y suplementos', lab: 'Vitalis Labs', cost: 35, price: 75, tax: 0.16, min: 6, max: 30, location: 'Anaquel C-1' }),
  P({ name: 'Ácido fólico 5 mg', generic: 'Ácido fólico', concentration: '5 mg', form: 'Tableta', presentation: 'BOX', content: '20 tabletas', category: 'Vitaminas y suplementos', lab: 'Laboratorios Salvia', cost: 15, price: 35, min: 6, max: 30, location: 'Anaquel C-2' }),
  P({ name: 'Clotrimazol crema 1 %', generic: 'Clotrimazol', concentration: '1 %', form: 'Crema', presentation: 'TUBE', content: '20 g', category: 'Dermatológicos', lab: 'Dermagen', cost: 25, price: 58, min: 5, max: 25, location: 'Anaquel C-3' }),
  P({ name: 'Hidrocortisona crema 1 %', generic: 'Hidrocortisona', concentration: '1 %', form: 'Crema', presentation: 'TUBE', content: '15 g', category: 'Dermatológicos', lab: 'Dermagen', cost: 30, price: 66, min: 5, max: 25, location: 'Anaquel C-3' }),
  P({ name: 'Ambroxol 30 mg/5 ml', generic: 'Ambroxol', concentration: '30 mg/5 ml', form: 'Jarabe', presentation: 'BOTTLE', content: '120 ml', category: 'Respiratorios', lab: 'Laboratorios Altamar', cost: 30, price: 68, min: 6, max: 30, location: 'Anaquel C-4' }),
];

/** EAN-13 con dígito verificador, prefijo 200 (uso interno). */
export function demoBarcode(index: number): string {
  const body = `200${String(1000 + index).padStart(9, '0')}`;
  const sum = [...body].reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return body + String((10 - (sum % 10)) % 10);
}

export async function seedDemoCatalog(prisma: PrismaClient, branchId: string): Promise<{ products: number }> {
  const categoryIds = new Map<string, string>();
  for (const [name, description] of DEMO_CATEGORIES) {
    const row = await prisma.category.upsert({ where: { name }, update: {}, create: { name, description } });
    categoryIds.set(name, row.id);
  }
  const labIds = new Map<string, string>();
  for (const name of DEMO_LABORATORIES) {
    const row = await prisma.laboratory.upsert({ where: { name }, update: {}, create: { name, country: 'México' } });
    labIds.set(name, row.id);
  }

  let created = 0;
  for (const [i, p] of DEMO_PRODUCTS.entries()) {
    const barcode = demoBarcode(i + 1);
    if (await prisma.product.findUnique({ where: { barcode } })) continue;
    const [seq] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT nextval('product_sku_seq') AS n`;
    const sku = `MED-${String(seq!.n).padStart(6, '0')}`;
    const product = await prisma.product.create({
      data: {
        sku,
        barcode,
        commercialName: p.name,
        genericName: p.generic,
        activeIngredient: p.generic,
        concentration: p.concentration,
        pharmaceuticalForm: p.form,
        presentation: p.presentation,
        contentQuantity: p.content,
        categoryId: categoryIds.get(p.category)!,
        laboratoryId: labIds.get(p.lab)!,
        purchasePrice: p.cost,
        salePrice: p.price,
        taxRate: p.tax ?? 0,
        requiresPrescription: p.rx ?? false,
        isControlled: p.controlled ?? false,
        searchText: buildSearchText({
          commercialName: p.name,
          genericName: p.generic,
          activeIngredient: p.generic,
          concentration: p.concentration,
          barcode,
          sku,
        }),
      },
    });
    await prisma.inventory.create({
      data: { productId: product.id, branchId, minStock: p.min, maxStock: p.max, location: p.location },
    });
    created++;
  }
  return { products: created };
}
