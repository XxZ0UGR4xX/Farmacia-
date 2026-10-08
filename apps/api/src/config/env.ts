import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatoria'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET debe tener al menos 32 caracteres'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900), // 15 min
  REFRESH_TTL_REMEMBER_DAYS: z.coerce.number().int().positive().default(30),
  REFRESH_TTL_SESSION_HOURS: z.coerce.number().int().positive().default(12),

  APP_URL: z.url().default('http://localhost:5173'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  COOKIE_SECURE: bool.optional(),
  TRUST_PROXY: z.string().default('false'),

  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_ENABLED: bool.default(true),

  /** Carpeta de archivos subidos (imágenes de productos) */
  UPLOAD_DIR: z.string().default('uploads'),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: bool.default(false),
  MAIL_FROM: z.string().default('Farmacia <no-reply@farmacia.local>'),
});

export type Env = z.infer<typeof envSchema> & { COOKIE_SECURE: boolean };

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    // Fallar rápido: la app no debe arrancar con configuración insegura o incompleta.
    throw new Error(`Configuración de entorno inválida:\n${issues}`);
  }
  const data = parsed.data;
  if (data.NODE_ENV === 'production' && /change-me|dev-only/i.test(data.JWT_ACCESS_SECRET)) {
    throw new Error('JWT_ACCESS_SECRET de desarrollo detectado en producción');
  }
  return { ...data, COOKIE_SECURE: data.COOKIE_SECURE ?? data.NODE_ENV === 'production' };
}

export const env = loadEnv();

/** Valor para app.set('trust proxy'): 'false' | 'true' | número de saltos | lista de IPs. */
export function trustProxySetting(): boolean | number | string {
  const v = env.TRUST_PROXY.trim();
  if (v === 'false') return false;
  if (v === 'true') return true;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}
