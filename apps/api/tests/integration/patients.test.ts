import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { todayISO } from '../../src/lib/dates';
import { prisma } from '../../src/lib/prisma';
import { actorWithRole, type TestUser } from '../helpers';

const app = createApp({ rateLimitEnabled: false });
let owner: TestUser & { token: string };
let pharmacist: TestUser & { token: string };
let cashier: TestUser & { token: string };
let doctor: TestUser & { token: string };
let admin: TestUser & { token: string };
let categoryId: string;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const tag = () => randomUUID().slice(0, 8).toUpperCase();

function inDays(days: number): string {
  const d = new Date(`${todayISO()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function newPatient(extra: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/v1/patients')
    .set(auth(doctor.token))
    .send({ firstName: `Paciente ${tag()}`, lastName: 'Prueba Ficticia', birthDate: '1980-05-17', phone: '55 1234 5678', ...extra });
  expect(res.status).toBe(201);
  return res.body.patient as { id: string; fullName: string };
}

function prescribe(token: string, patientId: string, extra: Record<string, unknown> = {}) {
  return request(app)
    .post('/api/v1/prescriptions')
    .set(auth(token))
    .send({
      patientId,
      doctorName: 'Dra. Médica de Ejemplo',
      doctorLicense: '1234567',
      issuedAt: todayISO(),
      items: [
        { medicationName: 'Amoxicilina 500 mg', dose: '1 cápsula', frequency: 'cada 8 horas', duration: '7 días' },
        { medicationName: 'Paracetamol 500 mg', instructions: 'Sólo si hay fiebre' },
      ],
      ...extra,
    });
}

async function controlledProduct() {
  const res = await request(app)
    .post('/api/v1/products')
    .set(auth(owner.token))
    .send({ commercialName: `Antibiótico ${tag()}`, categoryId, presentation: 'BOX', purchasePrice: 40, salePrice: 90, taxRate: 0, minStock: 1, requiresPrescription: true, isControlled: true });
  const p = res.body.product as { id: string };
  await request(app).post('/api/v1/inventory/entries').set(auth(owner.token)).send({ productId: p.id, lotNumber: `L${tag()}`, expiresAt: inDays(300), quantity: 20 }).expect(201);
  return p;
}

beforeAll(async () => {
  owner = await actorWithRole(app, 'OWNER');
  pharmacist = await actorWithRole(app, 'PHARMACIST');
  cashier = await actorWithRole(app, 'CASHIER');
  doctor = await actorWithRole(app, 'DOCTOR');
  admin = await actorWithRole(app, 'ADMIN');
  categoryId = (await prisma.category.create({ data: { name: `Pacientes ${tag()}` } })).id;
});
afterAll(() => prisma.$disconnect());

describe('Pacientes', () => {
  it('alta, búsqueda sin acentos y listado con datos mínimos', async () => {
    // Teléfono único: la base de pruebas conserva pacientes de corridas anteriores
    const last4 = String(Math.floor(Math.random() * 9000) + 1000);
    const digits = `${Math.floor(Math.random() * 900) + 100}${last4}`;
    const p = await newPatient({ firstName: `José ${tag()}`, lastName: 'Pérez Núñez', phone: `55 1${digits.slice(0, 3)} ${last4}` });
    for (const q of [`${p.fullName.split(' ')[0]} ${p.fullName.split(' ')[1]} perez`, 'PÉREZ NUÑEZ', `1${digits.slice(0, 3)}${last4}`]) {
      const res = await request(app).get('/api/v1/patients').query({ q }).set(auth(cashier.token));
      expect(res.body.data.map((x: { id: string }) => x.id), q).toContain(p.id);
    }
    const res = await request(app).get('/api/v1/patients').query({ q: p.fullName.split(' ').slice(0, 2).join(' ') }).set(auth(cashier.token));
    const row = res.body.data.find((x: { id: string }) => x.id === p.id);
    // El listado no expone el teléfono completo ni la dirección
    expect(row).toMatchObject({ phone: `•••• ${last4}`, age: expect.any(Number) });
    expect(row).not.toHaveProperty('address');
  });

  it('no duplica pacientes ni acepta fechas de nacimiento futuras', async () => {
    const firstName = `Duplicado ${tag()}`;
    await newPatient({ firstName });
    const dup = await request(app).post('/api/v1/patients').set(auth(doctor.token)).send({ firstName, lastName: 'prueba ficticia', birthDate: '1980-05-17' });
    expect(dup.status).toBe(409);
    const future = await request(app).post('/api/v1/patients').set(auth(doctor.token)).send({ firstName: 'X', lastName: 'Y', birthDate: inDays(1) });
    expect(future.status).toBe(400);
  });

  it('consultar el expediente queda en auditoría y la bitácora no guarda datos personales', async () => {
    const p = await newPatient();
    await request(app).patch(`/api/v1/patients/${p.id}`).set(auth(doctor.token)).send({ phone: '55 9999 0000', address: 'Calle Ficticia 123' }).expect(200);
    const detail = await request(app).get(`/api/v1/patients/${p.id}`).set(auth(doctor.token));
    expect(detail.body.patient).toMatchObject({ phone: '55 9999 0000', address: 'Calle Ficticia 123' });

    const view = await prisma.auditLog.findFirst({ where: { action: 'PATIENT_VIEW', entityId: p.id, userId: doctor.id } });
    expect(view).not.toBeNull();
    const update = await prisma.auditLog.findFirst({ where: { action: 'PATIENT_UPDATE', entityId: p.id } });
    expect(update?.metadata).toEqual({ fields: ['phone', 'address'] });
    expect(JSON.stringify(update?.metadata)).not.toContain('9999');
  });

  it('permisos: el cajero consulta pero no da de alta; sin permiso no hay acceso', async () => {
    await request(app).post('/api/v1/patients').set(auth(cashier.token)).send({ firstName: 'A', lastName: 'B' }).expect(403);
    const warehouse = await actorWithRole(app, 'WAREHOUSE');
    await request(app).get('/api/v1/patients').set(auth(warehouse.token)).expect(403);
    await request(app).get('/api/v1/patients/search').query({ q: 'pa' }).set(auth(warehouse.token)).expect(403);
  });
});

describe('Recetas', () => {
  it('se registran tal cual, en orden, y quedan en el expediente', async () => {
    const p = await newPatient();
    const res = await prescribe(doctor.token, p.id);
    expect(res.status).toBe(201);
    const rx = res.body.prescription;
    expect(rx.folio).toMatch(/^R-\d{6}$/);
    expect(rx.items.map((i: { medicationName: string }) => i.medicationName)).toEqual(['Amoxicilina 500 mg', 'Paracetamol 500 mg']);
    expect(rx.items[0]).toMatchObject({ dose: '1 cápsula', frequency: 'cada 8 horas', duration: '7 días' });

    const detail = await request(app).get(`/api/v1/patients/${p.id}`).set(auth(doctor.token));
    expect(detail.body.patient.prescriptions).toEqual([expect.objectContaining({ id: rx.id, medications: ['Amoxicilina 500 mg', 'Paracetamol 500 mg'], voided: false })]);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'PRESCRIPTION_CREATE', entityId: rx.id } });
    expect(JSON.stringify(audit?.metadata)).not.toContain('Amoxicilina');
  });

  it('valida la cédula y la fecha', async () => {
    const p = await newPatient();
    expect((await prescribe(doctor.token, p.id, { doctorLicense: '12AB' })).status).toBe(400);
    expect((await prescribe(doctor.token, p.id, { issuedAt: inDays(1) })).status).toBe(400);
    expect((await prescribe(doctor.token, p.id, { issuedAt: inDays(-400) })).status).toBe(400);
    expect((await prescribe(doctor.token, p.id, { items: [] })).status).toBe(400);
  });

  it('es inmutable: no hay edición y la base de datos rechaza cambios y borrados', async () => {
    const p = await newPatient();
    const rx = (await prescribe(doctor.token, p.id)).body.prescription;
    await request(app).patch(`/api/v1/prescriptions/${rx.id}`).set(auth(owner.token)).send({ doctorName: 'Otro' }).expect(404);
    await expect(prisma.prescription.update({ where: { id: rx.id }, data: { doctorName: 'Otro médico' } })).rejects.toThrow();
    await expect(prisma.prescription.delete({ where: { id: rx.id } })).rejects.toThrow();
    await expect(prisma.prescriptionItem.updateMany({ where: { prescriptionId: rx.id }, data: { dose: '2 cápsulas' } })).rejects.toThrow();
  });

  it('sólo el administrador o el propietario la anulan, con motivo, y no si ya surtió una venta', async () => {
    const p = await newPatient();
    const rx = (await prescribe(doctor.token, p.id)).body.prescription;
    await request(app).post(`/api/v1/prescriptions/${rx.id}/void`).set(auth(doctor.token)).send({ reason: 'Error de captura' }).expect(403);
    await request(app).post(`/api/v1/prescriptions/${rx.id}/void`).set(auth(admin.token)).send({ reason: 'x' }).expect(400);
    const voided = await request(app).post(`/api/v1/prescriptions/${rx.id}/void`).set(auth(admin.token)).send({ reason: 'Error de captura en la dosis' });
    expect(voided.body.prescription).toMatchObject({ voided: true, voidReason: 'Error de captura en la dosis' });
    await request(app).post(`/api/v1/prescriptions/${rx.id}/void`).set(auth(admin.token)).send({ reason: 'Otra vez' }).expect(422);
    // Anulada no aparece por omisión, pero sigue en el historial
    const list = await request(app).get('/api/v1/prescriptions').query({ patientId: p.id }).set(auth(doctor.token));
    expect(list.body.data).toHaveLength(0);
    const all = await request(app).get('/api/v1/prescriptions').query({ patientId: p.id, includeVoided: 'true' }).set(auth(doctor.token));
    expect(all.body.data).toEqual([expect.objectContaining({ id: rx.id, voided: true })]);
  });

  it('búsqueda por folio, paciente o médico', async () => {
    const p = await newPatient({ firstName: `Buscable ${tag()}` });
    const rx = (await prescribe(doctor.token, p.id, { doctorName: `Dr. Ejemplo ${tag()}` })).body.prescription;
    for (const q of [rx.folio, p.fullName.split(' ').slice(0, 2).join(' '), rx.doctorName.toLowerCase()]) {
      const res = await request(app).get('/api/v1/prescriptions').query({ q }).set(auth(pharmacist.token));
      expect(res.body.data.map((x: { id: string }) => x.id), q).toContain(rx.id);
    }
  });
});

describe('Venta de productos que retienen receta', () => {
  const sell = (token: string, body: Record<string, unknown>) => request(app).post('/api/v1/sales').set(auth(token)).send(body);
  const cash = [{ method: 'CASH', amount: 90, received: 100 }];

  it('exige ligar o registrar la receta; la casilla de "revisé" no basta', async () => {
    const product = await controlledProduct();
    const items = [{ productId: product.id, quantity: 1 }];
    const res = await sell(pharmacist.token, { items, payments: cash, prescriptionChecked: true });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/retiene receta/);
  });

  it('registrar la receta al surtir la liga a la venta y al paciente', async () => {
    const product = await controlledProduct();
    const p = await newPatient();
    const res = await sell(pharmacist.token, {
      items: [{ productId: product.id, quantity: 1 }],
      payments: cash,
      patientId: p.id,
      prescription: { doctorName: 'Dr. Ficticio Uno', doctorLicense: '7654321', issuedAt: todayISO() },
    });
    expect(res.status).toBe(201);
    const sale = res.body.sale;
    expect(sale).toMatchObject({ patient: { id: p.id }, prescriptionChecked: true, prescription: { folio: expect.stringMatching(/^R-/) } });
    const rx = await request(app).get(`/api/v1/prescriptions/${sale.prescription.id}`).set(auth(pharmacist.token));
    expect(rx.body.prescription.items).toEqual([expect.objectContaining({ product: expect.objectContaining({ id: product.id }) })]);
    expect(rx.body.prescription.sales).toEqual([expect.objectContaining({ id: sale.id })]);

    // Ya surtida, no se puede anular
    await request(app).post(`/api/v1/prescriptions/${sale.prescription.id}/void`).set(auth(owner.token)).send({ reason: 'Ya no' }).expect(422);
    // El expediente del paciente muestra la compra
    const detail = await request(app).get(`/api/v1/patients/${p.id}`).set(auth(pharmacist.token));
    expect(detail.body.patient.purchases.map((s: { id: string }) => s.id)).toContain(sale.id);
  });

  it('o ligar una receta ya registrada del mismo paciente', async () => {
    const product = await controlledProduct();
    const p = await newPatient();
    const other = await newPatient();
    const rx = (await prescribe(doctor.token, p.id)).body.prescription;
    const items = [{ productId: product.id, quantity: 1 }];
    expect((await sell(cashier.token, { items, payments: cash, patientId: other.id, prescriptionId: rx.id })).status).toBe(400);
    const ok = await sell(cashier.token, { items, payments: cash, prescriptionId: rx.id });
    expect(ok.status).toBe(201);
    expect(ok.body.sale.patient).toMatchObject({ id: p.id });

    // Ya surtida no se vuelve a usar... salvo que esa venta se cancele
    const again = await sell(cashier.token, { items, payments: cash, prescriptionId: rx.id });
    expect(again.status).toBe(422);
    expect(again.body.error.message).toMatch(/ya se surtió/);
    await request(app).post(`/api/v1/sales/${ok.body.sale.id}/cancel`).set(auth(owner.token)).send({ reason: 'Cobro duplicado' }).expect(200);
    expect((await sell(cashier.token, { items, payments: cash, prescriptionId: rx.id })).status).toBe(201);
  });

  it('el cajero no registra recetas nuevas y un rol sin pacientes no ve al paciente de la venta', async () => {
    const product = await controlledProduct();
    const p = await newPatient();
    const res = await sell(cashier.token, {
      items: [{ productId: product.id, quantity: 1 }],
      payments: cash,
      patientId: p.id,
      prescription: { doctorName: 'Dr. Ficticio Dos', issuedAt: todayISO() },
    });
    expect(res.status).toBe(403);

    const rx = (await prescribe(doctor.token, p.id)).body.prescription;
    const sale = (await sell(pharmacist.token, { items: [{ productId: product.id, quantity: 1 }], payments: cash, prescriptionId: rx.id })).body.sale;
    const role = await prisma.role.create({
      data: { code: `VENTAS_${tag()}`, name: `Sólo ventas ${tag()}`, permissions: { create: [{ permission: { connect: { key: 'sales.view' } } }] } },
    });
    const viewer = await actorWithRole(app, role.code);
    const seen = await request(app).get(`/api/v1/sales/${sale.id}`).set(auth(viewer.token));
    expect(seen.body.sale).toMatchObject({ patient: null, prescription: null, hasPatient: true });
  });
});
