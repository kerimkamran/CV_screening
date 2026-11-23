import { promises as dns } from 'node:dns';
import https from 'node:https';
import { Readable } from 'node:stream';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { DbService } from '../../db/db.service';
import { guardedLookup } from '../../pipeline/link-reader';
import { SourceError } from '../import-source';
import { isAllowedAddress, ownHosts, resolvesPublic, type Lookup } from './oracle-address';

/**
 * Stage 3, S3-INT-07 (plan 5.4, 15.2, 15.3 notes 2-4): the Oracle REST client.
 *
 * Transport rules: only the saved origin is ever called with credentials (`Authorization` is never
 * sent to another host); every connection's address is checked to be public (`lookup`, replaceable
 * in tests); redirects are followed by hand, same origin only, at most 3 hops; deadlines (15 s for
 * metadata; downloads 30 s to the first byte, 20 s idle, 120 s in total); caps (5 MB of JSON, 10 MB
 * per file, aborted as soon as passed); `Retry-After` and jittered backoff, 2 tries, then
 * "unavailable"; at most 2 calls in flight and 4 started per second; a daily call budget counted in
 * the database; every data call asks for an explicit field list; error messages never carry a body.
 *
 * `fetcher` and `lookup` are the seams a spec or the gate launcher replaces (as `AiGateway.fetcher`).
 */
export const ORACLE_BASE_PATH = '/hcmRestApi/resources/11.13.18.05';
export const REST_FRAMEWORK_VERSION = '4';

/** The only fields Parallax asks for (oracle-team-questions.md, section 1). No name, e-mail, phone or address. */
export const FIELDS = {
  requisition: ['RequisitionId', 'RequisitionNumber', 'Title', 'StateName'],
  application: [
    'JobApplicationId',
    'CandidatePersonId',
    'ConfirmedFlag',
    'DisqualifiedFlag',
    'InternalFlag',
    'StateName',
    'PhaseName',
    'JobApplicationDate',
    'LastUpdateDate',
  ],
  attachment: [
    'AttachedDocumentId',
    'CategoryName',
    'DatatypeCode',
    'FileName',
    'UploadedFileLength',
    'DmDocumentId',
    'LastUpdateDate',
  ],
  download: ['FileUrl', 'FileName'],
  contents: ['FileContents', 'FileName'],
  /** The candidate profile, found by the person ID of an application (gap fix: profile-only CVs). */
  candidate: ['CandidateNumber'],
} as const;

/**
 * How a file is read (gap fix). `enclosure`: the documented FileContents download of the attachment
 * (`…/child/attachments/{key}/enclosure/FileContents`), the default. `inline`: the same attachment
 * asked for its `FileContents` field (base64 in JSON). `fileUrl`: the attachment's `FileUrl` link into
 * Oracle's content repository. Every route starts from the attachment's own `self` link, because
 * Oracle addresses one attachment by a hash key that a client must not build.
 */
export const DOWNLOAD_ROUTES = ['enclosure', 'inline', 'fileUrl'] as const;
export type DownloadRoute = (typeof DOWNLOAD_ROUTES)[number];

/** Whose attachments: a job application, or (gap fix) the candidate profile behind it. */
export type AttachmentOwner =
  { kind: 'application'; id: string } | { kind: 'candidate'; id: string };

const ownerPath = (o: AttachmentOwner) =>
  `${o.kind === 'application' ? 'recruitingJobApplications' : 'recruitingCandidates'}/${encodeURIComponent(o.id)}/child/attachments`;
export const ALLOWED_FIELDS: ReadonlySet<string> = new Set(Object.values(FIELDS).flat());

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** What the client needs of a stored connection: the origin and a way to sign a request. */
export interface OracleTarget {
  connectionId: string;
  origin: string;
  /** The Authorization header value, read and decrypted for this call. */
  authorization: () => Promise<string>;
  /** Called when the API host refuses the sign-in (401): opens the circuit unless the call says not to. */
  onAuthRefused?: () => Promise<void>;
  /** The test of a new password must not open the circuit (S3-INT-08 (4)). */
  noCircuit?: boolean;
  /** For log lines: the run this call belongs to. */
  runId?: string;
}

/** The caller's own signal stopped the call (shutdown, or a cancel): not an Oracle failure. */
export class CallAborted extends Error {
  constructor(cause?: unknown) {
    super(`oracle call ${'aborted'}`, { cause });
  }
}

