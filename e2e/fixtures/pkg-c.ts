import type { Page, Route } from '@playwright/test';
import JSZip from 'jszip';
import { AZ } from '../../apps/web/src/i18n/az';
import { ME, mockApi, VID, type Seen } from './api';
import { ulidOf } from './files';

/**
 * Package C of the UAT (vacancy list, Role card, vacancy page, CVs card): mocks for layer L1 and a
 * few helpers for layer L2. Every person and company here is invented.
 */

// ------------------------------------------------------------------ language

/** The app's own translation: English sentence → Azerbaijani (apps/web/src/i18n), with {vars}. */
export function T(lang: 'en' | 'az') {
  return (en: string, vars?: Record<string, string | number>) => {
    const s = lang === 'az' ? (AZ[en] ?? en) : en;
    return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
  };
}
export const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ------------------------------------------------------------------ data

export const OWNER = { id: '01K000000000000000000000AY', name: 'Aysel Mammadova' };
export const NEW_ID = '01K0000000000000000000NEWV';
export const VID2 = ulidOf('VAC', 2);
export const VID3 = ulidOf('VAC', 3);
export const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
export const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

export type Req = {
  id?: string;
  text: string;
  classification: 'mandatory' | 'preferred' | 'informational' | 'disqualifier';
  weight: number | null;
  rule?: unknown;
  confidence?: string | null;
};
export const must = (text: string, i = 0): Req => ({
  id: ulidOf('REQ', i),
  text,
  classification: 'mandatory',
  weight: 10,
  rule: null,
  confidence: 'high',
});
export const nice = (text: string, i = 0): Req => ({
  id: ulidOf('REQ', 100 + i),
  text,
  classification: 'preferred',
  weight: 5,
  rule: null,
  confidence: 'high',
});

/** A row of GET /vacancies. */
export function vrow(over: Record<string, unknown> = {}) {
  return {
    id: VID,
    title: 'Network Engineer',
    department: null,
    location: null,
    status: 'open',
    archived: false,
    owner: OWNER,
    canEdit: true,
    documents: 0,
    analyzed: 0,
    outOfDate: 0,
    strong: 0,
    decisions: { shortlist: 0, maybe: 0, notNow: 0 },
    running: 0,
    stopped: 0,
    version: 3,
    updatedAt: minsAgo(3),
    createdAt: daysAgo(30),
    ...over,
  };
}

export const COUNTS0 = {
  documents: 0,
  analyzed: 0,
  outOfDate: 0,
  strong: 0,
  running: 0,
  stopped: 0,
  failed: 0,
  needsLook: 0,
};

/** GET /vacancies/<id> (VacancyView). */
export function vview(over: Record<string, any> = {}) {
  const { counts, ...rest } = over;
  return {
    id: VID,
    title: 'Network Engineer',
    status: 'open',
    archived: false,
    department: 'Network',
    location: 'Bakı',
    experienceRange: 'any',
    openings: null,
    closingDate: null,
    hiringManager: null,
    notes: null,
    description: '',
    sourceType: 'typed',
    sourceFileName: null,
    link: null,
    requirementsVersion: 1,
    version: 3,
    owner: OWNER,
    canEdit: true,
    candidateNoticeConfirmedAt: null,
    createdAt: daysAgo(10),
    updatedAt: minsAgo(30),
    updatedBy: null,
    requirements: [] as Req[],
    hasDraft: false,
    hasFrozen: false,
    ...rest,
    counts: { ...COUNTS0, ...(counts ?? {}) },
  };
}
export type View = ReturnType<typeof vview>;

/** The fields of a PATCH body, applied to a view the way the server would. */
function applyPatch(v: View, b: Record<string, any>) {
  const map: Record<string, string> = {
    experienceRange: 'experienceRange',
    description: 'description',
  };
  for (const [k, val] of Object.entries(b)) {
    if (k === 'expectedVersion' || k === 'linkHash') continue;
    if (k === 'linkUrl')
      v.link = val ? { url: val, readAt: new Date().toISOString(), status: 'ok' } : null;
    else if (k === 'requirements')
      v.requirements = (val as Req[]).map((r, i) => ({ ...r, id: ulidOf('RQS', i) }));
    else (v as any)[map[k] ?? k] = val;
  }
  v.version += 1;
  v.updatedAt = new Date().toISOString();
}

