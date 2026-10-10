import { createApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { startAlertsScheduler } from './modules/notifications/alerts.service';

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info(`API de Farmacia escuchando en http://localhost:${env.PORT} (${env.NODE_ENV})`);
});
// Alertas de existencias, caducidades y pagos: revisión periódica en segundo plano
startAlertsScheduler();

async function shutdown(signal: string) {
  logger.info(`${signal} recibido, cerrando...`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  // Forzar salida si alguna conexión queda colgada
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Promesa rechazada sin manejar');
});
