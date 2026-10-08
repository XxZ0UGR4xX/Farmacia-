import { ALL_PERMISSIONS, OWNER_ROLE_CODE } from '@farmacia/shared';
import { env } from '../../config/env';
import { generateToken, getDummyHash, hashPassword, sha256, verifyPassword } from '../../lib/crypto';
import { logger } from '../../lib/logger';
import { mailer } from '../../lib/mailer';
import { prisma, type DbClient } from '../../lib/prisma';
import { AppError } from '../../shared/errors';
import type { AuthContext, ClientInfo } from '../../shared/request-context';
import { recordAudit } from '../audit/audit.service';
import type { ChangePasswordDto, ForgotPasswordDto, LoginDto, ResetPasswordDto } from './auth.schemas';
import { invalidateSession, invalidateUser } from './session-cache';
import { signAccessToken } from './tokens';

/** Ventana en la que un refresh token recién rotado se considera carrera (pestañas simultáneas), no robo. */
const REFRESH_RACE_GRACE_MS = 10_000;

export interface UserProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  role: { code: string; name: string };
  permissions: string[];
  branches: { id: string; code: string; name: string }[];
  defaultBranchId: string | null;
  mustChangePassword: boolean;
}

export interface IssuedSession {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  rememberMe: boolean;
  sessionExpiresAt: Date;
  user: UserProfile;
}

// -----------------------------------------------------------------------------
// Perfil
// -----------------------------------------------------------------------------

export async function getProfile(userId: string, db: DbClient = prisma): Promise<UserProfile> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      role: { include: { permissions: { include: { permission: true } } } },
      branches: { include: { branch: true }, orderBy: { branch: { name: 'asc' } } },
    },
  });
  if (!user || user.deletedAt) throw AppError.notFound('Usuario no encontrado');

  const permissions =
    user.role.code === OWNER_ROLE_CODE
      ? [...ALL_PERMISSIONS]
      : user.role.permissions.map((rp) => rp.permission.key).sort();

  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: `${user.firstName} ${user.lastName}`.trim(),
    role: { code: user.role.code, name: user.role.name },
    permissions,
    branches: user.branches
      .filter((ub) => ub.branch.isActive)
      .map((ub) => ({ id: ub.branch.id, code: ub.branch.code, name: ub.branch.name })),
    defaultBranchId: user.defaultBranchId,
    mustChangePassword: user.mustChangePassword,
  };
}

// -----------------------------------------------------------------------------
// Login
// -----------------------------------------------------------------------------

function sessionTtlMs(rememberMe: boolean): number {
  return rememberMe
    ? env.REFRESH_TTL_REMEMBER_DAYS * 24 * 60 * 60 * 1000
    : env.REFRESH_TTL_SESSION_HOURS * 60 * 60 * 1000;
}

const invalidCredentials = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'Correo o contraseña incorrectos');

export async function login(dto: LoginDto, client: ClientInfo): Promise<IssuedSession> {
  const user = await prisma.user.findUnique({ where: { email: dto.email } });

  if (!user || user.deletedAt) {
    // Verificar contra un hash ficticio para que el tiempo de respuesta no revele si el correo existe
    await verifyPassword(await getDummyHash(), dto.password);
    await recordAudit({
      action: 'AUTH_LOGIN_FAILED',
      metadata: { email: dto.email, reason: 'UNKNOWN_USER' },
      client,
    });
    throw invalidCredentials();
  }

  const now = new Date();
  if (user.lockedUntil && user.lockedUntil > now) {
    await recordAudit({
      action: 'AUTH_LOGIN_FAILED',
      userId: user.id,
      metadata: { reason: 'ACCOUNT_LOCKED' },
      client,
    });
    throw lockedError(user.lockedUntil);
  }

  const passwordOk = await verifyPassword(user.passwordHash, dto.password);
  if (!passwordOk) {
    await registerFailedAttempt(user.id, client);
    throw invalidCredentials();
  }

  // El estado se revisa DESPUÉS de validar la contraseña: sólo quien la conoce sabe que está inactiva
  if (user.status !== 'ACTIVE') {
    await recordAudit({
      action: 'AUTH_LOGIN_FAILED',
      userId: user.id,
      metadata: { reason: 'ACCOUNT_INACTIVE' },
      client,
    });
    throw new AppError(403, 'ACCOUNT_INACTIVE', 'Tu cuenta está desactivada. Contacta al administrador.');
  }

  return prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: now },
    });
    const issued = await createSession(tx, user.id, dto.rememberMe, client);
    await recordAudit(
      {
        action: 'AUTH_LOGIN',
        userId: user.id,
        branchId: user.defaultBranchId,
        entityType: 'session',
        entityId: issued.sessionId,
        metadata: { rememberMe: dto.rememberMe },
        client,
      },
      tx,
    );
    return issued.session;
  });
}

function lockedError(until: Date): AppError {
  const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));
  return new AppError(
    423,
    'ACCOUNT_LOCKED',
    `Cuenta bloqueada temporalmente por intentos fallidos. Intenta de nuevo en ${minutes} min.`,
  );
}

