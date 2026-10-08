export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_LOCKED'
  | 'ACCOUNT_INACTIVE'
  | 'TOKEN_EXPIRED'
  | 'INVALID_TOKEN'
  | 'REFRESH_RACE'
  | 'CSRF_INVALID'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'BUSINESS_RULE'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static badRequest(message: string, details?: unknown) {
    return new AppError(400, 'VALIDATION_ERROR', message, details);
  }
  static unauthenticated(message = 'Debes iniciar sesión', code: ErrorCode = 'UNAUTHENTICATED') {
    return new AppError(401, code, message);
  }
  static forbidden(message = 'No tienes permiso para realizar esta acción') {
    return new AppError(403, 'FORBIDDEN', message);
  }
  static notFound(message = 'Recurso no encontrado') {
    return new AppError(404, 'NOT_FOUND', message);
  }
  static conflict(message: string, details?: unknown) {
    return new AppError(409, 'CONFLICT', message, details);
  }
  /** Violación de una regla de negocio (p.ej. vender sin existencia). */
  static businessRule(message: string, details?: unknown) {
    return new AppError(422, 'BUSINESS_RULE', message, details);
  }
}
