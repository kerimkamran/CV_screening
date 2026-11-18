import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import pg from 'pg';

/**
 * Helpers for the full-stack journeys (layer L2): an API client, the seeded accounts, the outbox
 * and model-call log of the control server, the database (owner login, for audit checks only),
 * and a quick way to build a screened vacancy. All people and data are invented.
 */
export const BASE = `http://127.0.0.1:${process.env.UAT_PORT ?? 4320}`;
export const CONTROL = `http://127.0.0.1:${Number(process.env.UAT_PORT ?? 4320) + 1}`;
export const ROOT = new URL('../..', import.meta.url).pathname;
export const UAT_DIR = join(ROOT, 'docs/uat');

export interface Account {
  key: string;
  email: string;
  password: string;
  displayName: string;
  roles: string[];
  userId?: string;
}
export type AccountKey =
  | 'admin'
  | 'adminTa'
  | 'recruiter'
  | 'recruiter2'
  | 'lead'
  | 'governance'
  | 'viewer'
  | 'mustChange';

/** Where the seeded accounts are written; a second stack (isolated runs) keeps its own file. */
export const ACCOUNTS_FILE =
  process.env.UAT_ACCOUNTS_FILE ?? join(ROOT, 'e2e/test-results/uat/accounts.json');

export function accounts(): Record<AccountKey, Account> {
  return JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf8'));
}

export interface Res<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

/** The API as a signed-in person (or anonymously with no token). */
export function api(token?: string) {
  const call = async <T = any>(method: string, path: string, body?: unknown): Promise<Res<T>> => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined && !(body instanceof FormData)
          ? { 'content-type': 'application/json' }
          : {}),
      },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    return { status: res.status, body: parsed as T, headers: res.headers };
  };
  return {
    get: <T = any>(p: string) => call<T>('GET', p),
    post: <T = any>(p: string, b: unknown = {}) => call<T>('POST', p, b),
    put: <T = any>(p: string, b: unknown) => call<T>('PUT', p, b),
    patch: <T = any>(p: string, b: unknown) => call<T>('PATCH', p, b),
    del: <T = any>(p: string) => call<T>('DELETE', p),
    upload: <T = any>(
      p: string,
      files: { name: string; type: string; data: Buffer | string }[],
    ) => {
      const fd = new FormData();
      for (const f of files) fd.append('files', new Blob([f.data], { type: f.type }), f.name);
      return call<T>('POST', p, fd);
    },
  };
}

