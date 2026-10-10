import type { PrismaClient } from '../../src/generated/prisma/client';

/**
 * Pacientes y recetas de DEMOSTRACIÓN. Todos los datos son ficticios: nombres inventados,
 * teléfonos con prefijo 55 0000, correos del dominio paciente-demo.local y médicos con
 * cédulas inventadas (prefijo 900). No corresponden a personas reales.
 * Las ventas de demostración de antibióticos se ligan a su receta, como exige el punto de venta.
 */

const DEMO_DOMAIN = '@paciente-demo.local';

const PATIENTS: [string, string, string][] = [
  ['María Fernanda', 'Gómez Ficticio', '1985-03-12'],
  ['Juan Carlos', 'Hernández Demo', '1972-11-02'],
  ['Ana Sofía', 'Martínez Ejemplo', '1994-07-25'],
  ['Luis Alberto', 'Ramírez Prueba', '1960-01-30'],
  ['Guadalupe', 'Torres Ficticio', '1958-09-14'],
  ['Diego', 'Flores Demo', '2012-05-08'],
  ['Valeria', 'Castro Ejemplo', '2001-12-19'],
  ['Roberto', 'Morales Prueba', '1979-04-03'],
  ['Carmen', 'Ortiz Ficticio', '1966-06-21'],
  ['Miguel Ángel', 'Vargas Demo', '1988-10-10'],
  ['Patricia', 'Reyes Ejemplo', '1975-02-27'],
  ['Jorge', 'Mendoza Prueba', '1990-08-16'],
  ['Lucía', 'Navarro Ficticio', '2018-03-05'],
  ['Fernando', 'Silva Demo', '1953-12-01'],
  ['Elena', 'Rojas Ejemplo', '1983-05-29'],
];

const DOCTORS: [string, string][] = [
  ['Dra. Laura Ejemplo Sánchez', '90012345'],
  ['Dr. Ricardo Ficticio Luna', '90054321'],
  ['Dra. Isabel Demo Campos', '9007788'],
];

/** Recetas independientes: [paciente, médico, días atrás, medicamentos [nombre, dosis, frecuencia, duración]] */
const PRESCRIPTIONS: [number, number, number, [string, string, string, string][]][] = [
  [0, 0, 3, [['Amoxicilina 500 mg', '1 cápsula', 'cada 8 horas', '7 días']]],
  [1, 1, 10, [['Losartán 50 mg', '1 tableta', 'cada 24 horas', '30 días'], ['Amlodipino 5 mg', '1 tableta', 'cada 24 horas', '30 días']]],
  [3, 2, 25, [['Metformina 850 mg', '1 tableta', 'cada 12 horas', '30 días']]],
  [4, 0, 40, [['Enalapril 10 mg', '1 tableta', 'cada 12 horas', '30 días']]],
  [5, 1, 5, [['Ibuprofeno infantil 100 mg/5 ml', '5 ml', 'cada 8 horas', '3 días']]],
  [7, 2, 15, [['Azitromicina 500 mg', '1 tableta', 'cada 24 horas', '3 días']]],
  [8, 0, 60, [['Glibenclamida 5 mg', '1 tableta', 'cada 24 horas', '30 días']]],
  [10, 1, 2, [['Ciprofloxacino 500 mg', '1 tableta', 'cada 12 horas', '7 días']]],
  [12, 2, 8, [['Paracetamol 500 mg', '1/2 tableta', 'cada 8 horas', 'mientras haya fiebre']]],
  [13, 0, 30, [['Losartán 50 mg', '1 tableta', 'cada 24 horas', '30 días']]],
];

function todayInMexico(): string {
  const tz = process.env.APP_TIMEZONE ?? 'America/Mexico_City';
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function addDays(iso: string, days: number): Date {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export async function seedDemoPatients(prisma: PrismaClient, branchId: string, userId: string): Promise<{ patients: number; prescriptions: number }> {
  if (await prisma.patient.findFirst({ where: { email: { endsWith: DEMO_DOMAIN } } })) return { patients: 0, prescriptions: 0 };
  const today = todayInMexico();

  const patients = [];
  for (const [i, [firstName, lastName, birthDate]] of PATIENTS.entries()) {
    patients.push(
      await prisma.patient.create({
        data: {
          firstName,
          lastName,
          birthDate: new Date(`${birthDate}T00:00:00Z`),
          phone: `55 0000 ${String(1000 + i * 111).slice(0, 4)}`,
          email: `paciente${i + 1}${DEMO_DOMAIN}`,
          notes: 'Paciente ficticio de demostración',
          createdAt: addDays(today, -90 + i),
        },
      }),
    );
  }

  const products = await prisma.product.findMany({ where: { deletedAt: null }, select: { id: true, commercialName: true } });
  const productByName = new Map(products.map((p) => [p.commercialName, p.id]));

  let count = 0;
  for (const [patientIndex, doctorIndex, daysAgo, items] of PRESCRIPTIONS) {
    const [doctorName, doctorLicense] = DOCTORS[doctorIndex]!;
    await prisma.prescription.create({
      data: {
        patientId: patients[patientIndex]!.id,
        doctorName,
        doctorLicense,
        issuedAt: addDays(today, -daysAgo),
        createdById: userId,
        createdAt: addDays(today, -daysAgo),
        items: {
          create: items.map(([name, dose, frequency, duration], position) => ({
            position,
            productId: productByName.get(name) ?? null,
            medicationName: name,
            dose,
            frequency,
            duration,
          })),
        },
      },
    });
    count++;
  }

  // Ventas de demostración que incluyen productos que retienen receta: se ligan a una receta
  const sales = await prisma.sale.findMany({
    where: { branchId, prescriptionId: null, items: { some: { product: { isControlled: true } } } },
    include: { items: { include: { product: { select: { id: true, commercialName: true, isControlled: true, requiresPrescription: true } } } } },
    orderBy: { createdAt: 'asc' },
  });
  for (const [i, sale] of sales.entries()) {
    const patient = patients[i % patients.length]!;
    const [doctorName, doctorLicense] = DOCTORS[i % DOCTORS.length]!;
    const issuedAt = new Date(`${sale.createdAt.toISOString().slice(0, 10)}T00:00:00Z`);
    const rx = await prisma.prescription.create({
      data: {
        patientId: patient.id,
        doctorName,
        doctorLicense,
        issuedAt,
        notes: 'Registrada al surtir la venta (demostración)',
        createdById: sale.createdById,
        createdAt: sale.createdAt,
        items: {
          create: sale.items
            .filter((it) => it.product.isControlled || it.product.requiresPrescription)
            .map((it, position) => ({ position, productId: it.product.id, medicationName: it.product.commercialName })),
        },
      },
    });
    await prisma.sale.update({ where: { id: sale.id }, data: { patientId: patient.id, prescriptionId: rx.id, prescriptionChecked: true } });
    count++;
  }
  return { patients: patients.length, prescriptions: count };
}
