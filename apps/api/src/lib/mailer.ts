import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env';
import { logger } from './logger';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

class SmtpMailer implements Mailer {
  constructor(private readonly transporter: Transporter) {}

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({ from: env.MAIL_FROM, ...message });
  }
}

/** Sin SMTP configurado: el correo se escribe en el log (sólo útil en desarrollo). */
class LogMailer implements Mailer {
  async send(message: MailMessage): Promise<void> {
    logger.warn(
      { to: message.to, subject: message.subject },
      `SMTP no configurado. Contenido del correo:\n${message.text}`,
    );
  }
}

/** Para pruebas: guarda los correos enviados. */
export class MemoryMailer implements Mailer {
  readonly outbox: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> {
    this.outbox.push(message);
  }
}

function createMailer(): Mailer {
  if (env.SMTP_HOST) {
    return new SmtpMailer(
      nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT ?? 587,
        secure: env.SMTP_SECURE,
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
      }),
    );
  }
  if (env.NODE_ENV === 'production') {
    logger.warn('SMTP no configurado: la recuperación de contraseña no enviará correos');
  }
  return new LogMailer();
}

let current: Mailer = createMailer();

export const mailer: Mailer = {
  send: (message) => current.send(message),
};

/** Permite sustituir el transporte (pruebas). */
export function setMailer(m: Mailer): void {
  current = m;
}