/** A refusal that is not a source failure the runner handles: the address or the redirect. */
export class OracleClientError extends Error {
  constructor(
    readonly code:
      | 'not_oracle_address'
      | 'not_public'
      | 'foreign_redirect'
      | 'bad_answer'
      | 'too_many_redirects',
  ) {
    super(`oracle client: ${code}`);
  }
}

const MB = 1024 * 1024;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const today = () => new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10); // Asia/Baku, UTC+4

/**
 * Builds the query of a data call; throws before anything is sent if a field is not on the list.
 * `links` keeps Oracle's link relations in the answer (no `onlyData`): the attachment list needs
 * them, because one attachment is addressed by its own `self` link.
 */
export function dataQuery(
  params: Record<string, string>,
  fields: readonly string[],
  opts: { links?: boolean } = {},
): URLSearchParams {
  if (!fields.length) throw new Error('every data call names its fields');
  for (const f of fields) if (!ALLOWED_FIELDS.has(f)) throw new Error(`field not allowed: ${f}`);
  const q = new URLSearchParams(params);
  q.set('fields', fields.join(','));
  if (!opts.links) q.set('onlyData', 'true');
  return q;
}

/** One link of an Oracle item, when it stays on the saved origin and under the REST path. */
export function itemLink(
  item: Record<string, unknown>,
  origin: string,
  want: { rel: string; name?: string },
): URL | null {
  const links = Array.isArray(item['links']) ? (item['links'] as Record<string, unknown>[]) : [];
  const l = links.find(
    (x) => x?.['rel'] === want.rel && (want.name === undefined || x?.['name'] === want.name),
  );
  if (!l || typeof l['href'] !== 'string') return null;
  try {
    const u = new URL(l['href'], origin);
    if (u.origin !== origin || !u.pathname.startsWith(`${ORACLE_BASE_PATH}/`)) return null;
    u.search = '';
    return u;
  } catch {
    return null;
  }
}

/** The default fetcher: node:https with the guarded lookup (public addresses only), no agent reuse. */
export const httpsFetcher: Fetcher = (url, init) =>
  new Promise<Response>((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        protocol: 'https:',
        hostname: u.hostname,
        port: u.port || undefined,
        path: `${u.pathname}${u.search}`,
        method: init.method ?? 'GET',
        headers: init.headers as Record<string, string>,
        lookup: guardedLookup(false) as never,
        agent: false,
        signal: init.signal ?? undefined,
      },
      (res) => {
        const headers = new Headers();
        for (const [k, v] of Object.entries(res.headers))
          if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
        const status = res.statusCode ?? 0;
        const body =
          status === 204 || status === 304 ? null : (Readable.toWeb(res) as ReadableStream);
        resolve(new Response(body, { status, headers }));
      },
    );
    req.on('error', reject);
    if (init.body) req.write(init.body as string);
    req.end();
  });

export const dnsLookup: Lookup = async (host) =>
  (await dns.lookup(host, { all: true, verbatim: true })).map((a) => a.address);

interface CallOpts {
  kind: 'meta' | 'file';
  signal?: AbortSignal;
  /** Bytes allowed in the answer (JSON 5 MB, file 10 MB). */
  cap?: number;
  /** A file link: a 401 or 403 does not open the circuit, it asks for a fresh link. */
  fileLink?: boolean;
  /** Tries for an outage (the test call makes one). */
  tries?: number;
  resource: string;
}

export interface Answer {
  status: number;
  headers: Headers;
  body: Buffer;
}

@Injectable()
export class OracleHcmClient {
  private readonly log = new Logger('OracleClient');
  fetcher: Fetcher = httpsFetcher;
  lookup: Lookup = dnsLookup;
  /** Pace: at most `concurrency` in flight and `perSecond` started in one second (code defaults). */
  pace = { concurrency: 2, perSecond: 4 };
  /** The daily call budget (code default; to confirm with the Oracle team, question 13). */
  budgetPerDay = 20_000;
  timeouts = { metaMs: 15_000, firstByteMs: 30_000, idleMs: 20_000, totalMs: 120_000 };
  retry = { tries: 2, baseMs: 1_000 };
  caps = { jsonBytes: 5 * MB, fileBytes: 10 * MB };
  /** The operator's own Oracle host names (`ORACLE_OWN_HOSTS`), allowed besides `*.oraclecloud.com`. */
  readonly ownHosts: ReadonlySet<string>;

