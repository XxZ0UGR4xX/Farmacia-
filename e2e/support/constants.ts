import { randomBytes } from 'node:crypto';

/**
 * Datos de las pruebas E2E. La contraseña de los usuarios de prueba no está escrita en el código:
 * se genera al iniciar cada corrida y la heredan los servidores y los procesos de prueba.
 */
export const E2E_PASSWORD = (process.env.E2E_PASSWORD ??= `E2e${randomBytes(9).toString('hex')}9`);
export const OWNER_EMAIL = 'propietario@farmacia-e2e.local';

export const API_PORT = 4100;
export const WEB_PORT = 4174;
export const BASE_URL = `http://localhost:${WEB_PORT}`;

/** Usuarios de demostración que crea `db:seed:demo`. */
export const USERS = {
  owner: OWNER_EMAIL,
  admin: 'admin@farmacia.local',
  pharmacist: 'farmaceutico@farmacia.local',
  cashier: 'caja@farmacia.local',
  warehouse: 'almacen@farmacia.local',
} as const;
export type Who = keyof typeof USERS;
