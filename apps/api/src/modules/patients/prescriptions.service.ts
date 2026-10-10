import { formatPrescriptionNumber, formatSaleNumber, normalizeSearch } from '@farmacia/shared';
import type { Prisma } from '../../generated/prisma/client';
import { dateOnly, parseDateOnly, todayISO } from '../../lib/dates';
import { prisma, type TxClient } from '../../lib/prisma';
import { AppError } from '../../shared/errors';
import { paginated, toSkipTake } from '../../shared/pagination';
import type { AuthContext, ClientInfo } from '../../shared/request-context';
import { recordAudit } from '../audit/audit.service';
import type { ListPrescriptionsDto, PrescriptionDto } from './patients.schemas';

/**
 * Recetas: registro administrativo de lo que indicó el médico.
 * - Se transcriben tal cual (medicamento, dosis, frecuencia, duración, indicaciones).
 *   El sistema no sugiere, valida clínicamente ni calcula tratamientos.
 * - Una receta registrada es INMUTABLE (lo garantiza la base de datos). Si tiene un error,
 *   quien tiene permiso la anula con un motivo y se registra una nueva; nunca se borra.
 */

const userName = { select: { id: true, firstName: true, lastName: true } } as const;
const fullName = (u: { firstName: string; lastName: string } | null) => (u ? `${u.firstName} ${u.lastName}`.trim() : null);

const MAX_AGE_DAYS = 365;

function assertIssuedAt(issuedAt: string) {
  const today = todayISO();
  if (issuedAt > today) throw AppError.badRequest('La fecha de la receta no puede ser futura', [{ path: 'issuedAt', message: 'Fecha futura' }]);
  const oldest = new Date(`${today}T00:00:00Z`);
  oldest.setUTCDate(oldest.getUTCDate() - MAX_AGE_DAYS);
  if (issuedAt < oldest.toISOString().slice(0, 10)) {
    throw AppError.badRequest('La receta tiene más de un año', [{ path: 'issuedAt', message: 'Receta demasiado antigua' }]);
  }
}

/** Crea la receta dentro de una transacción (la usa también el punto de venta). */
export async function createPrescriptionInTx(tx: TxClient, auth: AuthContext, branchId: string, dto: PrescriptionDto, client: ClientInfo, source = 'manual') {
  assertIssuedAt(dto.issuedAt);
  const patient = await tx.patient.findFirst({ where: { id: dto.patientId, deletedAt: null }, select: { id: true } });
  if (!patient) throw AppError.badRequest('El paciente no existe', [{ path: 'patientId', message: 'Paciente inválido' }]);
  const productIds = dto.items.map((i) => i.productId).filter((id): id is string => Boolean(id));
  if (productIds.length) {
    const found = await tx.product.count({ where: { id: { in: productIds }, deletedAt: null } });
    if (found !== new Set(productIds).size) throw AppError.badRequest('Algún producto de la receta no existe');
  }
  const rx = await tx.prescription.create({
    data: {
      patientId: dto.patientId,
      doctorName: dto.doctorName,
      doctorLicense: dto.doctorLicense ?? null,
      issuedAt: parseDateOnly(dto.issuedAt),
      notes: dto.notes,
      createdById: auth.userId,
      items: {
        create: dto.items.map((i, position) => ({
          position,
          productId: i.productId ?? null,
          medicationName: i.medicationName,
          dose: i.dose,
          frequency: i.frequency,
          duration: i.duration,
          instructions: i.instructions,
        })),
      },
    },
  });
  await recordAudit(
    {
      action: 'PRESCRIPTION_CREATE',
      userId: auth.userId,
      branchId,
      entityType: 'prescription',
      entityId: rx.id,
      // Sin nombres ni medicamentos en la bitácora: sólo referencias
      metadata: { folio: formatPrescriptionNumber(rx.number), patientId: dto.patientId, items: dto.items.length, source },
      client,
    },
    tx,
  );
  return rx;
}

export async function createPrescription(auth: AuthContext, branchId: string, dto: PrescriptionDto, client: ClientInfo) {
  const rx = await prisma.$transaction((tx) => createPrescriptionInTx(tx, auth, branchId, dto, client));
  return getPrescription(auth, branchId, rx.id, client, { audit: false });
}

