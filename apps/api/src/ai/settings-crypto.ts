import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ENV, type Env } from '../config/env';

/** AES-256-GCM. The provider name is bound as AAD so a ciphertext cannot be moved between rows. */
@Injectable()
export class SettingsCrypto {
  constructor(@Inject(ENV) private readonly env: Env) {}

  private key(): Buffer {
    if (!this.env.SETTINGS_ENCRYPTION_KEY) {
      throw new ServiceUnavailableException(
        'SETTINGS_ENCRYPTION_KEY is not configured; provider keys cannot be stored',
      );
    }
    return Buffer.from(this.env.SETTINGS_ENCRYPTION_KEY, 'base64');
  }

  encrypt(plaintext: string, aad: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key(), iv);
    c.setAAD(Buffer.from(aad));
    const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
  }

  decrypt(blob: string, aad: string): string {
    const raw = Buffer.from(blob, 'base64');
    const d = createDecipheriv('aes-256-gcm', this.key(), raw.subarray(0, 12));
    d.setAAD(Buffer.from(aad));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  }
}
