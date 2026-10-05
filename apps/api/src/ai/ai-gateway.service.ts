import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { DbService } from '../db/db.service';
import {
  ADAPTERS,
  ProviderError,
  type CompletionRequest,
  type CompletionResult,
  type FetchLike,
  type ProviderKind,
} from './providers';
import { SettingsCrypto } from './settings-crypto';

export const FETCH = Symbol('FETCH');

/**
 * The only code that ever sees a provider key, and only on the server. Routes calls to whichever
 * provider the ADMIN made active. AISEC-01: keys are decrypted per call, never cached, logged or returned.
 */
@Injectable()
export class AiGateway {
  private readonly log = new Logger('ai-gateway');
  fetcher: FetchLike = fetch;

  constructor(
    private readonly db: DbService,
    private readonly crypto: SettingsCrypto,
  ) {}

  async active(): Promise<{ provider: ProviderKind; model: string } | null> {
    const { rows } = await this.db.query<{ provider: ProviderKind; model: string }>(
      `SELECT c.provider, c.model FROM ai_setting s
         JOIN ai_provider_config c ON c.provider = s.active_provider
        WHERE c.key_ciphertext IS NOT NULL`,
    );
    return rows[0] ?? null;
  }

  /** Uses the active provider, or `provider` when testing a specific one. */
  async complete(req: CompletionRequest, provider?: ProviderKind): Promise<CompletionResult> {
    const target = provider ? await this.config(provider) : await this.activeConfig();
    const key = this.crypto.decrypt(target.key_ciphertext, target.provider);
    const call = () => ADAPTERS[target.provider](this.fetcher, key, target.model, req);
    let text: string;
    try {
      text = await call();
    } catch (e) {
      if (!(e instanceof ProviderError) || !e.retryable) throw this.wrap(e, target.provider);
      await new Promise((r) => setTimeout(r, 1500));
      try {
        text = await call();
      } catch (e2) {
        throw this.wrap(e2, target.provider);
      }
    }
    return { text, provider: target.provider, model: target.model };
  }

  private wrap(e: unknown, provider: string): Error {
    // Message only; the provider's body and our request are never logged.
    const msg = e instanceof Error ? e.message : 'unknown error';
    this.log.warn(`${provider} call failed: ${msg}`);
    return new ProviderError(`${provider}: ${msg}`, false);
  }

  private async activeConfig() {
    const a = await this.active();
    if (!a) {
      throw new ServiceUnavailableException(
        'No AI provider is active. An administrator must add a key and select a provider.',
      );
    }
    return this.config(a.provider);
  }

  private async config(provider: ProviderKind) {
    const { rows } = await this.db.query<{
      provider: ProviderKind;
      model: string;
      key_ciphertext: string | null;
    }>(`SELECT provider, model, key_ciphertext FROM ai_provider_config WHERE provider = $1`, [
      provider,
    ]);
    const r = rows[0];
    if (!r?.key_ciphertext) throw new ServiceUnavailableException(`No key stored for ${provider}`);
    return { provider: r.provider, model: r.model, key_ciphertext: r.key_ciphertext };
  }
}