async function registerFailedAttempt(userId: string, client: ClientInfo): Promise<void> {
  // Incremento atómico: correcto aun con peticiones concurrentes
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { failedLoginAttempts: { increment: 1 } },
    select: { failedLoginAttempts: true },
  });

  if (updated.failedLoginAttempts >= env.LOGIN_MAX_ATTEMPTS) {
    const lockedUntil = new Date(Date.now() + env.LOGIN_LOCK_MINUTES * 60_000);
    await prisma.user.update({
      where: { id: userId },
      data: { lockedUntil, failedLoginAttempts: 0 },
    });
    await recordAudit({
      action: 'AUTH_ACCOUNT_LOCKED',
      userId,
      metadata: { lockedUntil: lockedUntil.toISOString(), attempts: updated.failedLoginAttempts },
      client,
    });
    return;
  }

  await recordAudit({
    action: 'AUTH_LOGIN_FAILED',
    userId,
    metadata: { reason: 'BAD_PASSWORD', attempts: updated.failedLoginAttempts },
    client,
  });
}

async function createSession(
  db: DbClient,
  userId: string,
  rememberMe: boolean,
  client: ClientInfo,
): Promise<{ sessionId: string; session: IssuedSession }> {
  const expiresAt = new Date(Date.now() + sessionTtlMs(rememberMe));
  const session = await db.userSession.create({
    data: {
      userId,
      rememberMe,
      expiresAt,
      ipAddress: client.ipAddress,
      userAgent: client.userAgent,
    },
  });
  const refreshToken = generateToken();
  await db.refreshToken.create({
    data: { sessionId: session.id, tokenHash: sha256(refreshToken), expiresAt },
  });

  return {
    sessionId: session.id,
    session: {
      accessToken: signAccessToken({ sub: userId, sid: session.id }),
      accessTokenExpiresIn: env.JWT_ACCESS_TTL_SECONDS,
      refreshToken,
      rememberMe,
      sessionExpiresAt: expiresAt,
      user: await getProfile(userId, db),
    },
  };
}

// -----------------------------------------------------------------------------
// Refresh (rotación con detección de reutilización)
// -----------------------------------------------------------------------------

const invalidRefresh = () =>
  AppError.unauthenticated('Tu sesión expiró. Inicia sesión de nuevo.', 'INVALID_TOKEN');

export async function refresh(rawToken: string | undefined, client: ClientInfo): Promise<IssuedSession> {
  if (!rawToken) throw invalidRefresh();

  const token = await prisma.refreshToken.findUnique({
    where: { tokenHash: sha256(rawToken) },
    include: { session: { include: { user: true } } },
  });
  if (!token) throw invalidRefresh();

  const { session } = token;
  const now = new Date();
  if (session.revokedAt || session.expiresAt <= now || token.expiresAt <= now) throw invalidRefresh();

  if (token.rotatedAt) {
    if (now.getTime() - token.rotatedAt.getTime() < REFRESH_RACE_GRACE_MS) {
      // Dos pestañas refrescaron a la vez: el cliente debe reintentar (la cookie ya trae el token nuevo)
      throw AppError.unauthenticated('Sesión renovada en otra pestaña', 'REFRESH_RACE');
    }
    // Un token ya usado vuelve a presentarse: posible robo. Se revoca la sesión completa.
    await revokeSession(session.id, 'TOKEN_REUSE');
    await recordAudit({
      action: 'AUTH_TOKEN_REUSE',
      userId: session.userId,
      entityType: 'session',
      entityId: session.id,
      client,
    });
    throw invalidRefresh();
  }

  const { user } = session;
  if (user.deletedAt || user.status !== 'ACTIVE') {
    await revokeSession(session.id, 'USER_INACTIVE');
    throw invalidRefresh();
  }

  return prisma.$transaction(async (tx) => {
    // Marcar como usado sólo si nadie más lo hizo (protección contra carreras)
    const { count } = await tx.refreshToken.updateMany({
      where: { id: token.id, rotatedAt: null },
      data: { rotatedAt: now },
    });
    if (count === 0) throw AppError.unauthenticated('Sesión renovada en otra pestaña', 'REFRESH_RACE');

    const refreshToken = generateToken();
    await tx.refreshToken.create({
      data: { sessionId: session.id, tokenHash: sha256(refreshToken), expiresAt: session.expiresAt },
    });
    await tx.userSession.update({ where: { id: session.id }, data: { lastUsedAt: now } });

    return {
      accessToken: signAccessToken({ sub: user.id, sid: session.id }),
      accessTokenExpiresIn: env.JWT_ACCESS_TTL_SECONDS,
      refreshToken,
      rememberMe: session.rememberMe,
      sessionExpiresAt: session.expiresAt,
      user: await getProfile(user.id, tx),
    };
  });
}

// -----------------------------------------------------------------------------
// Logout
// -----------------------------------------------------------------------------