export const listing = (candidates: unknown[] = []) => ({
  counts: { total: candidates.length, queued: 0, stopped: 0, failed: 0, manual: 0, undecided: 0 },
  aiActive: true,
  candidates,
});
const BYSTATUS0 = {
  not_sent: 0,
  sending: 0,
  waiting_to_send: 0,
  could_not_send: 0,
  rejected: 0,
  duplicate: 0,
  vacancy_full: 0,
  analyzing: 0,
  stopped: 0,
  failed: 0,
  unreadable: 0,
  needs_look: 0,
  analyzed: 0,
  not_analyzed: 0,
  erased: 0,
};

export interface VacOpts {
  me?: Record<string, unknown>;
  assistant?: Record<string, unknown>;
  /** GET /vacancies: rows, or a function of the query. */
  list?: unknown[] | ((url: URL) => unknown[] | Promise<unknown[]>);
  /** GET /vacancies/<id>: the views by id (changed in place by PATCH, archive, restore). */
  views?: View[];
  runs?: unknown[] | ((id: string) => unknown[]);
  history?: unknown[];
  intake?: Record<string, unknown>;
  /** GET /vacancies/similar */
  similar?: unknown[] | ((title: string) => unknown[]);
  /** POST criteria/extract: the requirements it finds. */
  extract?: Req[];
  /** Answered before everything else; return true when handled. */
  extra?: (route: Route, url: URL, method: string, body: any) => Promise<boolean> | boolean;
}

/**
 * mockApi plus the vacancy endpoints. Returns `seen` (every request) and `views` (the live
 * vacancy views, so a test can read what a PATCH stored).
 */
export async function vacApi(page: Page, o: VacOpts = {}) {
  const views = new Map<string, View>((o.views ?? [vview()]).map((v) => [v.id, v]));
  const batches = new Map<string, { vacancyId: string; files: number }>();
  let seq = 0;
  const seen: Seen = await mockApi(page, {
    me: o.me,
    assistant: o.assistant,
    extra: async (route, url) => {
      const req = route.request();
      const method = req.method();
      let body: any;
      try {
        body = req.postDataJSON();
      } catch {
        body = undefined;
      }
      if (o.extra && (await o.extra(route, url, method, body))) return true;
      const p = url.pathname;
      const json = async (b: unknown, status = 200) => {
        await route.fulfill({ status, json: b });
        return true;
      };
      if (p === '/me/preferences') return json({});
      if (p === '/assistant/preferences') return json({ top: null });
      if (p === '/vacancies' && method === 'GET') {
        const rows = typeof o.list === 'function' ? await o.list(url) : (o.list ?? []);
        return json(rows);
      }
      if (p === '/vacancies/similar') {
        const t = url.searchParams.get('title') ?? '';
        return json(typeof o.similar === 'function' ? o.similar(t) : (o.similar ?? []));
      }
      if (p === '/vacancies' && method === 'POST') {
        const id = NEW_ID;
        views.set(
          id,
          vview({
            id,
            title: body?.title,
            status: 'draft',
            version: 1,
            department: null,
            location: null,
            owner: { id: ME.userId, name: ME.displayName },
            createdAt: new Date().toISOString(),
          }),
        );
        return json({ id }, 201);
      }
      const m = /^\/vacancies\/(\w{26})(\/.*)?$/.exec(p);
      if (m) {
        const id = m[1]!;
        const sub = m[2] ?? '';
        const v = views.get(id);
        if (!v) return json({ message: 'Not Found', statusCode: 404 }, 404);
        if (sub === '' && method === 'GET') return json(v);
        if (sub === '' && method === 'PATCH') {
          if (body?.expectedVersion !== v.version)
            return json(
              {
                message: `Changed by ${OWNER.name} at 09:41. Reload to see their version.`,
                code: 'STALE_VERSION',
              },
              409,
            );
          applyPatch(v, body ?? {});
          return json(v);
        }
        if (sub === '/runs')
          return json(typeof o.runs === 'function' ? o.runs(id) : (o.runs ?? []));
        if (sub === '/history') return json(o.history ?? []);
        if (sub === '/intake')
          return json({
            used: v.counts.documents,
            limit: 500,
            maxFileMb: 10,
            maxZipMb: 100,
            accepts: ['.pdf', '.docx', '.txt', '.zip'],
            latestBatch: null,
            ...(o.intake ?? {}),
          });
        if (sub === '/candidates') return json(listing());
        if (sub === '/adjustments')
          return json({ requirements: [], knockouts: [], changes: [], changeCount: 0 });
        if (sub === '/criteria' && method === 'GET')
          return json({
            versions: [
              { id: ulidOf('SET', 1), version: 1, frozenAt: v.hasFrozen ? v.createdAt : null },
            ],
            current: {
              id: ulidOf('SET', 1),
              version: 1,
              frozen: v.hasFrozen,
              requirements: v.requirements,
            },
          });
        if (sub === '/criteria/extract') {
          v.requirements = o.extract ?? v.requirements;
          return json({
            versions: [],
            current: {
              id: ulidOf('SET', 1),
              version: 1,
              frozen: false,
              requirements: v.requirements,
            },
          });
        }
        if (sub === '/jd') return json({ body: v.description });
        if (sub === '/start') {
          if (body?.confirmNotice && !v.candidateNoticeConfirmedAt)
            v.candidateNoticeConfirmedAt = new Date().toISOString();
          return json({ queued: 0 });
        }
        if (sub === '/upload-batches') {
          const batchId = ulidOf('BAT', ++seq);
          const n = (body?.files ?? []).length;
          batches.set(batchId, { vacancyId: id, files: n });
          return json(
            {
              batchId,
              items: (body?.files ?? []).map((_: unknown, i: number) => ({
                itemId: ulidOf(`IT${seq}`, i + 1),
                position: i,
              })),
              capacity: { used: 0, limit: 500, room: 500 },
            },
            201,
          );
        }
        if (sub === '/documents' && method === 'POST') return json({ ok: true }, 201);
        if (sub === '/archive') {
          v.archived = true;
          v.version += 1;
          return json(v);
        }
        if (sub === '/restore') {
          v.archived = false;
          v.version += 1;
          return json(v);
        }
        if (sub === '/skipped') return json([]);
      }
      const b = /^\/upload-batches\/(\w{26})$/.exec(p);
      if (b) {
        const bt = batches.get(b[1]!) ?? { vacancyId: VID, files: 0 };
        return json({
          batch: {
            id: b[1],
            vacancyId: bt.vacancyId,
            createdAt: new Date().toISOString(),
            createdBy: ME.displayName,
            fileCount: bt.files,
            mine: true,
          },
          lastReceivedAt: null,
          counts: {
            upload: {
              total: bt.files,
              received: 0,
              notReceived: bt.files,
              vacancyFull: 0,
              rejected: 0,
              duplicate: 0,
            },
            byStatus: { ...BYSTATUS0, analyzing: bt.files },
          },
          items: [],
        });
      }
      if (p.startsWith('/assistant/jd-coach/')) return json({ message: 'Not Found' }, 404);
      return false;
    },
  });
  return { seen, views };
}

