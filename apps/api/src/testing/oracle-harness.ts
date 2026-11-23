/**
 * Stage 3 test helpers for the Oracle import (plan 15.1): boot with the switch on, an in-memory
 * source for the runner (Phase 2 specs need no Oracle code), owner-SQL seeding of runs, and a
 * drain that runs the import and then the analyses.
 */
import { newId } from '@cv/shared';
import { ImportRunnerService } from '../integrations/import-runner.service';
import type {
  Downloaded,
  ImportSource,
  ListPage,
  SourceApplication,
  SourceRun,
} from '../integrations/import-source';
import { SourceError } from '../integrations/import-source';
import { ProcessorService } from '../pipeline/processor.service';
import { OracleConnectionService } from '../integrations/oracle/oracle-connection.service';
import { OracleHcmClient } from '../integrations/oracle/oracle-hcm.client';
import { OracleSource } from '../integrations/oracle/oracle-source';
import { boot, cv, type BootOptions, type Harness, scriptedModel } from './app-harness';
import { createFakeOracle, FAKE_ORIGIN, type FakeOracle } from './fake-oracle';

/* eslint-disable @typescript-eslint/no-explicit-any */

export const ORACLE_ON = { ORACLE_IMPORT_ENABLED: 'true' };

export async function bootOracle(tag: string, opts: BootOptions = {}): Promise<Harness> {
  const h = await boot(tag, scriptedModel, { ...opts, env: { ...ORACLE_ON, ...(opts.env ?? {}) } });
  // The memory share is the whole CI machine's, not this test's: a busy runner must not park runs
  // as capacity_unavailable. The ceiling has its own test (S3-INT-12 (14)), which sets its value.
  h.app.get(ImportRunnerService).memory = () => 0;
  return h;
}

export const runner = (h: Harness) => h.app.get(ImportRunnerService);

/** Runs the import, then the analyses (the harness has the worker off). */
export async function drainAll(h: Harness) {
  await runner(h).drainRuns();
  await h.app.get(ProcessorService).drain();
}

/** A CV as text bytes (intake reads .txt), with a name the scripted model reads back. */
export const cvBytes = (name: string) =>
  Buffer.from(cv(name, ['BGP routing at scale', 'Kubernetes operator']));

export interface MemApp extends SourceApplication {
  file?: Buffer;
}

/** n active applications, each with one text CV, applied on consecutive days (oldest first by date). */
let appSet = 0;
/**
 * Oracle IDs are unique across the whole Oracle site, and tombstones match an application ID across
 * every vacancy, so each call gets its own ID range (the prefix) unless the caller passes one.
 */
export function makeApps(
  n: number,
  opts: { start?: number; base?: Date; prefix?: string } = {},
): MemApp[] {
  const base = opts.base ?? new Date('2026-06-01T00:00:00Z');
  const start = opts.start ?? 1;
  const pre = opts.prefix ?? `S${++appSet}-`;
  return Array.from({ length: n }, (_, k) => {
    const i = start + k;
    const file = cvBytes(`Applicant ${i}`);
    return {
      applicationId: `${pre}A${100000 + i}`,
      personId: `${pre}P${100000 + i}`,
      appliedAt: new Date(base.getTime() + i * 86_400_000),
      eligibility: 'active' as const,
      internal: false,
      attachments: [
        {
          attachmentId: `${pre}T${100000 + i}`,
          fileName: `Applicant_${i}.txt`,
          size: file.length,
          category: 'Resume',
        },
      ],
      file,
    };
  });
}

/**
 * The in-memory source: pages of `pageSize`, cursor = last application ID, files by attachment ID.
 * Fault switches: `listFault` / `downloadFault` throw a SourceError; `hold` delays every download.
 */
export class MemorySource implements ImportSource {
  readonly system = 'oracle_hcm' as const;
  apps: MemApp[];
  pageSize = 50;
  listCalls = 0;
  downloads = 0;
  inFlight = 0;
  maxInFlight = 0;
  listFault: ((cursor: string | null) => SourceError | null) | null = null;
  downloadFault: ((ref: { attachmentId: string }, n: number) => SourceError | null) | null = null;
  hold = 0;
  /** Awaited before each download (after the hold): lets a spec change the database in step. */
  beforeDownload: ((n: number) => Promise<void>) | null = null;
  /** Called after each page is read (restart specs drop the claim here). */
  afterPage: ((page: number) => Promise<void>) | null = null;

  constructor(apps: MemApp[]) {
    this.apps = apps;
  }