  private inFlight = 0;
  private waiters: (() => void)[] = [];
  private starts: number[] = [];

  constructor(
    private readonly db: DbService,
    @Optional() @Inject(ENV) env?: Env,
  ) {
    this.ownHosts = ownHosts(env?.ORACLE_OWN_HOSTS);
  }

  // ------------------------------------------------------------------ pacing and budget

  private async slot(): Promise<() => void> {
    while (this.inFlight >= this.pace.concurrency)
      await new Promise<void>((r) => this.waiters.push(r));
    this.inFlight++;
    for (;;) {
      const now = Date.now();
      this.starts = this.starts.filter((t) => now - t < 1000);
      if (this.starts.length < this.pace.perSecond) break;
      await sleep(1000 - (now - this.starts[0]!) + 1);
    }
    this.starts.push(Date.now());
    return () => {
      this.inFlight--;
      this.waiters.shift()?.();
    };
  }

  /** One request = one unit of the day's budget, counted in the database (holds after a restart). */
  async spend(connectionId: string): Promise<void> {
    const r = await this.db.query(
      `UPDATE integration_connection
          SET calls_used = CASE WHEN budget_day = $2::date THEN calls_used + 1 ELSE 1 END, budget_day = $2::date
        WHERE id = $1 AND (budget_day IS DISTINCT FROM $2::date OR calls_used < $3)`,
      [connectionId, today(), this.budgetPerDay],
    );
    if (!r.rowCount) throw new SourceError('budget');
  }

  async budgetLeft(connectionId: string): Promise<boolean> {
    const r = await this.db.query<{ ok: boolean }>(
      `SELECT (budget_day IS DISTINCT FROM $2::date OR calls_used < $3) AS ok FROM integration_connection WHERE id = $1`,
      [connectionId, today(), this.budgetPerDay],
    );
    return r.rows[0]?.ok ?? true;
  }

  // ------------------------------------------------------------------ one call

  /** GET one URL on the saved origin, signed, with every transport rule applied. */
  async get(t: OracleTarget, url: URL, o: CallOpts): Promise<Answer> {
    if (!isAllowedAddress(t.origin, this.ownHosts) || url.origin !== t.origin)
      throw new OracleClientError('not_oracle_address');
    let last: SourceError | null = null;
    const tries = o.tries ?? this.retry.tries;
    for (let attempt = 0; attempt < tries; attempt++) {
      try {
        return await this.once(t, url, o);
      } catch (e) {
        if (!(e instanceof SourceError) || e.code !== 'unavailable') throw e;
        last = e;
        if (attempt + 1 >= tries) break;
        const wait =
          e.retryAfter !== undefined
            ? e.retryAfter * 1000
            : this.retry.baseMs * (1 + Math.random());
        await sleep(wait);
      }
    }
    throw last ?? new SourceError('unavailable');
  }

