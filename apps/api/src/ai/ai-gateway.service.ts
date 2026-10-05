import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { DbService } from '../db/db.service';
import {
  ADAPTERS,
  assertPublicHost,
  MODEL_LISTERS,
  ProviderError,
  type CompletionRequest,
  type CompletionResult,
  type FetchLike,
  type ModelInfo,
  type ProviderKind,
  type Target,
} from './providers';
import { SettingsCrypto } from './settings-crypto';

export const FETCH = Symbol('FETCH');

interface Resolved extends Target {
  name: string;
}

/**
 * The only code that ever sees a provider key, and only on the server. Routes calls to whichever
 * model the ADMIN made active. AISEC-01: keys are decrypted per call, never cached, logged or returned.
 */
@Injectable()
export class AiGateway {
  private readonly log = new Logger('ai-gateway');
  fetcher: FetchLike = fetch;
  /** Refuses non-public addresses for administrator-supplied base URLs. Replaceable in tests. */
  hostCheck: (url: string) => Promise<void> = assertPublicHost;

  constructor(
    private readonly db: DbService,
    private readonly crypto: SettingsCrypto,
  ) {}

  /** The active model, or null when the administrator has not chosen one. */
  async active(): Promise<{ modelRowId: string; provider: string; model: string } | null> {
    const { rows } = await this.db.query<{ modelRowId: string; provider: string; model: string }>(
      `SELECT m.id AS "modelRowId", c.name AS provider, m.model_id AS model
         FROM ai_setting s JOIN ai_model m ON m.id = s.active_model
         JOIN ai_connection c ON c.id = m.connection_id`,
    );
    return rows[0] ?? null;
  }

  /** Uses the active model, or the given model (by its row id) when testing one specifically. */
  async complete(req: CompletionRequest, modelRowId?: string): Promise<CompletionResult> {
    const target = await this.resolve(modelRowId ?? (await this.requireActive()));
    await this.checkHost(target);
    try {
      return await this.attempt(target, req);
    } catch (e) {
      // Some newer models refuse `temperature`: retry once without it before giving up.
      if (e instanceof ProviderError && e.status === 400 && !req.omitTemperature) {
        try {
          return await this.attempt(target, { ...req, omitTemperature: true });
        } catch (e2) {
          throw this.wrap(e2, target.name);
        }
      }
      throw this.wrap(e, target.name);
    }
  }

  /** Models the stored key of a connection can use. */
  async listModels(connectionId: string): Promise<ModelInfo[]> {
    const t = await this.connection(connectionId);
    await this.checkHost(t);
    try {
      return await MODEL_LISTERS[t.kind](this.fetcher, t);
    } catch (e) {
      throw this.wrap(e, t.name);
    }
  }

  private async attempt(t: Resolved, req: CompletionRequest): Promise<CompletionResult> {
    const call = () => ADAPTERS[t.kind](this.fetcher, t, req);
    let text: string;
    try {
      text = await call();
    } catch (e) {
      if (!(e instanceof ProviderError) || !e.retryable) throw e;
      await new Promise((r) => setTimeout(r, 1500));
      text = await call();
    }
    return { text, provider: t.name, model: t.model };
  }

  private async checkHost(t: Resolved | Omit<Resolved, 'model'>) {
    if (t.kind !== 'openai_compatible') return;
    try {
      await this.hostCheck(t.baseUrl!);
    } catch (e) {
      throw this.wrap(new ProviderError((e as Error).message, false), t.name);
    }
  }

  private wrap(e: unknown, name: string): Error {
    // Message only; the provider's body and our request are never logged.
    const msg = e instanceof Error ? e.message : 'unknown error';
    this.log.warn(`${name} call failed: ${msg}`);
    return new ProviderError(
      `${name}: ${msg}`,
      false,
      e instanceof ProviderError ? e.status : undefined,
    );
  }

  private async requireActive(): Promise<string> {
    const a = await this.active();
    if (!a) {
      throw new ServiceUnavailableException(
        'No AI model is active. An administrator must add a connection, choose a model and make it active.',
      );
    }
    return a.modelRowId;
  }

  private async connection(connectionId: string): Promise<Omit<Resolved, 'model'>> {
    const { rows } = await this.db.query<{
      name: string;
      kind: ProviderKind;
      base_url: string | null;
      key_ciphertext: string;
      key_aad: string;
    }>(`SELECT name, kind, base_url, key_ciphertext, key_aad FROM ai_connection WHERE id = $1`, [
      connectionId,
    ]);
    const r = rows[0];
    if (!r) throw new ServiceUnavailableException('Unknown AI connection');
    return {
      name: r.name,
      kind: r.kind,
      baseUrl: r.base_url,
      key: this.crypto.decrypt(r.key_ciphertext, r.key_aad),
    };
  }

  private async resolve(modelRowId: string): Promise<Resolved> {
    const { rows } = await this.db.query<{ connection_id: string; model_id: string }>(
      `SELECT connection_id, model_id FROM ai_model WHERE id = $1`,
      [modelRowId],
    );
    const m = rows[0];
    if (!m) throw new ServiceUnavailableException('Unknown AI model');
    return { ...(await this.connection(m.connection_id)), model: m.model_id };
  }
}
