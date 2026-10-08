import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { AppError } from '../../shared/errors';

const ISSUER = 'farmacia-api';
const AUDIENCE = 'farmacia-web';

export interface AccessTokenPayload {
  sub: string; // userId
  sid: string; // sessionId
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign({ sid: payload.sid }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    subject: payload.sub,
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: env.JWT_ACCESS_TTL_SECONDS,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'], // Fija el algoritmo: evita ataques de "alg: none" / confusión de algoritmo
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (typeof decoded !== 'object' || typeof decoded.sub !== 'string' || typeof decoded.sid !== 'string') {
      throw new Error('payload inválido');
    }
    return { sub: decoded.sub, sid: decoded.sid };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw AppError.unauthenticated('La sesión expiró', 'TOKEN_EXPIRED');
    }
    throw AppError.unauthenticated('Token inválido', 'INVALID_TOKEN');
  }
}