/** Only the API requests that match (method and path regex). */
export const reqs = (seen: Seen, method: string, re: RegExp) =>
  seen.requests.filter((r) => r.method === method && re.test(r.url));

// ------------------------------------------------------------------ backgrounds

export const BACKGROUNDS = [
  ['white', 'White'],
  ['grey', 'White-grey'],
  ['cream', 'Cream-white'],
  ['dark', 'Dark'],
] as const;

/** Choose a page background the way a person does: account menu → Background → the swatch. */
export async function chooseBackground(page: Page, lang: 'en' | 'az', label: string) {
  const t = T(lang);
  const menu = page
    .locator('details')
    .filter({ has: page.getByLabel(t('Account menu')) })
    .first();
  const summary = page.getByLabel(t('Account menu'));
  if (!(await menu.evaluate((d) => (d as HTMLDetailsElement).open))) await summary.click();
  const bg = menu
    .locator('details')
    .filter({ hasText: t('Background') })
    .first();
  if (!(await bg.evaluate((d) => (d as HTMLDetailsElement).open)))
    await bg.locator('summary').click();
  await bg.getByRole('radio', { name: t(label), exact: true }).check();
  // Close both menus again.
  await bg.evaluate((d) => d.removeAttribute('open'));
  await menu.evaluate((d) => d.removeAttribute('open'));
}

/** The 4 backgrounds of the plan: choose each one and run the checks. */
export async function onBackgrounds(
  page: Page,
  lang: 'en' | 'az',
  fn: (name: string) => Promise<void>,
) {
  for (const [key, label] of BACKGROUNDS) {
    await chooseBackground(page, lang, label);
    await page.waitForFunction((k) => document.documentElement.getAttribute('data-bg') === k, key);
    await fn(label);
  }
}

// ------------------------------------------------------------------ files

export const file = (
  name: string,
  size: number | Buffer | string,
  mimeType = 'application/octet-stream',
) => ({
  name,
  mimeType,
  buffer: Buffer.isBuffer(size)
    ? size
    : typeof size === 'string'
      ? Buffer.from(size)
      : Buffer.alloc(size, 0x20),
});
export const pdf = (name: string, kb = 20) =>
  file(
    name,
    Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(kb * 1024 - 9, 0x20)]),
    'application/pdf',
  );

