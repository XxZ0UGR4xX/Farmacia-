import { passwordPolicyErrors } from '@farmacia/shared';
import { z } from 'zod';

/** Contraseña nueva + confirmación, con la misma política que valida el backend. */
export const newPasswordFields = {
  password: z.string().superRefine((value, ctx) => {
    const [first] = passwordPolicyErrors(value);
    if (first) ctx.addIssue({ code: 'custom', message: first });
  }),
  confirmPassword: z.string().min(1, 'Confirma la contraseña'),
};

export const passwordsMatch = <T extends { password: string; confirmPassword: string }>(d: T) =>
  d.password === d.confirmPassword;

export const PASSWORD_HINT = 'Mínimo 10 caracteres, con al menos una letra y un número.';
