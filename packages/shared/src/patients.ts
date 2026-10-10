/**
 * Pacientes y recetas. El sistema es una herramienta administrativa y de registro:
 * transcribe lo que indica el médico y NUNCA sugiere, calcula ni determina tratamientos.
 */

export const ADMINISTRATIVE_NOTICE =
  'Registro administrativo: se transcribe lo que indicó el médico. El sistema no sugiere, calcula ni determina tratamientos.';

export const formatPrescriptionNumber = (n: number) => `R-${String(n).padStart(6, '0')}`;

/** Teléfono enmascarado para listados: "•••• 4321". */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : '••••';
}

/** Edad cumplida a una fecha (ambas "AAAA-MM-DD"). */
export function ageOn(birthDate: string | null | undefined, today: string): number | null {
  if (!birthDate) return null;
  const [by, bm, bd] = birthDate.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age--;
  return age;
}

/** Cédula profesional mexicana: 7 u 8 dígitos. */
export const LICENSE_REGEX = /^\d{7,8}$/;