/** A real .docx with the given paragraphs (built in memory). */
export async function docx(paragraphs: string[]): Promise<Buffer> {
  const z = new JSZip();
  z.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  z.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  const x = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  z.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${x(p)}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`,
  );
  return z.generateAsync({ type: 'nodebuffer' });
}

// ------------------------------------------------------------------ L2: a second API in owner mode

/**
 * VACANCY_EDIT=owner needs the API started with that setting. The shared server (4320) runs the
 * default and must not be restarted, so package C uses a second instance of the same build on
 * port 4330, against the same database, with its worker and converter off (the shared server's
 * worker reads the CVs). Started by the tests when missing.
 */
export const OWNER_PORT = Number(process.env.UAT_OWNER_PORT ?? 4330);
export const OWNER_BASE = `http://127.0.0.1:${OWNER_PORT}`;

export async function ownerServer(): Promise<boolean> {
  const up = async () => {
    try {
      const r = await fetch(`${OWNER_BASE}/readyz`);
      return r.ok;
    } catch {
      return false;
    }
  };
  if (await up()) return true;
  const { spawn } = await import('node:child_process');
  const { openSync } = await import('node:fs');
  const root = new URL('../..', import.meta.url).pathname;
  const out = openSync('/tmp/uat-owner-mode.log', 'a');
  const child = spawn(process.execPath, [`${root}e2e/fullstack/server.mjs`], {
    cwd: `${root}e2e`,
    env: {
      ...process.env,
      UAT_PORT: String(OWNER_PORT),
      VACANCY_EDIT: 'owner',
      WORKER_ENABLED: 'false',
      RENDITION_ENABLED: 'false',
    },
    detached: true,
    stdio: ['ignore', out, out],
  });
  child.unref();
  for (let i = 0; i < 90; i++) {
    if (await up()) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/** The API client against a given base (same shape as stack.ts api()). */
export function apiAt(base: string, token?: string) {
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: any = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    return { status: res.status, body: parsed };
  };
  return {
    get: (p: string) => call('GET', p),
    post: (p: string, b: unknown = {}) => call('POST', p, b),
    put: (p: string, b: unknown) => call('PUT', p, b),
    patch: (p: string, b: unknown) => call('PATCH', p, b),
  };
}

/** Open the app at another base with a token already in this tab. */
export async function openAt(page: Page, base: string, token: string, hash: string) {
  await page.addInitScript((t) => {
    if (!sessionStorage.getItem('uat-token-set')) {
      sessionStorage.setItem('cv.session', t);
      sessionStorage.setItem('uat-token-set', '1');
    }
  }, token);
  await page.goto(`${base}/${hash}`);
}

// ------------------------------------------------------------------ keyboard and layout

/** Press Tab until the locator has focus (KEY). Returns false when it is not reached. */
export async function tabTo(page: Page, target: import('@playwright/test').Locator, max = 60) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false))
      return true;
  }
  return false;
}

/** A visible focus indicator on the focused element: an outline or a ring (box-shadow). */
export async function hasRing(target: import('@playwright/test').Locator) {
  return target.evaluate((el) => {
    const s = getComputedStyle(el);
    const outline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
    const ring = s.boxShadow !== 'none' && s.boxShadow !== '';
    return outline || ring;
  });
}

/** Visible controls inside `scope` smaller than min×min px (the touch-target rule), by name. */
export async function smallTargets(scope: import('@playwright/test').Locator, min = 44) {
  return scope.evaluate((root, m) => {
    const out: string[] = [];
    for (const e of root.querySelectorAll<HTMLElement>(
      'button, a[href], input:not([type=hidden]), select, summary, [role=button], [role=tab]',
    )) {
      const r = e.getBoundingClientRect();
      const st = getComputedStyle(e);
      if (r.width === 0 || r.height === 0 || st.visibility === 'hidden') continue;
      if (e.closest('.sr-only, [aria-hidden=true]') || e.classList.contains('sr-only')) continue;
      let w = r.width;
      let h = r.height;
      const lab = e.closest('label');
      if (lab && (e as HTMLInputElement).type !== 'text') {
        const lr = lab.getBoundingClientRect();
        w = Math.max(w, lr.width);
        h = Math.max(h, lr.height);
      }
      if (w < m || h < m)
        out.push(
          `${(e.getAttribute('aria-label') || e.innerText || e.tagName).trim().slice(0, 40)} ${Math.round(w)}×${Math.round(h)}`,
        );
    }
    return [...new Set(out)];
  }, min);
}

