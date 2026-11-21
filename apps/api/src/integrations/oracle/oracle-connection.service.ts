import { Injectable } from '@nestjs/common';
import { SettingsCrypto } from '../../ai/settings-crypto';
import { DbService, type Queryable } from '../../db/db.service';
import { SourceError } from '../import-source';
import { oracleOrigin } from './oracle-address';
import { OracleHcmClient, type OracleTarget } from './oracle-hcm.client';

/** The Advanced settings; a missing key reads as its default (plan 15.3 note 16). */
export interface OracleSettings {
  linkPolicy: 'open' | 'lead_approval';
  requireEuAi: boolean;
  goneInSource: 'flag' | 'erase';
  /** Attachment categories that count as a CV (a site setting: to confirm with the Oracle team). */
  categories: string[];
  clientId?: string;
  scope?: string;
}
export const DEFAULT_SETTINGS: OracleSettings = {
  linkPolicy: 'open',
  requireEuAi: true,
  goneInSource: 'flag',
  categories: ['Resume', 'CV', 'Curriculum Vitae'],
};

export interface ConnectionRow {
  id: string;
  base_url: string;
  token_url: string | null;
  auth_mode: 'basic' | 'oauth_client_credentials' | 'oauth_jwt_assertion';
  principal_name: string;
  settings: Partial<OracleSettings>;
  secret_ciphertext: string | null;
  secret_hint: string | null;
  secret_set_at: Date | null;
  secret_expires_on: string | null;
  client_secret_ciphertext: string | null;
  notice_attested_by: string | null;
  notice_attested_at: Date | null;
  notice_version: string | null;
  notice_effective_from: string | null;
  enabled: boolean;
  enabled_at: Date | null;
  auth_failed_at: Date | null;
  last_test_at: Date | null;
  last_test_code: string | null;
  updated_at: Date;
}

/** Refused before anything is sent: the sign-in circuit is open (S3-INT-08 (2)). */
export class AuthCircuitOpen extends Error {
  constructor() {
    super('oracle sign-in circuit open');
  }
}

export const aadFor = (id: string, what: 'password' | 'client_secret' = 'password') =>
  `oracle:${id}:${what}`;

/**
 * Stage 3, S3-INT-08 (plan 6, 15.2): the one stored connection and its sign-in. The password is
 * decrypted for each call, so a replaced password is used at once with no restart. One auth circuit
 * covers lookup, link, run and test: a 401 from the saved host sets `auth_failed_at` and every
 * later call is refused with 0 requests until Activate or Replace password succeeds. While the saved
 * credentials have never been seen to work, calls go one at a time, so two first calls with a wrong
 * password send one request (Basic never retries a 401).
 */
@Injectable()
export class OracleConnectionService {
  private readonly verified = new Set<string>();
  private readonly firstCall = new Map<string, Promise<unknown>>();
  private readonly tokens = new Map<string, { value: string; until: number } | Promise<string>>();

  constructor(
    private readonly db: DbService,
    private readonly crypto: SettingsCrypto,
    readonly client: OracleHcmClient,
  ) {}

  async row(q: Queryable = this.db): Promise<ConnectionRow | null> {
    return (
      (
        await q.query<ConnectionRow>(
          `SELECT *, secret_expires_on::text AS secret_expires_on, notice_effective_from::text AS notice_effective_from
             FROM integration_connection WHERE system = 'oracle_hcm'`,
        )
      ).rows[0] ?? null
    );
  }

  settings(row: Pick<ConnectionRow, 'settings'> | null): OracleSettings {
    return { ...DEFAULT_SETTINGS, ...(row?.settings ?? {}) };
  }

  forget(id: string) {
    this.verified.delete(id);
    this.tokens.delete(id);
  }

