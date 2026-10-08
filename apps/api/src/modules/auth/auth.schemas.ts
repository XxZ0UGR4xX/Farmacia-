import { PASSWORD_MAX_LENGTH, passwordPolicyErrors } from '@farmacia/shared';
import { z } from 'zod';

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Correo electrónico inválido').max(160));

/** Contraseña nueva: aplica la política compartida. */
export const newPasswordSchema = z
  .string()
  .max(PASSWORD_MAX_LENGTH)
  .superRefine((value, ctx) => {
    for (const message of passwordPolicyErrors(value)) ctx.addIssue({ code: 'custom', message });
  });

export const loginSchema = z.object({
  email,
  // En login no se aplica la política (sólo límites) para no revelar reglas ni bloquear cuentas antiguas
  password: z.string().min(1, 'La contraseña es obligatoria').max(PASSWORD_MAX_LENGTH),
  rememberMe: z.boolean().optional().default(false),
});
export type LoginDto = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email });
export type ForgotPasswordDto = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: newPasswordSchema,
});
export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
    newPassword: newPasswordSchema,
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: 'La nueva contraseña debe ser distinta a la actual',
    path: ['newPassword'],
  });
export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;
