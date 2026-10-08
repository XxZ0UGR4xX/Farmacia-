import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '../generated/prisma/client';
import { logger } from '../lib/logger';
import { AppError } from '../shared/errors';

interface ErrorBody {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

function fromPrisma(err: Prisma.PrismaClientKnownRequestError): AppError | null {
  switch (err.code) {
    case 'P2002': {
      const target = (err.meta as { target?: unknown } | undefined)?.target;
      return AppError.conflict('Ya existe un registro con esos datos', { fields: target });
    }
    case 'P2025':
      return AppError.notFound();
    case 'P2003':
      return AppError.conflict('La operación viola una relación con otros registros');
    default:
      return null;
  }
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(AppError.notFound('Ruta no encontrada'));
};

/** Manejo centralizado de errores: respuestas consistentes y sin filtrar detalles internos. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let appError: AppError | null = null;

  if (err instanceof AppError) {
    appError = err;
  } else if (err instanceof ZodError) {
    appError = AppError.badRequest(
      'Los datos enviados no son válidos',
      err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    appError = fromPrisma(err);
  } else if (typeof err === 'object' && err !== null && 'type' in err) {
    // Errores de body-parser (JSON mal formado, cuerpo demasiado grande)
    const type = (err as { type: unknown }).type;
    if (type === 'entity.parse.failed') appError = AppError.badRequest('JSON mal formado');
    if (type === 'entity.too.large') {
      appError = new AppError(413, 'VALIDATION_ERROR', 'La solicitud es demasiado grande');
    }
  }

  if (!appError) {
    logger.error({ err, requestId: req.id }, 'Error no controlado');
    appError = new AppError(500, 'INTERNAL_ERROR', 'Ocurrió un error inesperado. Intenta de nuevo.');
  } else if (appError.status >= 500) {
    logger.error({ err, requestId: req.id }, appError.message);
  }

  const body: ErrorBody = {
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details !== undefined ? { details: appError.details } : {}),
      ...(appError.status >= 500 ? { requestId: req.id } : {}),
    },
  };
  res.status(appError.status).json(body);
};
