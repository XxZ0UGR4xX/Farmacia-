import { ageOn, formatPrescriptionNumber, formatSaleNumber, hasPermission, maskPhone, normalizeSearch } from '@farmacia/shared';
import { Prisma } from '../../generated/prisma/client';
import { dateOnly, parseDateOnly, todayISO } from '../../lib/dates';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../shared/errors';
import { paginated, type PaginationDto } from '../../shared/pagination';
import type { AuthContext, ClientInfo } from '../../shared/request-context';
import { recordAudit } from '../audit/audit.service';
import type { PatientDto } from './patients.schemas';

/**
 * Pacientes (información personal protegida).
 * - Los listados muestran lo mínimo (teléfono enmascarado); el expediente completo sólo
 *   en el detalle, y cada consulta del detalle queda en auditoría.
 * - La auditoría registra QUÉ campos cambiaron, no sus valores: los datos personales
 *   no se copian a la bitácora.
 * - No se borran: el historial de recetas y compras se conserva.
 */

const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`.trim();

/** Busca ids por nombre (sin acentos, todas las palabras), teléfono o correo. */
async function searchIds(q: string, limit: number, offset: number): Promise<{ ids: string[]; total: number }> {
  const terms = normalizeSearch(q).split(' ').filter(Boolean).slice(0, 6);
  const digits = q.replace(/\D/g, '');
  const nameMatch = terms.length
    ? Prisma.join(
        terms.map((t) => Prisma.sql`translate(lower(first_name || ' ' || last_name), 'áéíóúüñ', 'aeiouun') LIKE ${`%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}`),
        ' AND ',
      )
    : Prisma.sql`FALSE`;
  const where = Prisma.sql`deleted_at IS NULL AND ((${nameMatch})
    ${digits.length >= 4 ? Prisma.sql`OR regexp_replace(coalesce(phone, ''), '\\D', '', 'g') LIKE ${`%${digits}%`}` : Prisma.empty}
    OR lower(coalesce(email, '')) = ${q.trim().toLowerCase()})`;
  const [rows, count] = await Promise.all([
    prisma.$queryRaw<{ id: string }[]>`SELECT id FROM patients WHERE ${where} ORDER BY last_name, first_name LIMIT ${limit} OFFSET ${offset}`,
    prisma.$queryRaw<{ total: number }[]>`SELECT COUNT(*)::int AS total FROM patients WHERE ${where}`,
  ]);
  return { ids: rows.map((r) => r.id), total: count[0]?.total ?? 0 };
}

function summaryDto(p: { id: string; firstName: string; lastName: string; birthDate: Date | null; phone: string | null }, today: string) {
  return {
    id: p.id,
    fullName: fullName(p),
    age: ageOn(p.birthDate ? dateOnly(p.birthDate) : null, today),
    phone: maskPhone(p.phone),
  };
}

