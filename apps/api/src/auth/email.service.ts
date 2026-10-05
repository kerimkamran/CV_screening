import { Inject, Injectable, Logger } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import { ENV, type Env } from '../config/env';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/** Outbound mail for account credentials. Never logs bodies: they contain a password. */
@Injectable()
export class EmailService {
  private readonly log = new Logger('email');
  constructor(@Inject(ENV) private readonly env: Env) {}

  get provider(): string {
    return this.env.EMAIL_PROVIDER;
  }

  /** True when the message was handed to a real provider. `console` never counts as delivered. */
  async send(mail: Mail): Promise<boolean> {
    try {
      switch (this.env.EMAIL_PROVIDER) {
        case 'smtp': {
          const t = createTransport({
            host: this.env.SMTP_HOST,
            port: this.env.SMTP_PORT,
            secure: this.env.SMTP_SECURE === 'true',
            auth: this.env.SMTP_USER
              ? { user: this.env.SMTP_USER, pass: this.env.SMTP_PASSWORD }
              : undefined,
            connectionTimeout: 10_000,
            socketTimeout: 15_000,
          });
          await t.sendMail({ from: this.env.EMAIL_FROM, ...mail });
          return true;
        }
        case 'resend': {
          const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              authorization: `Bearer ${this.env.RESEND_API_KEY}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              from: this.env.EMAIL_FROM,
              to: [mail.to],
              subject: mail.subject,
              text: mail.text,
            }),
            signal: AbortSignal.timeout(15_000),
          });
          if (!res.ok) throw new Error(`resend responded ${res.status}`);
          return true;
        }
        default:
          this.log.warn(`EMAIL_PROVIDER=console: not sending "${mail.subject}" to ${mail.to}`);
          return false;
      }
    } catch (e) {
      this.log.error(`send failed to ${mail.to}: ${(e as Error).message}`);
      return false;
    }
  }
}
