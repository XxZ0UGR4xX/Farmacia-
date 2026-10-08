/** Política de contraseñas compartida (validación en frontend y backend). */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export function passwordPolicyErrors(password: string): string[] {
  const errors: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) {
    errors.push(`Debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    errors.push(`Debe tener como máximo ${PASSWORD_MAX_LENGTH} caracteres`);
  }
  if (!/[a-zA-Z]/.test(password)) errors.push('Debe incluir al menos una letra');
  if (!/\d/.test(password)) errors.push('Debe incluir al menos un número');
  return errors;
}