  private async once(t: OracleTarget, first: URL, o: CallOpts): Promise<Answer> {
    if (!(await resolvesPublic(first.hostname, this.lookup)))
      throw new OracleClientError('not_public');
    await this.spend(t.connectionId);
    const release = await this.slot();
    const started = Date.now();
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    o.signal?.addEventListener('abort', onAbort, { once: true });
    let status = 0;
    try {
      let url = first;
      for (let hop = 0; ; hop++) {
        const total = setTimeout(
          () => ac.abort(),
          o.kind === 'meta' ? this.timeouts.metaMs : this.timeouts.totalMs,
        );
        const firstByte =
          o.kind === 'file' ? setTimeout(() => ac.abort(), this.timeouts.firstByteMs) : null;
        let res: Response;
        // Signed first, outside the network catch: a refused OAuth sign-in is a refused sign-in
        // (SourceError 'auth'), not an unreachable Oracle.
        let authorization: string;
        try {
          authorization = await t.authorization();
        } catch (e) {
          clearTimeout(total);
          if (firstByte) clearTimeout(firstByte);
          throw e;
        }
        try {
          res = await this.fetcher(url.toString(), {
            method: 'GET',
            redirect: 'manual',
            signal: ac.signal,
            headers: {
              accept: o.kind === 'file' ? '*/*' : 'application/json',
              'REST-Framework-Version': REST_FRAMEWORK_VERSION,
              authorization,
            },
          });
        } catch {
          clearTimeout(total);
          if (firstByte) clearTimeout(firstByte);
          if (o.signal?.aborted) throw new CallAborted();
          throw new SourceError('unavailable');
        } finally {
          if (firstByte) clearTimeout(firstByte);
        }
        status = res.status;
        if (status >= 300 && status < 400) {
          clearTimeout(total);
          await res.body?.cancel().catch(() => undefined);
          const loc = res.headers.get('location');
          if (!loc) throw new OracleClientError('bad_answer');
          const next = new URL(loc, url);
          // Same origin only: another host never receives the Authorization header.
          if (next.origin !== t.origin) throw new OracleClientError('foreign_redirect');
          if (hop >= 2) throw new OracleClientError('too_many_redirects');
          url = next;
          continue;
        }
        try {
          if (status === 401 || (status === 403 && o.fileLink)) {
            await res.body?.cancel().catch(() => undefined);
            if (o.fileLink) throw new SourceError('link_forbidden');
            if (!t.noCircuit) await t.onAuthRefused?.();
            throw new SourceError('auth');
          }
          if (status === 429 || status >= 500) {
            await res.body?.cancel().catch(() => undefined);
            throw new SourceError('unavailable', retryAfter(res.headers.get('retry-after')));
          }
          const cap = o.cap ?? (o.kind === 'file' ? this.caps.fileBytes : this.caps.jsonBytes);
          const body = await this.read(
            res,
            cap,
            o.kind === 'file' ? this.timeouts.idleMs : this.timeouts.metaMs,
            ac,
          );
          return { status, headers: res.headers, body };
        } finally {
          clearTimeout(total);
        }
      }
    } catch (e) {
      if (ac.signal.aborted && !(e instanceof SourceError && e.code === 'too_large')) {
        if (o.signal?.aborted) throw new CallAborted(e);
        throw new SourceError('unavailable');
      }
      throw e;
    } finally {
      o.signal?.removeEventListener('abort', onAbort);
      release();
      // Resource, status, duration and run: never an address, a query or a body.
      this.log.debug(
        `${o.resource} ${status} ${Date.now() - started}ms${t.runId ? ` run ${t.runId}` : ''}`,
      );
    }
  }

  /** Reads the body up to `cap`; aborts the request as soon as it is passed, and when idle too long. */
  private async read(
    res: Response,
    cap: number,
    idleMs: number,
    ac: AbortController,
  ): Promise<Buffer> {
    if (!res.body) return Buffer.alloc(0);
    const reader = res.body.getReader();
    const chunks: Buffer[] = [];
    let n = 0;
    for (;;) {
      let idle: NodeJS.Timeout | undefined;
      const next = await Promise.race([
        reader.read(),
        new Promise<never>((_, rej) => {
          idle = setTimeout(() => {
            ac.abort();
            rej(new SourceError('unavailable'));
          }, idleMs);
        }),
      ]).finally(() => clearTimeout(idle));
      if (next.done) break;
      n += next.value.byteLength;
      if (n > cap) {
        ac.abort();
        await reader.cancel().catch(() => undefined);
        throw new SourceError('too_large');
      }
      chunks.push(Buffer.from(next.value));
    }
    return Buffer.concat(chunks);
  }

  private async json<T>(
    t: OracleTarget,
    path: string | URL,
    q: URLSearchParams,
    resource: string,
    signal?: AbortSignal,
    opts: { cap?: number; tries?: number } = {},
  ): Promise<T> {
    const url =
      path instanceof URL ? new URL(path) : new URL(`${t.origin}${ORACLE_BASE_PATH}/${path}`);
    url.search = q.toString();
    const a = await this.get(t, url, {
      kind: 'meta',
      signal,
      resource,
      cap: opts.cap,
      tries: opts.tries,
    });
    try {
      return JSON.parse(a.body.toString('utf8')) as T;
    } catch {
      throw new OracleClientError('bad_answer');
    }
  }

  // ------------------------------------------------------------------ calls B to F (plan 5.4)

