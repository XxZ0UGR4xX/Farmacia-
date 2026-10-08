import type { RequestHandler } from 'express';
import multer from 'multer';
import { randomBytes } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { env } from '../../config/env';
import { logger } from '../../lib/logger';
import { AppError } from '../../shared/errors';

export const UPLOADS_URL_PREFIX = '/api/uploads';
const PRODUCTS_DIR = 'products';
const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function uploadsRoot(): string {
  return path.resolve(env.UPLOAD_DIR);
}

/** Recibe un único archivo "image" en memoria (máx. 5 MB, JPG/PNG/WebP). */
export const receiveImage: RequestHandler = (req, res, next) => {
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BYTES, files: 1 },
    fileFilter: (_req, file, cb) => cb(null, ACCEPTED.has(file.mimetype)),
  }).single('image')(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      return next(
        AppError.badRequest(err.code === 'LIMIT_FILE_SIZE' ? 'La imagen no debe pesar más de 5 MB' : 'Archivo inválido'),
      );
    }
    if (err) return next(err);
    if (!req.file) return next(AppError.badRequest('Selecciona una imagen JPG, PNG o WebP'));
    next();
  });
};

/**
 * Re-codifica la imagen: elimina metadatos (EXIF/GPS) y cualquier contenido que no sea
 * imagen, la reduce a 800 px y la guarda como WebP. Devuelve la URL pública.
 */
export async function storeProductImage(productId: string, buffer: Buffer): Promise<string> {
  let output: Buffer;
  try {
    output = await sharp(buffer, { limitInputPixels: 40_000_000 })
      .rotate() // respeta la orientación de fotos de celular
      .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    throw AppError.badRequest('El archivo no es una imagen válida');
  }
  const dir = path.join(uploadsRoot(), PRODUCTS_DIR);
  await mkdir(dir, { recursive: true });
  // Nombre impredecible: no se puede adivinar la imagen de otro producto
  const filename = `${productId}-${randomBytes(8).toString('hex')}.webp`;
  await writeFile(path.join(dir, filename), output);
  return `${UPLOADS_URL_PREFIX}/${PRODUCTS_DIR}/${filename}`;
}

/** Borra el archivo de una URL generada por storeProductImage (ignora URLs ajenas). */
export async function deleteStoredImage(url: string | null): Promise<void> {
  if (!url?.startsWith(`${UPLOADS_URL_PREFIX}/${PRODUCTS_DIR}/`)) return;
  const filename = path.basename(url);
  if (!/^[0-9a-f-]{36}-[0-9a-f]{16}\.webp$/.test(filename)) return;
  try {
    await unlink(path.join(uploadsRoot(), PRODUCTS_DIR, filename));
  } catch (err) {
    logger.warn({ err, url }, 'No se pudo borrar la imagen anterior');
  }
}
