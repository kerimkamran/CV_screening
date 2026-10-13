import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { COMPANIES, isCompany, type CompanyId } from './catalog';
import {
  ADAPTERS,
  listModels,
  ProviderError,
  type CompletionRequest,
  type CompletionResult,
  type FetchLike,
  type ModelInfo,
  type Target,
} from './providers';
import { SettingsCrypto } from './settings-crypto';

export const FETCH = Symbol('FETCH');

/**
 * Circuit breaker (SenAI plan 9 "Fallback" and "Safe mode"): after this many failures in a row within
 * the window, calls to that model stop for a while instead of every question waiting for a timeout.
 * A "Test connection" always goes through and, when it works, closes the breaker.
 */
export const BREAKER = { threshold: 5, windowMs: 120_000, openMs: 60_000 };

type Connection = Omit<Target, 'model'>;

/**
 * The only code that ever sees a provider key, and only on the server. Routes calls to whichever
 * model the ADMIN made active. AISEC-01: keys are decrypted per call, never cached, logged or returned.
 */
@Injectable()
export class AiGateway {
  private readonly log = new Logger('ai-gateway');
  fetcher: FetchLike = fetch;
  private readonly breaker = new Map<string, { n: number; first: number; openUntil: number }>();

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
  async complete(
    req: CompletionRequest,
    modelRowId?: string,
    opts: { probe?: boolean } = {},
  ): Promise<CompletionResult> {
    const target = await this.resolve(modelRowId ?? (await this.requireActive()));
    const name = COMPANIES[target.company].name;
    const key = `${target.company}:${target.model}`;
    if (!opts.probe && this.isOpen(key))
      throw new ProviderError(`${name}: paused for a minute after repeated failures`, false, 503);
    try {
      const r = await this.attemptWithFallback(target, req, name);
      this.breaker.delete(key);
      return r;
    } catch (e) {
      this.noteFailure(key, e);
      throw e;
    }
  }

  private async attemptWithFallback(
    target: Target,
    req: CompletionRequest,
    name: string,
  ): Promise<CompletionResult> {
    try {
      return await this.attempt(target, req);
    } catch (e) {
      // Some newer models refuse `temperature`: retry once without it before giving up.
      if (e instanceof ProviderError && e.status === 400 && !req.omitTemperature) {
        try {
          return await this.attempt(target, { ...req, omitTemperature: true });
        } catch (e2) {
          throw this.wrap(e2, name);
        }
      }
      throw this.wrap(e, name);
    }
  }

  private isOpen(key: string): boolean {
    const b = this.breaker.get(key);
    return !!b && b.openUntil > Date.now();
  }

  /** Only a provider that is down or overloaded counts; a refused key or request is a setting, not an outage. */
  private noteFailure(key: string, e: unknown): void {
    const status = e instanceof ProviderError ? e.status : undefined;
    if (status !== undefined && status !== 429 && status < 500) return;
    const now = Date.now();
    const b = this.breaker.get(key);
    const cur = b && now - b.first < BREAKER.windowMs ? b : { n: 0, first: now, openUntil: 0 };
    cur.n += 1;
    if (cur.n >= BREAKER.threshold) cur.openUntil = now + BREAKER.openMs;
    this.breaker.set(key, cur);
  }

  /** Forget past failures (used when the provider is known to be back, and by tests). */
  resetBreaker(): void {
    this.breaker.clear();
  }

  /** For the admin screen: is any model paused right now, and until when. */
  breakerState(): { open: boolean; until: string | null } {
    let until = 0;
    for (const b of this.breaker.values()) until = Math.max(until, b.openUntil);
    return until > Date.now()
      ? { open: true, until: new Date(until).toISOString() }
      : { open: false, until: null };
  }

  /** Models the stored key of a connection can use. */
  async listModels(connectionId: string): Promise<ModelInfo[]> {
    return this.discover(await this.connection(connectionId));
  }

  /** Same, for a key that is not stored yet (used once, never kept). */
  async discover(c: Connection): Promise<ModelInfo[]> {
    try {
      return await listModels(this.fetcher, c);
    } catch (e) {
      throw this.wrap(e, COMPANIES[c.company].name);
    }
  }

  private async attempt(t: Target, req: CompletionRequest): Promise<CompletionResult> {
    const adapter = ADAPTERS[COMPANIES[t.company].protocol];
    const call = () => adapter(this.fetcher, t, req);
    let text: string;
    try {
      text = await call();
    } catch (e) {
      if (!(e instanceof ProviderError) || !e.retryable) throw e;
      await new Promise((r) => setTimeout(r, 1500));
      text = await call();
    }
    return { text, provider: COMPANIES[t.company].name, model: t.model };
  }

  private wrap(e: unknown, name: string): Error {
    // Message only; the provider's body and our request are never logged.
    const msg = e instanceof Error ? e.message : 'unknown error';
    this.log.warn(`${name} call failed: ${msg}`);
    return new ProviderError(
      `${name}: ${msg}`,
      false,
      e instanceof ProviderError ? e.status : undefined,
      e instanceof ProviderError ? e.detail : undefined,
    );
  }

  private async requireActive(): Promise<string> {
    const a = await this.active();
    if (!a) {
      throw new ServiceUnavailableException(
        'No AI model is active. An administrator must add a company, choose a model and make it active.',
      );
    }
    return a.modelRowId;
  }

  private async connection(connectionId: string): Promise<Connection> {
    const { rows } = await this.db.query<{
      company: string;
      settings: Record<string, string>;
      key_ciphertext: string;
      key_aad: string;
    }>(`SELECT company, settings, key_ciphertext, key_aad FROM ai_connection WHERE id = $1`, [
      connectionId,
    ]);
    const r = rows[0];
    if (!r || !isCompany(r.company)) throw new ServiceUnavailableException('Unknown AI company');
    return {
      company: r.company as CompanyId,
      settings: r.settings ?? {},
      key: this.crypto.decrypt(r.key_ciphertext, r.key_aad),
    };
  }

  private async resolve(modelRowId: string): Promise<Target> {
    const { rows } = await this.db.query<{ connection_id: string; model_id: string }>(
      `SELECT connection_id, model_id FROM ai_model WHERE id = $1`,
      [modelRowId],
    );
    const m = rows[0];
    if (!m) throw new ServiceUnavailableException('Unknown AI model');
    return { ...(await this.connection(m.connection_id)), model: m.model_id };
  }
}