  /** The one test call of Activate and Test again: one requisition row, no retry. */
  async testCall(
    t: OracleTarget,
  ): Promise<'ok' | 'auth_failed' | 'empty_scope' | 'unreachable' | 'not_oracle_address'> {
    try {
      const r = await this.json<{ items?: unknown[] }>(
        t,
        'recruitingJobRequisitions',
        dataQuery({ limit: '1' }, FIELDS.requisition),
        'recruitingJobRequisitions',
        undefined,
        { tries: 1 },
      );
      if (!Array.isArray(r.items)) return 'unreachable';
      if (r.items.length && !hasFields(r.items[0], ['RequisitionId', 'RequisitionNumber']))
        return 'unreachable';
      return r.items.length ? 'ok' : 'empty_scope';
    } catch (e) {
      if (e instanceof SourceError && e.code === 'auth') return 'auth_failed';
      if (e instanceof OracleClientError && e.code === 'not_oracle_address')
        return 'not_oracle_address';
      if (e instanceof OracleClientError && e.code === 'not_public') return 'not_oracle_address';
      return 'unreachable';
    }
  }

  /** Call B: a requisition by its number, or null. A 403 reads as "not visible" (no access). */
  async findRequisition(t: OracleTarget, number: string, signal?: AbortSignal) {
    let r: { items?: Record<string, unknown>[] };
    try {
      r = await this.json(
        t,
        'recruitingJobRequisitions',
        dataQuery(
          { finder: `findByRequisitionNumber;RequisitionNumber=${number}`, limit: '1' },
          FIELDS.requisition,
        ),
        'recruitingJobRequisitions',
        signal,
      );
    } catch (e) {
      if (e instanceof OracleClientError) throw new SourceError('unavailable');
      throw e;
    }
    const it = r.items?.[0];
    if (!it) return null;
    if (!hasFields(it, ['RequisitionId', 'RequisitionNumber']))
      throw new SourceError('schema_changed');
    return {
      id: String(it['RequisitionId']),
      number: String(it['RequisitionNumber']),
      title: typeof it['Title'] === 'string' ? it['Title'] : '',
      state: typeof it['StateName'] === 'string' ? it['StateName'] : '',
    };
  }

  /** Call C: Oracle's estimated count of applications (the number the recruiter confirms). */
  async estimate(t: OracleTarget, requisitionId: string, signal?: AbortSignal): Promise<number> {
    const r = await this.json<{ totalResults?: number }>(
      t,
      'recruitingJobApplications',
      dataQuery({ q: `RequisitionId=${requisitionId}`, limit: '1', totalResults: 'true' }, [
        'JobApplicationId',
      ]),
      'recruitingJobApplications',
      signal,
    );
    return Math.max(0, Number(r.totalResults ?? 0) || 0);
  }

  /** Call D: one page of applications in ID order after the cursor (the `and` form; never `;`). */
  async listApplications(
    t: OracleTarget,
    requisitionId: string,
    cursor: string | null,
    signal?: AbortSignal,
  ) {
    const q = cursor
      ? `RequisitionId=${requisitionId} and JobApplicationId > ${cursor}`
      : `RequisitionId=${requisitionId}`;
    const r = await this.json<{ items?: Record<string, unknown>[]; hasMore?: boolean }>(
      t,
      'recruitingJobApplications',
      dataQuery({ q, orderBy: 'JobApplicationId:asc', limit: '100' }, FIELDS.application),
      'recruitingJobApplications',
      signal,
    );
    if (!Array.isArray(r.items)) throw new SourceError('schema_changed');
    for (const it of r.items)
      if (!hasFields(it, ['JobApplicationId', 'CandidatePersonId']))
        throw new SourceError('schema_changed');
    return { items: r.items, hasMore: Boolean(r.hasMore) };
  }

  /** Call E: the attachments of one application, with each item's links (see `locate`). */
  async attachments(t: OracleTarget, applicationId: string, signal?: AbortSignal) {
    return this.attachmentsOf(t, { kind: 'application', id: applicationId }, signal);
  }

  /** The attachments of an application or of a candidate profile (gap fix), links kept. */
  async attachmentsOf(t: OracleTarget, owner: AttachmentOwner, signal?: AbortSignal) {
    const r = await this.json<{ items?: Record<string, unknown>[] }>(
      t,
      ownerPath(owner),
      dataQuery({ limit: '100' }, FIELDS.attachment, { links: true }),
      'attachments',
      signal,
    );
    if (!Array.isArray(r.items)) throw new SourceError('schema_changed');
    for (const it of r.items)
      if (!hasFields(it, ['AttachedDocumentId', 'FileName']))
        throw new SourceError('schema_changed');
    return r.items;
  }

