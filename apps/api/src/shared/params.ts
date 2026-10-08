import type { Request } from 'express';
import { z } from 'zod';
import { AppError } from './errors';

const uuid = z.uuid();

/** Lee un parámetro de ruta UUID; un id mal formado se trata como "no encontrado". */
export function uuidParam(req: Request, name = 'id'): string {
  const parsed = uuid.safeParse(req.params[name]);
  if (!parsed.success) throw AppError.notFound();
  return parsed.data;
}