/** The page does not scroll sideways. */
export const pageScrollsSideways = (page: Page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );

// ------------------------------------------------------------------ L2: vacancies of package C

type ApiClient = ReturnType<typeof apiAt>;
type UploadFile = { name: string; type: string; data: Buffer | string };

/**
 * A vacancy for an L2 test, made through the API as the given person: created, requirements read by
 * the fake AI from the job text, optionally started (notice confirmed, criteria frozen) and given CVs
 * (in parts of 50, the upload limit), optionally waiting until they are analyzed.
 */
export async function makeVacancy(
  base: string,
  token: string,
  o: {
    title: string;
    jd?: string;
    start?: boolean;
    files?: UploadFile[];
    drain?: () => Promise<unknown>;
    details?: Record<string, unknown>;
  },
) {
  const a = apiAt(base, token);
  const v = await a.post('/vacancies', { title: o.title, ...(o.jd ? { jdText: o.jd } : {}) });
  if (v.status >= 300) throw new Error(`create vacancy: ${v.status} ${JSON.stringify(v.body)}`);
  const id = v.body.id as string;
  if (o.jd) {
    const ex = await a.post(`/vacancies/${id}/criteria/extract`);
    if (ex.status >= 300) throw new Error(`extract: ${ex.status} ${JSON.stringify(ex.body)}`);
  }
  if (o.details) {
    const cur = await a.get(`/vacancies/${id}`);
    const p = await a.patch(`/vacancies/${id}`, {
      expectedVersion: cur.body.version,
      ...o.details,
    });
    if (p.status >= 300) throw new Error(`details: ${p.status} ${JSON.stringify(p.body)}`);
  }
  if (o.start || o.files?.length) {
    const st = await a.post(`/vacancies/${id}/start`, { confirmNotice: true });
    if (st.status >= 300) throw new Error(`start: ${st.status} ${JSON.stringify(st.body)}`);
  }
  for (let i = 0; i < (o.files?.length ?? 0); i += 50) {
    const up = await upload(base, token, `/vacancies/${id}/documents`, o.files!.slice(i, i + 50));
    if (up.status >= 300) throw new Error(`upload: ${up.status} ${JSON.stringify(up.body)}`);
  }
  if (o.files?.length && o.drain) await o.drain();
  return { id, title: o.title, api: a as ApiClient };
}

export async function upload(base: string, token: string, path: string, files: UploadFile[]) {
  const fd = new FormData();
  for (const f of files) fd.append('files', new Blob([f.data], { type: f.type }), f.name);
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: fd,
  });
  const text = await res.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, body };
}

/** Plain-text CVs with a common, unique name prefix (the fake AI marks a skill met by its longest word). */
export const textCvs = (
  prefix: string,
  n: number,
  lines: (i: number) => string[] = (i) =>
    i % 2 ? ['BGP routing on the carrier core.'] : ['Kubernetes in production.', 'BGP routing.'],
) =>
  Array.from({ length: n }, (_, i) => ({
    name: `${prefix.toLowerCase().replace(/\W+/g, '-')}-${String(i + 1).padStart(3, '0')}.txt`,
    type: 'text/plain',
    data: `Name: ${prefix} Person ${i + 1}\n${lines(i).join('\n')}\n${'Worked on network operations and automation. '.repeat(6)}`,
  }));

/** A job text whose requirements the fake AI reads exactly (Required / Nice to have lines). */
export const jd = (mustHave: string[], niceToHave: string[] = []) =>
  `UAT role for package C.\n\nRequired: ${mustHave.join(', ')}.\n${niceToHave.length ? `Nice to have: ${niceToHave.join(', ')}.\n` : ''}Location: Baku.`;

/** A valid one-page PDF with no text at all (a "scan-only" CV for the parser); `tag` makes it unique. */
export function blankPdf(tag: string): Buffer {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << >> /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
  ];
  let out = `%PDF-1.4\n% ${tag}\n`;
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** Requests in flight for a URL pattern: the highest number seen at once. */
export function inFlight(page: Page, re: RegExp) {
  const st = { now: 0, max: 0, order: [] as string[] };
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (r.method() === 'POST') st.order.push(u.pathname + u.search);
    if (re.test(u.pathname + u.search)) st.max = Math.max(st.max, ++st.now);
  });
  const done = (r: import('@playwright/test').Request) => {
    const u = new URL(r.url());
    if (re.test(u.pathname + u.search)) st.now--;
  };
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  return st;
}