  async listPage(_run: SourceRun, cursor: string | null): Promise<ListPage> {
    this.listCalls++;
    const f = this.listFault?.(cursor);
    if (f) throw f;
    const sorted = [...this.apps].sort((a, b) => a.applicationId.localeCompare(b.applicationId));
    const from = cursor ? sorted.findIndex((a) => a.applicationId > cursor) : 0;
    const slice = from < 0 ? [] : sorted.slice(from, from + this.pageSize);
    const done = from < 0 || from + this.pageSize >= sorted.length;
    const page = {
      applications: slice.map(({ file: _f, ...a }) => a),
      cursor: slice.at(-1)?.applicationId ?? cursor,
      done,
    };
    if (this.afterPage) await this.afterPage(this.listCalls);
    return page;
  }

  async download(
    run: SourceRun,
    ref: { applicationId: string; attachmentId: string },
  ): Promise<Downloaded> {
    this.downloads++;
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      if (this.hold) await new Promise((r) => setTimeout(r, this.hold));
      if (run.signal.aborted) throw run.signal.reason;
      if (this.beforeDownload) await this.beforeDownload(this.downloads);
      const f = this.downloadFault?.(ref, this.downloads);
      if (f) throw f;
      const app = this.apps.find((a) =>
        a.attachments.some((t) => t.attachmentId === ref.attachmentId),
      );
      const att = app?.attachments.find((t) => t.attachmentId === ref.attachmentId);
      if (!app || !att || !app.file) throw new SourceError('link_forbidden');
      return { bytes: app.file, fileName: att.fileName };
    } finally {
      this.inFlight--;
    }
  }
}

/** A queued import run, written by owner SQL (Phase 2 has no start route). */
export async function seedRun(
  h: Harness,
  vacancyId: string,
  userId: string,
  opts: { estimate?: number | null; mode?: 'import' | 'refresh'; externalId?: string } = {},
): Promise<string> {
  const id = newId();
  await h.db.owner.query(
    `INSERT INTO import_run (id, vacancy_id, mode, state, phase, external_ref, external_id, estimate, started_by, started_ip)
     VALUES ($1,$2,$3,'queued','listing','REQ-1',$4,$5,$6,'127.0.0.1')`,
    [
      id,
      vacancyId,
      opts.mode ?? 'import',
      opts.externalId ?? '300000000001',
      opts.estimate ?? null,
      userId,
    ],
  );
  return id;
}

export const runRow = async (h: Harness, runId: string) =>
  (await h.db.owner.query(`SELECT * FROM import_run WHERE id = $1`, [runId])).rows[0];

/** A vacancy ready for uploads (criteria frozen, notice confirmed), with no CVs. */
export async function readyVacancy(
  h: Harness,
  who: Parameters<Harness['scenario']>[0],
  title = 'Oracle import',
) {
  return h.scenario(who, [], title);
}

// ------------------------------------------------------------------ Phase 3: the fake Oracle behind the real client

export interface OracleStack {
  h: Harness;
  fake: FakeOracle;
  client: OracleHcmClient;
  /** Activate through the admin route with the fake's values; returns the answer. */
  activate: (over?: Record<string, unknown>) => Promise<any>;
}

/**
 * Boot with the switch on, put the fake into the client (`fetcher`, `lookup`), lift the pace for
 * tests, switch retention on, activate through the admin route and (unless `keepEuDefault`) switch
 * `requireEuAi` off: the harness's AI model is an Anthropic test connection the catalogue cannot
 * mark as EU-resident (plan 18.2, step 8).
 */
export async function bootWithFake(
  tag: string,
  opts: BootOptions & { keepEuDefault?: boolean; activate?: boolean } = {},
): Promise<OracleStack> {
  const h = await bootOracle(tag, opts);
  const fake = createFakeOracle(1);
  const client = h.app.get(OracleHcmClient);
  client.fetcher = fake.fetch;
  client.lookup = fake.lookup;
  client.pace = { concurrency: 2, perSecond: 1000 };
  client.retry = { tries: 2, baseMs: 5 };
  // The runner reads through the real Oracle source again (an earlier spec may have replaced it).
  runner(h).source = new OracleSource(h.app.get(OracleConnectionService));
  await h.db.owner.query(`UPDATE retention_setting SET enabled = true WHERE id = 1`);
  const activate = async (over: Record<string, unknown> = {}) =>
    (
      await h.admin.post('/admin/integrations/oracle/activate', {
        address: `${FAKE_ORIGIN}/hcmRestApi/resources/11.13.18.05/recruitingJobRequisitions?onlyData=true`,
        user: fake.state.switches.user,
        password: fake.state.switches.password,
        notice: true,
        ...over,
      })
    ).json();
  if (opts.activate !== false) {
    fake.seed([{ number: 'SEED-0', applications: 1 }]);
    const a = await activate();
    if (a.code !== 'ok') throw new Error(`activate failed: ${JSON.stringify(a)}`);
    if (!opts.keepEuDefault)
      await h.admin.put('/admin/integrations/oracle/settings', { requireEuAi: false });
    fake.calls.length = 0;
  }
  return { h, fake, client, activate };
}
