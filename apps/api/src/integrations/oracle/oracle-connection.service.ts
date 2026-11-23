import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { SettingsCrypto } from '../../ai/settings-crypto';
import { DbService, type Queryable } from '../../db/db.service';
import { SourceError } from '../import-source';
import { oracleOrigin } from './oracle-address';
import { type DownloadRoute, OracleHcmClient, type OracleTarget } from './oracle-hcm.client';

/** The Advanced settings; a missing key reads as its default (plan 15.3 note 16). */
export interface OracleSettings {
  linkPolicy: 'open' | 'lead_approval';
  requireEuAi: boolean;
  goneInSource: 'flag' | 'erase';
  /** Attachment categories that count as a CV (a site setting: to confirm with the Oracle team). */
  categories: string[];
  clientId?: string;
  scope?: string;
  /** How a file is read (gap fix); `enclosure` is Oracle's documented FileContents download. */
  downloadRoute: DownloadRoute;
  /** Gap fix: when an application has no CV file, look at the candidate profile (off by default). */
  profileFallback: boolean;
  /** OAuth JWT assertion: the certificate alias (`kid`) uploaded to the identity domain app. */
  keyId?: string;
}
export const DEFAULT_SETTINGS: OracleSettings = {
  linkPolicy: 'open',
  requireEuAi: true,
  goneInSource: 'flag',
  // Display names and Oracle's resume code; compared without case, spaces, hyphens or underscores.
  categories: ['Resume', 'CV', 'Curriculum Vitae', 'IRC_CANDIDATE_RESUME'],
  downloadRoute: 'enclosure',
  profileFallback: false,
};

/** Category names compared the way Oracle's codes and display names differ: case, spaces, `_`, `-`. */
export const categoryKey = (c: unknown) =>
  String(c ?? '')
    .toLowerCase()
    .replace(/[\s_-]+/g, '');

/** The audience Oracle's identity domain expects in a user or client assertion (documented). */
export const ASSERTION_AUDIENCE = 'https://identity.oraclecloud.com/';

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/** A signed RS256 JWT for Oracle's identity domain (the documented claims, 5 minutes). */
export function signAssertion(
  key: string,
  claims: { sub: string; iss: string; kid?: string },
  now = Math.floor(Date.now() / 1000),
): string {
  const header = { alg: 'RS256', typ: 'JWT', ...(claims.kid ? { kid: claims.kid } : {}) };
  const body = {
    sub: claims.sub,
    iss: claims.iss,
    aud: [ASSERTION_AUDIENCE],
    iat: now,
    nbf: now - 30,
    exp: now + 300,
    jti: randomUUID(),
  };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(body))}`;
  const sig = sign('RSA-SHA256', Buffer.from(input), createPrivateKey(key));
  return `${input}.${b64url(sig)}`;
}

/** True when the text is an RSA private key in PEM (checked before it is stored). */
export function isRsaPrivateKey(pem: string): boolean {
  try {
    return createPrivateKey(pem).asymmetricKeyType === 'rsa';
  } catch {
    return false;
  }
}

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
  /** OAuth JWT assertion: the private key (PEM), encrypted like the password. */
  assertion_key_ciphertext: string | null;
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

export const aadFor = (
  id: string,
  what: 'password' | 'client_secret' | 'assertion_key' = 'password',
) => `oracle:${id}:${what}`;

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
    const origin = override?.origin ?? oracleOrigin(row.base_url, this.client.ownHosts);
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
      if (row.auth_mode !== 'oauth_client_credentials' && row.auth_mode !== 'oauth_jwt_assertion')
        throw new SourceError('auth');
      const tokenOrigin = row.token_url ? oracleOrigin(row.token_url, this.client.ownHosts) : null;
      if (!tokenOrigin) throw new SourceError('auth');
      const s = this.settings(row);
      const secret = row.client_secret_ciphertext
        ? this.crypto.decrypt(row.client_secret_ciphertext, aadFor(row.id, 'client_secret'))
        : null;
      const headers: Record<string, string> = {
        'content-type': 'application/x-www-form-urlencoded',
      };
      let body: URLSearchParams;
      if (row.auth_mode === 'oauth_client_credentials') {
        if (!secret) throw new SourceError('auth');
        headers['authorization'] =
          `Basic ${Buffer.from(`${s.clientId ?? ''}:${secret}`).toString('base64')}`;
        body = new URLSearchParams({
          grant_type: 'client_credentials',
          ...(s.scope ? { scope: s.scope } : {}),
        });
      } else {
        // Gap fix: the JWT user assertion grant (Oracle identity domain, documented claims). The user
        // is the integration account; the client signs in with its secret, or else with a client
        // assertion signed by the same key.
        if (!row.assertion_key_ciphertext || !s.clientId) throw new SourceError('auth');
        const key = this.crypto.decrypt(
          row.assertion_key_ciphertext,
          aadFor(row.id, 'assertion_key'),
        );
        body = new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: signAssertion(key, { sub: row.principal_name, iss: s.clientId, kid: s.keyId }),
          ...(s.scope ? { scope: s.scope } : {}),
        });
        if (secret)
          headers['authorization'] =
            `Basic ${Buffer.from(`${s.clientId}:${secret}`).toString('base64')}`;
        else {
          body.set('client_id', s.clientId);
          body.set(
            'client_assertion_type',
            'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
          );
          body.set(
            'client_assertion',
            signAssertion(key, { sub: s.clientId, iss: s.clientId, kid: s.keyId }),
          );
        }
      }
      const res = await this.client.fetcher(new URL(row.token_url!).toString(), {
        method: 'POST',
        redirect: 'manual',
        headers,
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