export async function logout(rawToken: string | undefined, client: ClientInfo): Promise<void> {
  if (!rawToken) return;
  const token = await prisma.refreshToken.findUnique({
    where: { tokenHash: sha256(rawToken) },
    include: { session: true },
  });
  if (!token || token.session.revokedAt) return;

  await revokeSession(token.sessionId, 'LOGOUT');
  await recordAudit({
    action: 'AUTH_LOGOUT',
    userId: token.session.userId,
    entityType: 'session',
    entityId: token.sessionId,
    client,
  });
}

async function revokeSession(sessionId: string, reason: string, db: DbClient = prisma): Promise<void> {
  await db.userSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date(), revokeReason: reason },
  });
  invalidateSession(sessionId);
}

async function revokeAllUserSessions(
  db: DbClient,
  userId: string,
  reason: string,
  exceptSessionId?: string,
): Promise<void> {
  await db.userSession.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date(), revokeReason: reason },
  });
}

// -----------------------------------------------------------------------------
// Recuperación y cambio de contraseña
// -----------------------------------------------------------------------------

export async function requestPasswordReset(dto: ForgotPasswordDto, client: ClientInfo): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email: dto.email } });
  if (!user || user.deletedAt || user.status !== 'ACTIVE') {
    // Respuesta idéntica: no revelar si el correo existe
    logger.info({ email: dto.email }, 'Solicitud de recuperación para correo inexistente o inactivo');
    return;
  }

  const rawToken = generateToken();
  const expiresAt = new Date(Date.now() + env.PASSWORD_RESET_TTL_MINUTES * 60_000);

  await prisma.$transaction(async (tx) => {
    // Sólo el enlace más reciente es válido
    await tx.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    await tx.passwordResetToken.create({
      data: { userId: user.id, tokenHash: sha256(rawToken), expiresAt, ipAddress: client.ipAddress },
    });
    await recordAudit({ action: 'AUTH_PASSWORD_RESET_REQUESTED', userId: user.id, client }, tx);
  });

  const link = `${env.APP_URL.replace(/\/$/, '')}/restablecer-contrasena?token=${encodeURIComponent(rawToken)}`;
  // Sin await: el tiempo de respuesta no debe depender de si se envió un correo
  mailer
    .send({
      to: user.email,
      subject: 'Recuperación de contraseña',
      text:
        `Hola ${user.firstName},\n\n` +
        `Recibimos una solicitud para restablecer tu contraseña. Abre este enlace ` +
        `(válido por ${env.PASSWORD_RESET_TTL_MINUTES} minutos):\n\n${link}\n\n` +
        `Si no fuiste tú, ignora este mensaje; tu contraseña no cambiará.`,
    })
    .catch((err: unknown) => logger.error({ err }, 'No se pudo enviar el correo de recuperación'));
}

export async function resetPassword(dto: ResetPasswordDto, client: ClientInfo): Promise<void> {
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: sha256(dto.token) },
    include: { user: true },
  });
  const now = new Date();
  if (
    !record ||
    record.usedAt ||
    record.expiresAt <= now ||
    record.user.deletedAt ||
    record.user.status !== 'ACTIVE'
  ) {
    throw AppError.badRequest('El enlace de recuperación es inválido o expiró. Solicita uno nuevo.');
  }

  const passwordHash = await hashPassword(dto.password);
  await prisma.$transaction(async (tx) => {
    // Consumir el token de forma atómica (un solo uso aun con peticiones simultáneas)
    const { count } = await tx.passwordResetToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: now },
    });
    if (count === 0) throw AppError.badRequest('El enlace de recuperación ya fue utilizado.');

    await tx.user.update({
      where: { id: record.userId },
      data: {
        passwordHash,
        passwordChangedAt: now,
        failedLoginAttempts: 0,
        lockedUntil: null,
        mustChangePassword: false,
      },
    });
    await revokeAllUserSessions(tx, record.userId, 'PASSWORD_RESET');
    await recordAudit({ action: 'AUTH_PASSWORD_RESET', userId: record.userId, client }, tx);
  });
  invalidateUser(record.userId);
}

export async function changePassword(
  auth: AuthContext,
  dto: ChangePasswordDto,
  client: ClientInfo,
): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });
  if (!(await verifyPassword(user.passwordHash, dto.currentPassword))) {
    throw AppError.badRequest('La contraseña actual es incorrecta', [
      { path: 'currentPassword', message: 'La contraseña actual es incorrecta' },
    ]);
  }

  const passwordHash = await hashPassword(dto.newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash, passwordChangedAt: new Date(), mustChangePassword: false },
    });
    // Cierra las demás sesiones abiertas; la actual sigue activa
    await revokeAllUserSessions(tx, user.id, 'PASSWORD_CHANGED', auth.sessionId);
    await recordAudit({ action: 'AUTH_PASSWORD_CHANGED', userId: user.id, client }, tx);
  });
  invalidateUser(user.id);
}
