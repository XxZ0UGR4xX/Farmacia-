import argon2 from 'argon2';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

// Parámetros Argon2id recomendados por OWASP (m=19 MiB, t=2, p=1)
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

// Hash ficticio para igualar tiempos cuando el usuario no existe (evita enumeración)
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  return dummyHash;
}

/** Token opaco de 256 bits, codificado base64url. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** SHA-256 hex: para guardar tokens de alta entropía (no contraseñas). */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

// Sin caracteres ambiguos (0/O, 1/l/I) para que se pueda dictar o copiar a mano
const TEMP_LETTERS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
const TEMP_DIGITS = '23456789';

/** Contraseña temporal legible de 12 caracteres que cumple la política (letras y números). */
export function generateTemporaryPassword(length = 12): string {
  const all = TEMP_LETTERS + TEMP_DIGITS;
  const chars = [
    TEMP_LETTERS[randomInt(TEMP_LETTERS.length)]!,
    TEMP_DIGITS[randomInt(TEMP_DIGITS.length)]!,
    ...Array.from({ length: length - 2 }, () => all[randomInt(all.length)]!),
  ];
  // Mezcla Fisher-Yates para que la letra y el dígito garantizados no queden siempre al inicio
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}