export async function listPatients(query: PaginationDto & { q?: string }) {
  const today = todayISO();
  const offset = (query.page - 1) * query.pageSize;
  let ids: string[];
  let total: number;
  if (query.q) ({ ids, total } = await searchIds(query.q, query.pageSize, offset));
  else {
    [ids, total] = await Promise.all([
      prisma.patient.findMany({ where: { deletedAt: null }, select: { id: true }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }], skip: offset, take: query.pageSize }).then((r) => r.map((x) => x.id)),
      prisma.patient.count({ where: { deletedAt: null } }),
    ]);
  }
  const rows = await prisma.patient.findMany({
    where: { id: { in: ids } },
    include: {
      _count: { select: { prescriptions: { where: { deletedAt: null } }, sales: true } },
      prescriptions: { where: { deletedAt: null }, select: { issuedAt: true }, orderBy: { issuedAt: 'desc' }, take: 1 },
      sales: { select: { createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return paginated(
    ids.map((id) => byId.get(id)!).filter(Boolean).map((p) => {
      const lastRx = p.prescriptions[0]?.issuedAt;
      const lastSale = p.sales[0]?.createdAt;
      const last = [lastRx ? dateOnly(lastRx) : null, lastSale ? lastSale.toISOString().slice(0, 10) : null].filter(Boolean).sort().at(-1) ?? null;
      return { ...summaryDto(p, today), prescriptions: p._count.prescriptions, purchases: p._count.sales, lastVisit: last };
    }),
    total,
    query,
  );
}

/** Búsqueda rápida para selectores (punto de venta, recetas). */
export async function searchPatients(q: string) {
  if (q.trim().length < 2) return [];
  const today = todayISO();
  const { ids } = await searchIds(q, 10, 0);
  const rows = await prisma.patient.findMany({ where: { id: { in: ids } } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)!).filter(Boolean).map((p) => summaryDto(p, today));
}

async function findOrThrow(id: string) {
  const p = await prisma.patient.findFirst({ where: { id, deletedAt: null } });
  if (!p) throw AppError.notFound('El paciente no existe');
  return p;
}

/** Expediente completo. Cada consulta queda registrada en auditoría (quién vio a quién). */
export async function getPatient(auth: AuthContext, branchId: string, id: string, client: ClientInfo) {
  const p = await findOrThrow(id);
  const today = todayISO();
  const canSeeRx = hasPermission(auth.roleCode, auth.permissions, 'prescriptions.view');
  const canSeeSales = hasPermission(auth.roleCode, auth.permissions, 'sales.view');
  const [prescriptions, sales] = await Promise.all([
    canSeeRx
      ? prisma.prescription.findMany({
          where: { patientId: id },
          include: { items: { select: { medicationName: true } }, _count: { select: { sales: true } } },
          orderBy: { issuedAt: 'desc' },
          take: 50,
        })
      : Promise.resolve([]),
    canSeeSales
      ? prisma.sale.findMany({
          where: { patientId: id, branchId },
          include: { items: { include: { product: { select: { commercialName: true } } } } },
          orderBy: { createdAt: 'desc' },
          take: 50,
        })
      : Promise.resolve([]),
  ]);
  await recordAudit({ action: 'PATIENT_VIEW', userId: auth.userId, branchId, entityType: 'patient', entityId: id, client });
  return {
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    fullName: fullName(p),
    birthDate: p.birthDate ? dateOnly(p.birthDate) : null,
    age: ageOn(p.birthDate ? dateOnly(p.birthDate) : null, today),
    phone: p.phone,
    email: p.email,
    address: p.address,
    notes: p.notes,
    createdAt: p.createdAt.toISOString(),
    prescriptions: prescriptions.map((r) => ({
      id: r.id,
      folio: formatPrescriptionNumber(r.number),
      doctorName: r.doctorName,
      issuedAt: dateOnly(r.issuedAt),
      medications: r.items.map((i) => i.medicationName),
      sales: r._count.sales,
      voided: r.deletedAt !== null,
    })),
    purchases: sales.map((s) => ({
      id: s.id,
      folio: formatSaleNumber(s.number),
      status: s.status,
      createdAt: s.createdAt.toISOString(),
      total: Number(s.total),
      products: s.items.map((i) => `${i.quantity} × ${i.product.commercialName}`),
    })),
  };
}

async function assertNotDuplicate(dto: Partial<PatientDto>, exceptId?: string) {
  if (!dto.firstName || !dto.lastName || !dto.birthDate) return;
  const dup = await prisma.patient.findFirst({
    where: {
      deletedAt: null,
      firstName: { equals: dto.firstName, mode: 'insensitive' },
      lastName: { equals: dto.lastName, mode: 'insensitive' },
      birthDate: parseDateOnly(dto.birthDate),
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (dup) throw AppError.conflict('Ya existe un paciente con ese nombre y fecha de nacimiento', { patientId: dup.id });
}

function assertBirthDate(dto: Partial<PatientDto>) {
  if (dto.birthDate && dto.birthDate > todayISO()) {
    throw AppError.badRequest('La fecha de nacimiento no puede ser futura', [{ path: 'birthDate', message: 'Fecha futura' }]);
  }
}

export async function createPatient(auth: AuthContext, branchId: string, dto: PatientDto, client: ClientInfo) {
  assertBirthDate(dto);
  await assertNotDuplicate(dto);
  const p = await prisma.$transaction(async (tx) => {
    const created = await tx.patient.create({ data: { ...dto, birthDate: dto.birthDate ? parseDateOnly(dto.birthDate) : null } });
    // Sin datos personales en la bitácora: sólo el identificador
    await recordAudit({ action: 'PATIENT_CREATE', userId: auth.userId, branchId, entityType: 'patient', entityId: created.id, client }, tx);
    return created;
  });
  return summaryDto(p, todayISO());
}

export async function updatePatient(auth: AuthContext, branchId: string, id: string, dto: Partial<PatientDto>, client: ClientInfo) {
  const current = await findOrThrow(id);
  assertBirthDate(dto);
  const next = {
    ...dto,
    ...(dto.birthDate !== undefined ? { birthDate: dto.birthDate ? parseDateOnly(dto.birthDate) : null } : {}),
  };
  const changed = Object.entries(next)
    .filter(([k, v]) => {
      if (v === undefined) return false;
      const old = current[k as keyof typeof current];
      return old instanceof Date || v instanceof Date ? (old as Date | null)?.getTime() !== (v as Date | null)?.getTime() : old !== v;
    })
    .map(([k]) => k);
  if (changed.length === 0) return summaryDto(current, todayISO());
  await assertNotDuplicate(
    { firstName: dto.firstName ?? current.firstName, lastName: dto.lastName ?? current.lastName, birthDate: dto.birthDate ?? (current.birthDate ? dateOnly(current.birthDate) : null) },
    id,
  );
  const p = await prisma.$transaction(async (tx) => {
    const saved = await tx.patient.update({ where: { id }, data: next });
    await recordAudit({ action: 'PATIENT_UPDATE', userId: auth.userId, branchId, entityType: 'patient', entityId: id, metadata: { fields: changed }, client }, tx);
    return saved;
  });
  return summaryDto(p, todayISO());
}