  /**
   * Gap fix (CV only on the candidate profile): the candidate number behind an application's person
   * ID, through the documented `findByPersonId` finder; null when Oracle shows no candidate.
   */
  async findCandidate(t: OracleTarget, personId: string, signal?: AbortSignal) {
    const r = await this.json<{ items?: Record<string, unknown>[] }>(
      t,
      'recruitingCandidates',
      dataQuery({ finder: `findByPersonId;personId=${personId}`, limit: '1' }, FIELDS.candidate),
      'recruitingCandidates',
      signal,
    );
    const it = r.items?.[0];
    if (!it) return null;
    if (!hasFields(it, ['CandidateNumber'])) throw new SourceError('schema_changed');
    return String(it['CandidateNumber']);
  }

  /**
   * The attachment's own address and its file name, read fresh from the list: Oracle addresses one
   * attachment by a hash key the client must not build, so its `self` link is used. An attachment
   * no longer listed reads as a refused link (the runner tries once more, then skips the file).
   */
  private async locate(
    t: OracleTarget,
    owner: AttachmentOwner,
    attachmentId: string,
    signal?: AbortSignal,
  ) {
    const items = await this.attachmentsOf(t, owner, signal);
    const it = items.find((a) => String(a['AttachedDocumentId']) === attachmentId);
    if (!it) throw new SourceError('link_forbidden');
    const self =
      itemLink(it, t.origin, { rel: 'self' }) ??
      new URL(
        `${t.origin}${ORACLE_BASE_PATH}/${ownerPath(owner)}/${encodeURIComponent(attachmentId)}`,
      );
    const enclosure = itemLink(it, t.origin, { rel: 'enclosure', name: 'FileContents' });
    return { self, enclosure, fileName: String(it['FileName'] ?? '') };
  }

  /** Call F: the file, by the route the admin chose (default: the FileContents download). */
  async downloadFile(
    t: OracleTarget,
    owner: AttachmentOwner | string,
    attachmentId: string,
    signal?: AbortSignal,
    route: DownloadRoute = 'enclosure',
  ): Promise<{ bytes: Buffer; fileName: string }> {
    const who: AttachmentOwner =
      typeof owner === 'string' ? { kind: 'application', id: owner } : owner;
    const item = await this.locate(t, who, attachmentId, signal);
    if (route === 'enclosure') {
      const url = item.enclosure ?? new URL(`${item.self.toString()}/enclosure/FileContents`);
      // A 401 or 403 here, right after the list answered, is a refused file, not a refused sign-in.
      const a = await this.get(t, url, { kind: 'file', signal, fileLink: true, resource: 'file' });
      return { bytes: a.body, fileName: item.fileName };
    }
    if (route === 'inline') {
      const r = await this.json<{ FileContents?: string; FileName?: string }>(
        t,
        item.self,
        dataQuery({}, FIELDS.contents),
        'attachment',
        signal,
        { cap: Math.ceil(this.caps.fileBytes * 1.4) },
      );
      if (typeof r.FileContents !== 'string') throw new SourceError('schema_changed');
      const bytes = Buffer.from(r.FileContents, 'base64');
      if (bytes.length > this.caps.fileBytes) throw new SourceError('too_large');
      return { bytes, fileName: String(r.FileName ?? item.fileName) };
    }
    const r = await this.json<{ FileUrl?: string; FileName?: string }>(
      t,
      item.self,
      dataQuery({}, FIELDS.download),
      'attachment',
      signal,
    );
    if (typeof r.FileUrl !== 'string' || !r.FileUrl) throw new SourceError('schema_changed');
    // Joined to the saved origin; a link that names another host is not fetched.
    const url = new URL(r.FileUrl, t.origin);
    if (url.origin !== t.origin) throw new SourceError('link_forbidden');
    const a = await this.get(t, url, { kind: 'file', signal, fileLink: true, resource: 'file' });
    return { bytes: a.body, fileName: String(r.FileName ?? item.fileName) };
  }
}

function hasFields(it: unknown, names: string[]) {
  return (
    typeof it === 'object' &&
    it !== null &&
    names.every((n) => (it as Record<string, unknown>)[n] !== undefined)
  );
}

/** `Retry-After` in seconds, or as an HTTP date. */
export function retryAfter(v: string | null): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  if (Number.isFinite(n)) return Math.max(0, n);
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, Math.ceil((t - Date.now()) / 1000)) : undefined;
}