/** Sign in through the API and return the token. */
export async function login(a: Pick<Account, 'email' | 'password'>): Promise<string> {
  // The API allows 30 sign-ins a minute per address; every test shares 127.0.0.1, so wait and retry.
  let r = await api().post('/auth/login', { email: a.email, password: a.password });
  for (let i = 0; r.status === 429 && i < 8; i++) {
    await new Promise((res) => setTimeout(res, 8000));
    r = await api().post('/auth/login', { email: a.email, password: a.password });
  }
  if (r.status !== 200 && r.status !== 201)
    throw new Error(`login ${a.email}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.token as string;
}

/** Open the app signed in as this person (the token lives in this tab, as after a real sign-in). */
/** The vacancy list is the working page; `#/` is Home (the menu) and is opened by name. */
export async function openAs(page: Page, a: Account, hash = '#/vacancies') {
  const token = await login(a);
  await page.addInitScript((t) => {
    if (!sessionStorage.getItem('uat-token-set')) {
      sessionStorage.setItem('cv.session', t);
      sessionStorage.setItem('uat-token-set', '1');
    }
  }, token);
  await page.goto(`${BASE}/${hash}`);
  return token;
}

/** Sign in through the real form. */
export async function signInUi(page: Page, a: Pick<Account, 'email' | 'password'>) {
  await page.goto(`${BASE}/#/`);
  await page.getByLabel(/^(Email|E-poçt)$/).fill(a.email);
  await page.getByLabel(/^(Password|Parol)$/).fill(a.password);
  await page.getByRole('button', { name: /^(Sign in|Daxil olun)$/ }).click();
}

const control = async <T = any>(path: string, body?: unknown): Promise<T> => {
  const r = await fetch(`${CONTROL}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return (await r.json()) as T;
};
export const outbox = () => control<{ to: string; subject?: string; text: string }[]>('/outbox');
export const clearOutbox = () => control('/outbox/clear', {});
export const modelCalls = () =>
  control<{ system: string; user: string; url: string; model?: string }[]>('/model-calls');
export const clearModelCalls = () => control('/model-calls/clear', {});
export const setAi = (mode: 'scripted' | 'fail' | 'slow', delayMs = 0) =>
  control('/ai', { mode, delayMs });
/** SenAI's question reader answers with a typed query (true) or with text that is not JSON (false, the default). */
export const setReader = (on: boolean) => control('/ai', { reader: on });
/** CVs containing one of these texts are refused by the fake AI (an empty list ends it). */
export const setFailMarkers = (markers: string[]) => control('/ai', { failMarkers: markers });
/** Hold every model call until released (CVs stay "being read"); `false` lets them all go. */
export const holdAi = (on: boolean) => control('/ai', { hold: on });
/** Wait until the screening queue is empty. */
export const drain = () => control('/drain', {});

/** The temporary password in the latest welcome or reset e-mail to this address. */
export async function tempPasswordFor(email: string): Promise<string> {
  const m = (await outbox()).filter((x) => x.to === email).at(-1);
  const pw = m && /Password:\s+(\S+)/.exec(m.text)?.[1];
  if (!pw) throw new Error(`no temporary password for ${email}`);
  return pw;
}

/** The database, as its owner (read-only checks of audit rows and state). */
export async function db<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({
    connectionString: process.env.UAT_OWNER_URL ?? 'postgresql://cv:cv@127.0.0.1:5432/cv_uat',
  });
  await c.connect();
  try {
    return (await c.query(sql, params)).rows as T[];
  } finally {
    await c.end();
  }
}

export const JD_EN = () => readFileSync(join(UAT_DIR, 'vacancy-en.txt'), 'utf8');
export const JD_AZ = () => readFileSync(join(UAT_DIR, 'vacancy-az.txt'), 'utf8');
export const RESUME = (file: string) => readFileSync(join(UAT_DIR, 'resumes', file));
export const RESUMES = [
  '01-aysel-en.txt',
  '02-rashad-az.txt',
  '03-ivan-ru.txt',
  '04-leyla-az-qiz.txt',
  '05-john-en-injection.txt',
  '06-maria-en-gap.txt',
  '07-elchin-az-ru-mixed.txt',
  '08-anna-ru-pdfstyle.txt',
  '09-farid-en-links.txt',
  '10-sevinj-en-health.txt',
];

/** A unique title for this test, so journeys never collide in the shared database. */
export const uniq = (prefix: string) =>
  `${prefix} ${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1e3)}`;

/**
 * A vacancy with its requirements read from the job text, started (notice confirmed, criteria
 * frozen) and, when CVs are given, those CVs uploaded and analyzed by the fake AI.
 */
export async function screenedVacancy(
  token: string,
  opts: {
    title?: string;
    jd?: string;
    files?: { name: string; type: string; data: Buffer | string }[];
  } = {},
): Promise<{ id: string; title: string; documents: { id: string; filename: string }[] }> {
  const a = api(token);
  const title = opts.title ?? uniq('UAT Network Engineer');
  const v = await a.post('/vacancies', { title, jdText: opts.jd ?? JD_EN() });
  if (v.status >= 300) throw new Error(`create vacancy: ${v.status} ${JSON.stringify(v.body)}`);
  const id = v.body.id as string;
  const ex = await a.post(`/vacancies/${id}/criteria/extract`);
  if (ex.status >= 300) throw new Error(`extract: ${ex.status} ${JSON.stringify(ex.body)}`);
  const st = await a.post(`/vacancies/${id}/start`, { confirmNotice: true });
  if (st.status >= 300) throw new Error(`start: ${st.status} ${JSON.stringify(st.body)}`);
  if (opts.files?.length) {
    const up = await a.upload(`/vacancies/${id}/documents`, opts.files);
    if (up.status >= 300) throw new Error(`upload: ${up.status} ${JSON.stringify(up.body)}`);
    await drain();
  }
  const docs = await db<{ id: string; filename: string }>(
    `SELECT id, filename FROM cv_document WHERE vacancy_id = $1 ORDER BY uploaded_at, id`,
    [id],
  );
  return { id, title, documents: docs };
}

/**
 * Grows a vacancy to `total` CVs by cloning its first three (made through the app and analyzed by
 * the fake AI) in SQL, the way apps/api/src/pipeline/volume.integration.spec.ts does. Owner SQL, for
 * the volume cases only; every person is invented.
 */
export async function growVacancy(vacancyId: string, total: number) {
  const extra = total - 3;
  await db(
    `INSERT INTO cv_document (id, vacancy_id, filename, mime, size_bytes, sha256, content, text, parse_status,
                             uploaded_by, uploaded_at, page_starts)
     SELECT upper(substr(md5('d' || g::text || $1), 1, 26)), c.vacancy_id, 'Clone_' || g || '.txt', c.mime,
            c.size_bytes, encode(sha256(('c' || g::text || $1)::bytea), 'hex'), c.content, c.text,
            c.parse_status, c.uploaded_by, c.uploaded_at + (g || ' seconds')::interval, c.page_starts
       FROM generate_series(1, $2::int) g
       JOIN LATERAL (SELECT * FROM cv_document WHERE vacancy_id = $1 AND filename NOT LIKE 'Clone_%'
                      ORDER BY id OFFSET (g % 3) LIMIT 1) c ON true`,
    [vacancyId, extra],
  );
  await db(
    `INSERT INTO screening (id, document_id, requirement_set_id, state, candidate_name, candidate_email, summary,
                            knockout, knockout_triggered, injection_suspected, score, breakdown, band,
                            ai_provider, ai_model, created_at, started_at, completed_at)
     SELECT upper(substr(md5('s' || g::text || $1), 1, 26)), upper(substr(md5('d' || g::text || $1), 1, 26)),
            s.requirement_set_id, s.state, s.candidate_name || ' ' || g, NULL, s.summary, s.knockout,
            s.knockout_triggered, s.injection_suspected, LEAST(100, GREATEST(0, s.score + (g % 9) - 4)),
            s.breakdown, s.band, s.ai_provider, s.ai_model, s.created_at, s.started_at, s.completed_at
       FROM generate_series(1, $2::int) g
       JOIN LATERAL (SELECT sc.* FROM screening sc JOIN cv_document d ON d.id = sc.document_id
                      WHERE d.vacancy_id = $1 AND d.filename NOT LIKE 'Clone_%'
                      ORDER BY sc.id OFFSET (g % 3) LIMIT 1) s ON true`,
    [vacancyId, extra],
  );
}

/** The invented resumes as upload files. */
export const resumeFiles = (names = RESUMES) =>
  names.map((n) => ({ name: n, type: 'text/plain', data: RESUME(n) }));

/**
 * A throwaway account for a test that changes an account's state (disable, reset, two-step,
 * roles), so the shared seeded accounts stay as they are. Returns it signed-in-ready (password
 * already changed from the temporary one unless keepTemp is set).
 */
export async function freshAccount(
  role: 'TA_PARTNER' | 'TA_LEAD' | 'GOVERNANCE' | 'ADMIN' | 'NONE' = 'TA_PARTNER',
  opts: { name?: string; keepTemp?: boolean } = {},
): Promise<Account> {
  const acc = accounts();
  const admin = api(await login(acc.admin));
  const tag = Date.now().toString(36) + Math.floor(Math.random() * 1e4);
  const email = `uat.${tag}@example.az`;
  const displayName = opts.name ?? `Test ${tag}`;
  const r = await admin.post('/admin/users', { email, displayName, role });
  if (r.status !== 201) throw new Error(`fresh account: ${r.status} ${JSON.stringify(r.body)}`);
  const temp = await tempPasswordFor(email);
  const userId = r.body.user.id as string;
  if (opts.keepTemp) return { key: tag, email, password: temp, displayName, roles: [role], userId };
  const password = acc.recruiter.password;
  const t = await login({ email, password: temp });
  const c = await api(t).post('/auth/change-password', {
    currentPassword: temp,
    newPassword: `${password}x`,
  });
  if (c.status >= 300)
    throw new Error(`fresh account password: ${c.status} ${JSON.stringify(c.body)}`);
  return { key: tag, email, password: `${password}x`, displayName, roles: [role], userId };
}

/** The admin's API client. */
export const adminApi = async () => api(await login(accounts().admin));