  /**
   * The request target for a saved connection. `override` holds a new password (or the whole new
   * values of a first Activate) kept in memory only; then the circuit is neither checked nor opened.
   */
  target(
    row: ConnectionRow,
    override?: { origin: string; user: string; password: string },
    runId?: string,
  ): OracleTarget {
    const origin = override?.origin ?? oracleOrigin(row.base_url);
    if (!origin) throw new SourceError('unavailable');
    const basic = (user: string, pw: string) =>
      `Basic ${Buffer.from(`${user}:${pw}`, 'utf8').toString('base64')}`;
    return {
      connectionId: row.id,
      origin,
      runId,
      noCircuit: Boolean(override),
      authorization: async () => {
        if (override) return basic(override.user, override.password);
        if (row.auth_mode === 'basic') {
          if (!row.secret_ciphertext) throw new SourceError('auth');
          return basic(
            row.principal_name,
            this.crypto.decrypt(row.secret_ciphertext, aadFor(row.id)),
          );
        }
        return `Bearer ${await this.token(row)}`;
      },
      onAuthRefused: async () => {
        this.verified.delete(row.id);
        await this.db.query(
          `UPDATE integration_connection SET auth_failed_at = now() WHERE id = $1`,
          [row.id],
        );
      },
    };
  }

  /** OAuth client credentials (S3-INT-08 (7)): one token call for many callers, reused until 60 s before expiry. */
  private async token(row: ConnectionRow): Promise<string> {
    const cached = this.tokens.get(row.id);
    if (cached && !(cached instanceof Promise) && cached.until > Date.now()) return cached.value;
    if (cached instanceof Promise) return cached;
    const p = (async () => {
      if (row.auth_mode !== 'oauth_client_credentials') throw new SourceError('auth'); // JWT: after the probe
      const tokenOrigin = row.token_url ? oracleOrigin(row.token_url) : null;
      if (!tokenOrigin || !row.client_secret_ciphertext) throw new SourceError('auth');
      const s = this.settings(row);
      const secret = this.crypto.decrypt(
        row.client_secret_ciphertext,
        aadFor(row.id, 'client_secret'),
      );
      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        ...(s.scope ? { scope: s.scope } : {}),
      });
      const res = await this.client.fetcher(new URL(row.token_url!).toString(), {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: `Basic ${Buffer.from(`${s.clientId ?? ''}:${secret}`).toString('base64')}`,
        },
        body: body.toString(),
      });
      if (res.status === 401 || res.status === 400) {
        await this.db.query(
          `UPDATE integration_connection SET auth_failed_at = now() WHERE id = $1`,
          [row.id],
        );
        throw new SourceError('auth');
      }
      if (!res.ok) throw new SourceError('unavailable');
      const j = (await res.json()) as { access_token?: string; expires_in?: number };
      if (!j.access_token) throw new SourceError('auth');
      this.tokens.set(row.id, {
        value: j.access_token,
        until: Date.now() + Math.max(0, (j.expires_in ?? 3600) - 60) * 1000,
      });
      return j.access_token;
    })();
    this.tokens.set(row.id, p);
    try {
      return await p;
    } catch (e) {
      this.tokens.delete(row.id);
      throw e;
    }
  }

  /**
   * Run one Oracle call for the saved connection: refused at once while the circuit is open or the
   * connection is off; one at a time until the saved sign-in has been seen to work.
   */
  async call<T>(
    fn: (t: OracleTarget, row: ConnectionRow) => Promise<T>,
    runId?: string,
  ): Promise<T> {
    const first = await this.row();
    if (!first || !first.enabled) throw new SourceError('auth');
    if (first.auth_failed_at) throw new AuthCircuitOpen();
    if (this.verified.has(first.id)) return fn(this.target(first, undefined, runId), first);
    // Queue behind earlier unverified calls. No await between reading the queue and joining it, so
    // two calls arriving together cannot both go first.
    const prior = this.firstCall.get(first.id) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    this.firstCall.set(
      first.id,
      prior.then(() => mine),
    );
    await prior;
    try {
      // Read again: the call before may have opened the circuit, or proved the sign-in.
      const row = await this.row();
      if (!row || !row.enabled) throw new SourceError('auth');
      if (row.auth_failed_at) throw new AuthCircuitOpen();
      const out = await fn(this.target(row, undefined, runId), row);
      this.verified.add(row.id);
      return out;
    } finally {
      release();
    }
  }
}