const detailInclude = {
  patient: { select: { id: true, firstName: true, lastName: true, birthDate: true } },
  items: { include: { product: { select: { id: true, commercialName: true } } }, orderBy: { position: 'asc' } },
  createdBy: userName,
  voidedBy: userName,
  sales: { select: { id: true, number: true, createdAt: true, total: true, status: true }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.PrescriptionInclude;

export async function getPrescription(auth: AuthContext, branchId: string, id: string, client: ClientInfo, opts = { audit: true }) {
  const rx = await prisma.prescription.findUnique({ where: { id }, include: detailInclude });
  if (!rx) throw AppError.notFound('La receta no existe');
  if (opts.audit) await recordAudit({ action: 'PRESCRIPTION_VIEW', userId: auth.userId, branchId, entityType: 'prescription', entityId: id, client });
  return {
    id: rx.id,
    folio: formatPrescriptionNumber(rx.number),
    patient: { id: rx.patient.id, fullName: `${rx.patient.firstName} ${rx.patient.lastName}`.trim(), birthDate: rx.patient.birthDate ? dateOnly(rx.patient.birthDate) : null },
    doctorName: rx.doctorName,
    doctorLicense: rx.doctorLicense,
    issuedAt: dateOnly(rx.issuedAt),
    notes: rx.notes,
    items: rx.items.map((i) => ({
      id: i.id,
      product: i.product,
      medicationName: i.medicationName,
      dose: i.dose,
      frequency: i.frequency,
      duration: i.duration,
      instructions: i.instructions,
    })),
    sales: rx.sales.map((s) => ({ id: s.id, folio: formatSaleNumber(s.number), createdAt: s.createdAt.toISOString(), total: Number(s.total), status: s.status })),
    createdBy: fullName(rx.createdBy),
    createdAt: rx.createdAt.toISOString(),
    voided: rx.deletedAt !== null,
    voidedAt: rx.deletedAt?.toISOString() ?? null,
    voidedBy: fullName(rx.voidedBy),
    voidReason: rx.voidReason,
  };
}

export async function listPrescriptions(query: ListPrescriptionsDto) {
  const folio = query.q?.match(/^(?:r-?)?0*(\d{1,9})$/i);
  const terms = query.q && !folio ? normalizeSearch(query.q).split(' ').filter(Boolean).slice(0, 4) : [];
  const where: Prisma.PrescriptionWhereInput = {
    ...(query.includeVoided ? {} : { deletedAt: null }),
    ...(query.patientId ? { patientId: query.patientId } : {}),
    ...(query.from || query.to
      ? { issuedAt: { ...(query.from ? { gte: parseDateOnly(query.from) } : {}), ...(query.to ? { lte: parseDateOnly(query.to) } : {}) } }
      : {}),
    ...(folio ? { number: Number(folio[1]) } : {}),
    ...(terms.length
      ? {
          AND: terms.map((t) => ({
            OR: [
              { patient: { firstName: { contains: t, mode: 'insensitive' as const } } },
              { patient: { lastName: { contains: t, mode: 'insensitive' as const } } },
              { doctorName: { contains: t, mode: 'insensitive' as const } },
              { doctorLicense: { contains: t } },
            ],
          })),
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.prescription.findMany({
      where,
      include: { patient: { select: { id: true, firstName: true, lastName: true } }, items: { select: { medicationName: true } }, _count: { select: { sales: true } } },
      orderBy: [{ issuedAt: 'desc' }, { number: 'desc' }],
      ...toSkipTake(query),
    }),
    prisma.prescription.count({ where }),
  ]);
  return paginated(
    rows.map((r) => ({
      id: r.id,
      folio: formatPrescriptionNumber(r.number),
      patient: { id: r.patient.id, fullName: `${r.patient.firstName} ${r.patient.lastName}`.trim() },
      doctorName: r.doctorName,
      doctorLicense: r.doctorLicense,
      issuedAt: dateOnly(r.issuedAt),
      medications: r.items.map((i) => i.medicationName),
      sales: r._count.sales,
      voided: r.deletedAt !== null,
    })),
    total,
    query,
  );
}

export async function voidPrescription(auth: AuthContext, branchId: string, id: string, reason: string, client: ClientInfo) {
  await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM prescriptions WHERE id = ${id}::uuid FOR UPDATE`;
    if (locked.length === 0) throw AppError.notFound('La receta no existe');
    const rx = await tx.prescription.findUniqueOrThrow({ where: { id }, include: { _count: { select: { sales: true } } } });
    if (rx.deletedAt) throw AppError.businessRule('La receta ya estaba anulada.');
    if (rx._count.sales > 0) {
      throw AppError.businessRule('La receta ya se usó para surtir una venta: queda como respaldo de esa venta y no se puede anular.');
    }
    await tx.prescription.update({ where: { id }, data: { deletedAt: new Date(), voidedById: auth.userId, voidReason: reason } });
    await recordAudit(
      { action: 'PRESCRIPTION_VOID', userId: auth.userId, branchId, entityType: 'prescription', entityId: id, metadata: { folio: formatPrescriptionNumber(rx.number), reason }, client },
      tx,
    );
  });
  return getPrescription(auth, branchId, id, client, { audit: false });
}
