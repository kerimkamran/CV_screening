import { expect, uat } from '../ux/test';
import { accounts, api, login, openAs } from './stack';

// 7.x SenAI admin, roles and limits (SX), full-stack journeys (L2).
// SenAI is off on the shared L2 server while other packages run; every case that needs it on (or
// changes its name, switches, caps or the AI model) would change it for everyone, so those are
// blocked here and need an exclusive L2 run.

uat(
  'SX-08',
  'Recent answers and the payload log show shapes, never text or names',
  { on: ['D'], langs: 'EN' },
  async ({ page, ux, info }) => {
    ux.allow(/403/);
    info.annotations.push({
      type: 'Blocked',
      description:
        'steps 1-2 (rows from real SenAI answers) need SenAI on for everyone on the shared L2 server',
    });
    const acc = accounts();
    // 3) Governance reads both logs and cannot change the settings.
    const g = api(await login(acc.governance));
    const audit = await g.get('/admin/assistant/audit');
    const payloads = await g.get('/admin/assistant/payloads');
    expect(audit.status).toBe(200);
    expect(payloads.status).toBe(200);
    expect(Array.isArray(payloads.body.allowed)).toBe(true);
    const put = await g.put('/admin/assistant', {});
    expect(put.status).toBe(403);
    // The payload log holds field shapes only (no text): each call's fields are {type, maxLength}.
    for (const c of (payloads.body.calls ?? []) as { fields: Record<string, unknown> }[])
      for (const f of Object.values(c.fields))
        expect(Object.keys(f as object).sort()).toEqual(['maxLength', 'type']);
    // 4) Governance opens #/admin/assistant: both lists, read-only, no settings and no Save.
    await openAs(page, acc.governance, '#/admin/assistant');
    await expect(page.getByLabel('Account menu', { exact: true })).toBeVisible();
    await expect
      .soft(
        page.getByRole('heading', { name: 'Recent answers (for review)' }),
        'governance sees Recent answers',
      )
      .toBeVisible();
    await expect
      .soft(
        page.getByRole('heading', { name: 'What was sent to the model' }),
        'governance sees the payload log',
      )
      .toBeVisible();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Turn the assistant on')).toHaveCount(0);
    await ux.check('governance assistant', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE']);
  },
);

// ================================================================ package G: SX-01..06, SX-09..11
// Package G owns SenAI during its run: it switches SenAI on through the admin API (SX-01 does it
// through the page) and puts every setting back at the end of its run (fixtures/pkg-g.ts).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { T } from '../fixtures/pkg-c';
import { senaiOn, senaiPut, senaiSettings } from '../fixtures/pkg-g';
import { STD } from '../ux/test';
import {
  clearModelCalls,
  db,
  freshAccount,
  modelCalls,
  resumeFiles,
  screenedVacancy,
  setAi,
  setReader,
  uniq,
  UAT_DIR,
} from './stack';

let gVac: Promise<{
  id: string;
  title: string;
  documents: { id: string; filename: string }[];
}> | null = null;
const gBackend = () =>
  (gVac ??= (async () =>
    screenedVacancy(await login(accounts().recruiter), {
      title: uniq('Backend Engineer'),
      files: resumeFiles(),
    }))());
const matchOf = async (token: string, vacancyId: string, documentId: string) =>
  (
    (await api(token).get(`/candidates?vacancy=${vacancyId}&limit=50`)).body.rows as {
      matchId: string;
      documentId: string;
    }[]
  ).find((r) => r.documentId === documentId)!.matchId;

uat(
  'SX-01',
  'Turning SenAI on: each missing condition gives its reason',
  { on: ['D'], langs: 'EN' },
  async ({ page, ux }) => {
    // Precondition "fresh settings": SenAI off, data terms not recorded, no test. The test stamp
    // cannot be cleared through the API, so it is reset in the test database.
    await senaiPut({ enabled: false, dataTerms: 'unknown', regionAllowed: '' });
    await db(
      `UPDATE assistant_setting SET tested_at=NULL, tested_model_key=NULL, attested_by=NULL, attested_at=NULL`,
    );
    try {
      const acc = accounts();
      await openAs(page, acc.admin, '#/admin/assistant');
      const save = page.getByRole('button', { name: 'Save', exact: true });
      const on = page.getByLabel('Turn the assistant on');
      await on.check();
      await save.click();
      await expect(
        page.getByText(
          'Record what the provider does with the data before turning the assistant on',
        ),
      ).toBeVisible();
      const terms = page.getByLabel('What the provider does with the data');
      await terms.selectOption({ label: 'Provider may train on it (cannot be used)' });
      await save.click();
      await expect(
        page.getByText('A provider that may train on this data cannot be used for the assistant'),
      ).toBeVisible();
      await terms.selectOption({ label: 'Provider keeps nothing and does not train on it' });
      await page.getByLabel('Region where data may be processed').fill('West Europe');
      await save.click();
      await expect(
        page.getByText('Run "Test connection" on this model within the last hour first'),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Test connection' }).click();
      await expect(page.getByText('Passed within the last hour.')).toBeVisible();
      await save.click();
      await expect(
        page.getByText('Confirm that you checked these data terms before turning the assistant on'),
      ).toBeVisible();
      await page.getByLabel('I checked these terms with the provider’s own documentation.').check();
      await save.click();
      const saved = page.getByText('Saved.', { exact: true });
      await expect(saved).toBeVisible();
      await expect(saved, '"Saved." is visible without scrolling').toBeInViewport();
      await expect(page.getByText('SenAI is on for recruiters.', { exact: false })).toBeVisible();
      const adminName = (await api(await login(acc.admin)).get('/me')).body.displayName as string;
      await expect(page.getByText(new RegExp(`Last confirmed by ${adminName}`))).toBeVisible();
      await ux.check('turned on', STD);
      await page.reload();
      await expect(page.getByLabel('Turn the assistant on')).toBeChecked();
      await expect(page.getByLabel('Region where data may be processed')).toHaveValue(
        'West Europe',
      );
      const changes = page.getByText(/Settings changed/).first();
      await expect(changes).toBeVisible();
      await expect(page.getByText(/Connection tested/).first()).toBeVisible();
    } finally {
      await senaiOn();
    }
  },
);

uat(
  'SX-04',
  'Turning SenAI off removes every SenAI surface',
  { on: ['D', 'A'], langs: 'EN+AZ' },
  async ({ page, ux, meta }) => {
    const v = await gBackend();
    const acc = accounts();
    const rec = await login(acc.recruiter);
    const sid = await matchOf(rec, v.id, v.documents[0]!.id);
    await senaiOn();
    try {
      const r = await senaiPut({ enabled: false });
      expect(r.status).toBe(200);
      // The admin notice.
      await openAs(page, acc.admin, '#/admin/assistant');
      await expect(
        page.getByText(
          T(meta.lang)(
            '{name} is off. Recruiters do not see it. It explains stored matches; it never scores, ranks or decides.',
            { name: 'SenAI' },
          ),
        ),
      ).toBeVisible();
      // The recruiter, who had the panel open before.
      const p2 = await page.context().browser()!.newPage();
      const flush = ux.watch(p2);
      await p2.addInitScript(
        (k) => localStorage.setItem(k, '1'),
        `cv-assistant-open:${acc.recruiter.userId ?? ''}`,
      );
      await openAs(p2, acc.recruiter, '#/vacancies');
      for (const route of [
        '#/vacancies',
        `#/vacancies/${v.id}`,
        `#/vacancies/${v.id}/results`,
        '#/candidates',
        `#/cv/${v.documents[0]!.id}`,
      ]) {
        await p2.goto(`${new URL(p2.url()).origin}/${route}`);
        await expect(p2.getByLabel(/Account menu|Hesab menyusu/)).toBeVisible();
        await p2.waitForTimeout(400);
        await expect(
          p2.getByRole('search').getByRole('textbox'),
          `${route}: no Ask bar input`,
        ).toHaveCount(0);
        await expect(
          p2.getByRole('complementary', { name: /SenAI|Assistant|Köməkçi/ }),
          `${route}: no panel`,
        ).toHaveCount(0);
        await expect(
          p2.getByText(/Ask SenAI|SenAI-dən soruşun|SenAI adlı/),
          `${route}: no Ask SenAI item`,
        ).toHaveCount(0);
        await expect(
          p2.getByText(/Links the candidate gave/),
          `${route}: no link review card`,
        ).toHaveCount(0);
      }
      await p2.getByLabel(/Account menu|Hesab menyusu/).click();
      await expect(p2.getByText(/What SenAI remembers/)).toHaveCount(0);
      flush();
      // 3) the API says it is off.
      const ask = await api(rec).post('/assistant/ask', { message: 'find candidates' });
      expect(ask.status).toBe(404);
      expect(JSON.stringify(ask.body)).toContain('The assistant is off');
      const cand = await api(rec).post(`/screenings/${sid}/assistant`, {
        intent: 'why',
        message: '',
      });
      expect(cand.status).toBe(404);
      expect(JSON.stringify(cand.body)).toContain('The assistant is off');
      await ux.check('off', [...STD, 'AZ']);
      await p2.close();
    } finally {
      await senaiOn();
    }
  },
);

uat(
  'SX-05',
  'Caps and the warning: daily, monthly, 0 and warn %',
  { on: ['D'], langs: 'EN+AZ' },
  async ({ page, ux, meta }) => {
    const v = await gBackend();
    const acc = accounts();
    const me = await freshAccount('TA_PARTNER');
    const t = await login(me);
    const a = api(t);
    await senaiOn();
    try {
      const used = (await (await adminUsage()).today) as number;
      // 1) the cap counts every model answer of the day; leave room for exactly 2 more.
      await senaiPut({ dailyCap: used + 2, warnPct: 50 });
      const docs = v.documents.slice(0, 3);
      const sids = [] as string[];
      for (const d of docs) sids.push(await matchOf(t, v.id, d.id));
      const r1 = await a.post(`/screenings/${sids[0]}/assistant`, {
        intent: 'why',
        message: '',
        language: meta.lang,
      });
      expect(r1.status).toBe(200);
      const r2 = await a.post(`/screenings/${sids[1]}/assistant`, {
        intent: 'why',
        message: '',
        language: meta.lang,
      });
      expect(r2.status).toBe(200);
      // 3) the third: the limit message, in the UI language, in the warn tone (on the CV screen).
      await openAs(page, me, `#/cv/${docs[2]!.id}`);
      const bar = page.getByRole('search').getByRole('textbox');
      await bar.press('Enter');
      const panel = page.getByRole('complementary', { name: 'SenAI' });
      await panel
        .getByRole('button', {
          name: T(meta.lang)('Explain more'),
        })
        .click();
      const limit =
        meta.lang === 'az'
          ? /gündəlik limit|bugünkü limit|limitinə çatdı/i
          : /SenAI has reached today's limit\. The results and the evidence are still here\./;
      await expect(panel.getByText(limit)).toBeVisible({ timeout: 20_000 });
      await ux.check('limit reached', [...STD, 'AZ']);
      // The admin sees the usage and the warning.
      const admin = await adminView();
      expect(admin.warn, 'usage passed 50% of the limit').toBe(true);
      // 5) cap 0: no model answer at all.
      await senaiPut({ dailyCap: 0 });
      await clearModelCalls();
      const z = await a.post(`/screenings/${sids[0]}/assistant`, {
        intent: 'missing',
        message: '',
        language: 'en',
      });
      expect(JSON.stringify(z.body)).toMatch(/reached today's limit|limit/i);
      expect((await modelCalls()).filter((c) => /second reader/.test(c.system))).toHaveLength(0);
      // 6) the page: the daily field can be emptied; warn can be typed as 50 key by key.
      await senaiPut({ dailyCap: 5, warnPct: 80 });
      const p2 = await page.context().newPage();
      await openAs(p2, acc.admin, '#/admin/assistant');
      const daily = p2.getByLabel(new RegExp(`^${T(meta.lang)('Answers per day')}`));
      await daily.click();
      await daily.press('End');
      for (let i = 0; i < 4; i++) await daily.press('Backspace');
      await expect(daily).toHaveValue('');
      const warn = p2.getByLabel(
        new RegExp(`^${T(meta.lang)('Warn me at (%)').replace(/[()%]/g, '.')}`),
      );
      await warn.click();
      await warn.press('ControlOrMeta+a');
      await warn.press('Backspace');
      await warn.pressSequentially('50');
      await expect(warn, 'warn % can be typed as 50 (SD-85)').toHaveValue('50');
      await p2.close();
    } finally {
      await senaiOn();
    }
  },
);
async function adminView() {
  return (await api(await login(accounts().admin)).get('/admin/assistant')).body as {
    warn: boolean;
    usage: { today: number; month: number };
  };
}
async function adminUsage() {
  return (await adminView()).usage;
}

uat(
  'SX-09',
  'Non-recruiter roles do not see SenAI and never cause a 403',
  { on: ['D', 'A'], langs: 'EN+AZ' },
  async ({ page, ux, meta }) => {
    await senaiOn();
    const acc = accounts();
    const since = (await db<{ now: string }>(`SELECT now()::text AS now`))[0]!.now;
    const asks: string[] = [];
    page.on('request', (r) => r.url().endsWith('/assistant/ask') && asks.push(r.url()));
    for (const who of [acc.admin, acc.governance, acc.viewer]) {
      const p = await page.context().browser()!.newPage();
      p.on('request', (r) => r.url().endsWith('/assistant/ask') && asks.push(r.url()));
      const flush = ux.watch(p);
      await openAs(p, who, '#/');
      for (const route of ['#/', '#/admin', '#/reports']) {
        await p.goto(`${new URL(p.url()).origin}/${route}`);
        await p.waitForTimeout(800);
        await expect(
          p.getByRole('search').getByRole('textbox'),
          `${who.key} ${route}: no Ask bar input`,
        ).toHaveCount(0);
        await p
          .locator('body')
          .click({ position: { x: 5, y: 300 } })
          .catch(() => undefined);
        await p.keyboard.press('/');
        await expect(
          p.getByRole('complementary', { name: 'SenAI' }),
          `${who.key}: no panel`,
        ).toHaveCount(0);
      }
      const menu = p.getByLabel(/Account menu|Hesab menyusu/);
      if (await menu.count()) {
        await menu.click();
        await expect(
          p.getByText(/What SenAI remembers|SenAI nəyi yadda saxlayır/),
          `${who.key}: no memory item`,
        ).toHaveCount(0);
      }
      flush();
      await p.close();
    }
    expect(asks, 'no POST /assistant/ask from these roles').toHaveLength(0);
    // 3) lead gets answers and the memory item.
    const lead = await freshAccount('TA_LEAD');
    await openAs(page, lead, '#/vacancies');
    const bar = page.getByRole('search').getByRole('textbox');
    await bar.fill('find candidates');
    await bar.press('Enter');
    const panel = page.getByRole('complementary', { name: 'SenAI' });
    await expect(panel.locator('[data-answer]').first()).toBeVisible({ timeout: 20_000 });
    await page
      .getByLabel(meta.lang === 'az' ? /Hesab menyusu|Account menu/ : 'Account menu')
      .click();
    await expect(
      page.getByText(meta.lang === 'az' ? 'SenAI nəyi yadda saxlayır' : 'What SenAI remembers'),
    ).toBeVisible();
    await ux.check('lead', [...STD, 'AZ']);
    // 4) the recruiter on the admin page.
    const p3 = await page.context().newPage();
    await openAs(p3, acc.recruiter, '#/admin/assistant');
    await expect(
      p3.getByText(
        meta.lang === 'az' ? /Yalnız administratorlar|Administrators only/ : 'Administrators only.',
      ),
    ).toBeVisible();
    await p3.close();
    // 5) no access.denied row caused by SenAI for any role.
    const denied = await db(
      `SELECT 1 FROM audit_event WHERE action='access.denied' AND occurred_at >= $1::timestamptz AND (after::text ILIKE '%assistant%' OR before::text ILIKE '%assistant%')`,
      [since],
    );
    expect(denied, 'no access.denied from SenAI').toHaveLength(0);
  },
);

uat(
  'SX-10',
  'Chat privacy between recruiter and recruiter2',
  { on: ['D'], langs: 'EN' },
  async ({ page, ux }) => {
    await senaiOn();
    const v = await gBackend();
    const A = await freshAccount('TA_PARTNER');
    const B = await freshAccount('TA_PARTNER');
    const L = await freshAccount('TA_LEAD');
    const ta = await login(A);
    const a = api(ta);
    let cid = '';
    for (const q of ['who knows Excel', `find candidates for ${v.title}`, 'only Strong']) {
      const r = await a.post('/assistant/ask', {
        message: q,
        conversationId: cid || undefined,
        vacancyId: v.id,
      });
      expect(r.status).toBe(200);
      cid = r.body.conversationId;
    }
    const sid = await matchOf(ta, v.id, v.documents[0]!.id);
    for (const q of ['Why is BGP found?', 'What is missing?'])
      expect(
        (
          await a.post(`/screenings/${sid}/assistant`, {
            intent: 'ask',
            message: q,
            language: 'en',
          })
        ).status,
      ).toBe(200);
    for (const other of [B, L]) {
      const o = api(await login(other));
      const list = (await o.get('/assistant/conversations')).body as { id: string }[];
      expect(
        list.map((c) => c.id),
        `${other.roles[0]}: none of A's chats`,
      ).not.toContain(cid);
      expect((await o.get(`/assistant/conversations/${cid}`)).status).toBe(404);
      expect((await o.del(`/assistant/conversations/${cid}`)).status).toBe(404);
      expect((await a.get(`/assistant/conversations/${cid}`)).status, "A's chat still exists").toBe(
        200,
      );
      const thread = (await o.get(`/screenings/${sid}/assistant`)).body as {
        thread: { messages: unknown[] } | null;
      };
      expect(
        thread.thread?.messages ?? [],
        `${other.roles[0]}: an empty candidate thread`,
      ).toHaveLength(0);
      const recall = (
        await o.post('/assistant/ask', { message: 'what did we conclude about Excel' })
      ).body.answer;
      expect(recall.headline).toMatch(/^I found nothing in your earlier conversations/);
    }
    // The compliance lines in both panels.
    await openAs(page, B, `#/cv/${v.documents[0]!.id}`);
    await page.getByRole('search').getByRole('textbox').press('Enter');
    const cand = page.getByRole('complementary', { name: 'SenAI' });
    await expect(
      cand.getByText('Chats are saved to this run and may be reviewed for compliance.'),
    ).toBeVisible();
    await expect(cand.locator('p.ml-8'), "B sees none of A's messages").toHaveCount(0);
    await page.goto(page.url().replace(/#.*$/, '#/vacancies'));
    const pool = page.getByRole('complementary', { name: 'SenAI' });
    await expect(
      pool.getByText('Chats are private to you and may be reviewed for compliance.'),
    ).toBeVisible();
    await ux.check('privacy', STD);
  },
);

uat(
  'SX-11',
  'Names and contact details never reach the model (fake AI records every prompt)',
  { on: ['D'], langs: 'EN+AZ', timeout: 120_000 },
  async ({ meta }) => {
    await senaiOn();
    const v = await gBackend();
    const t = await login(accounts().recruiter);
    const a = api(t);
    const manifest = JSON.parse(readFileSync(join(UAT_DIR, 'resumes/manifest.json'), 'utf8')) as {
      resumes: { file: string; mustNotLeak: string[] }[];
    };
    const rows = (await a.get(`/candidates?vacancy=${v.id}&limit=50`)).body.rows as {
      matchId: string;
      documentId: string;
    }[];
    await clearModelCalls();
    // 1) Explain more on each CV.
    for (const r of rows.filter((x) => x.matchId))
      await a.post(`/screenings/${r.matchId}/assistant`, {
        intent: 'why',
        message: '',
        language: meta.lang,
      });
    const aysel = rows.find(
      (r) => r.documentId === v.documents.find((d) => d.filename.startsWith('01-'))!.id,
    )!;
    // 2-3) names and an e-mail typed in a question.
    await a.post(`/screenings/${aysel.matchId}/assistant`, {
      intent: 'ask',
      message: 'Is Aysel Mammadova stronger than Rəşad Əliyev at SQL? Mail aysel.m@example.com',
      language: meta.lang,
    });
    await a.post(`/screenings/${aysel.matchId}/assistant`, {
      intent: 'ask',
      message: 'Is Məmmədova good at SQL?',
      language: meta.lang,
    });
    // 4-5) the pool reader, with a follow-up so the last messages are sent too.
    const p1 = await a.post('/assistant/ask', {
      message: `compare Aysel Mammadova and Leyla Hasanova on SQL and English for ${v.title} please`,
      language: meta.lang,
    });
    await a.post('/assistant/ask', {
      message: 'and what about their Python and Kubernetes experience in production',
      conversationId: p1.body.conversationId,
      language: meta.lang,
    });
    const calls = await modelCalls();
    expect(calls.length, 'the model was called').toBeGreaterThan(0);
    const fold = (s: string) =>
      s.toLowerCase().normalize('NFKD').replace(/ə/g, 'e').replace(/ı/g, 'i').replace(/[̀-ͯ]/g, '');
    const all = calls.map((c) => `${c.system}\n${c.user}`);
    const leaks: string[] = [];
    for (const r of manifest.resumes)
      for (const s of r.mustNotLeak) {
        if (s.length < 4) continue;
        const re = new RegExp(
          `(?<![\\p{L}])${fold(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`,
          'u',
        );
        if (all.some((x) => re.test(fold(x)))) leaks.push(`${r.file}: ${s}`);
      }
    for (const s of [
      'Aysel Mammadova',
      'Mammadova',
      'Məmmədova',
      'Rəşad Əliyev',
      'Leyla Hasanova',
      'aysel.m@example.com',
    ])
      if (all.some((x) => fold(x).includes(fold(s)))) leaks.push(`typed: ${s}`);
    expect(leaks, 'no name or contact detail reaches the model').toEqual([]);
    // The payload log shows 'all allowed' for each call.
    const log = (await api(await login(accounts().admin)).get('/admin/assistant/payloads'))
      .body as { calls: { violations: string[] }[] };
    expect(log.calls.slice(0, 5).every((c) => (c.violations ?? []).length === 0)).toBe(true);
  },
);

void senaiSettings;

// ================================================================ SX-02, SX-03, SX-06, SX-07
// The question reader of the fake AI answers with a typed query only while `setReader(true)` is on
// (fullstack/fake-ai.mjs); it is switched off again at the end of each case.

const READER_PROMPT = "You read a recruiter's message";
/** More than four words once the vacancy's title is cut out: the rules alone do not answer it (the plain-words limit). */
const LONG = (title: string) => `please find all the best candidates for ${title} and show them`;
const readerCalls = async () =>
  (await modelCalls()).filter((c) => c.system.startsWith(READER_PROMPT));
type PoolAns = {
  kind: string;
  rows: { documentId: string }[];
  notes: string[];
  flags: string[];
  skills?: string[];
  receipt?: { by: string };
};
async function poolAsk(token: string, message: string): Promise<PoolAns> {
  const r = await api(token).post('/assistant/ask', { message, language: 'en' });
  expect(r.status, `ask "${message}" → ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`).toBe(
    200,
  );
  return r.body.answer as PoolAns;
}
/** A second model row of the fake company: the "faster reader" of SX-02. */
async function readerRow(): Promise<{ id: string; modelId: string }> {
  const admin = api(await login(accounts().admin));
  type Conn = { id: string; models: { id: string; modelId: string }[] };
  const conn = (await admin.get('/admin/ai')).body.connections[0] as Conn;
  let row = conn.models.find((m) => m.modelId === 'claude-fake-2');
  if (!row) {
    const add = await admin.post(`/admin/ai/connections/${conn.id}/models`, {
      models: [{ modelId: 'claude-fake-2', label: 'Claude Fake 2 (UAT)' }],
    });
    expect(add.status).toBeLessThan(300);
    row = ((await admin.get('/admin/ai')).body.connections[0] as Conn).models.find(
      (m) => m.modelId === 'claude-fake-2',
    )!;
  }
  return row;
}
/** The card of the Admin > Assistant page with this heading. */
const cardOf = (p: import('@playwright/test').Page, heading: string) =>
  p.getByRole('heading', { name: heading, exact: true }).locator('xpath=ancestor::section[1]');

uat(
  'SX-02',
  'Name, reader model and the unavailable message',
  { on: ['D', 'A'], langs: 'EN+AZ', timeout: 240_000 },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const acc = accounts();
    const v = await gBackend();
    const rec = await login(acc.recruiter);
    const before = await senaiSettings();
    await senaiOn();
    await setAi('scripted');
    await setReader(true);
    const reader = await readerRow();
    const MSG = 'Elon is resting. The results are still here.';
    const ap = await page.context().newPage();
    const flush = ux.watch(ap);
    try {
      // 1) Rename to 'Elon' and Save.
      await openAs(ap, acc.admin, '#/admin/assistant');
      const name = ap.getByLabel(t('Name (working name, can change any time)'));
      const save = ap.getByRole('button', { name: t('Save'), exact: true });
      await name.fill('Elon');
      await save.click();
      await expect(ap.getByText(t('Saved.'), { exact: true })).toBeVisible();
      await expect(ap.getByText(t('{name} is on for recruiters.', { name: 'Elon' }))).toBeVisible();
      expect((await senaiSettings()).name).toBe('Elon');
      // 2) 31 characters cannot be typed (nor sent); an empty name is refused with a reason.
      await name.clear();
      await name.pressSequentially('E'.repeat(31));
      await expect(name).toHaveValue('E'.repeat(30));
      expect((await senaiPut({ name: 'E'.repeat(31) })).status).toBe(400);
      await name.clear();
      await save.click();
      await expect(
        ap.getByText(t('Give the assistant a name (up to 30 characters).')),
      ).toBeVisible();
      expect((await senaiPut({ name: '' })).status).toBe(400);
      expect((await senaiSettings()).name, 'the refused names changed nothing').toBe('Elon');

      // 3) The recruiter, on a fresh load: every label carries the new name.
      await openAs(page, acc.recruiter, '#/vacancies');
      const bar = page.getByRole('search').getByRole('textbox');
      await expect(bar).toHaveAttribute('placeholder', /^Elon: /);
      await expect(
        page.getByRole('search').getByText(t('Ask {name}', { name: 'Elon' })),
      ).toBeAttached();
      if ((page.viewportSize()?.width ?? 1280) < 640)
        await expect(
          page
            .getByRole('button', { name: t('Ask {name}', { name: 'Elon' }) })
            .filter({ visible: true })
            .last(),
        ).toBeVisible();
      await page.getByLabel(/Account menu|Hesab menyusu/).click();
      await expect(page.getByText(t('What {name} remembers', { name: 'Elon' }))).toBeVisible();
      await page.getByLabel(/Account menu|Hesab menyusu/).click();
      await bar.fill(`find candidates for ${v.title}`);
      await bar.press('Enter');
      const panel = page.getByRole('complementary', { name: 'Elon' });
      await expect(panel).toBeVisible();
      await expect(panel.getByRole('heading', { name: 'Elon' })).toBeVisible();
      await expect(
        page.getByText(t('{name} has answered.', { name: 'Elon' })),
        'announced with the new name',
      ).toBeAttached({ timeout: 30_000 });
      await ux.check('pool panel', [...STD, 'AZ']);
      await page.keyboard.press('Escape');
      await page.goto(`${new URL(page.url()).origin}/#/vacancies/${v.id}/results`);
      const cards = page.locator(`section[aria-label="${t('Candidates')}"] > article`);
      await cards.nth(1).getByRole('button').first().click();
      await cards
        .nth(1)
        .getByRole('button', { name: t('Ask {name} about this candidate', { name: 'Elon' }) })
        .click();
      await expect(page.getByRole('complementary', { name: 'Elon' })).toBeVisible();
      await ux.check('candidate panel', [...STD, 'AZ']);
      await page.keyboard.press('Escape');

      // 4) The faster reader model: a long question is read by that row.
      await ap.reload();
      await ap
        .getByLabel(t('Faster model for reading questions (optional)'))
        .selectOption(reader.id);
      await ap.getByRole('button', { name: t('Save'), exact: true }).click();
      await expect(ap.getByText(t('Saved.'), { exact: true })).toBeVisible();
      expect((await senaiSettings()).understandModelRowId).toBe(reader.id);
      await clearModelCalls();
      const ans = await poolAsk(rec, LONG(v.title));
      const got = await readerCalls();
      expect(got.length, 'the reader row received the question').toBeGreaterThan(0);
      expect(
        got.map((c) => c.model),
        'only the reader row read it',
      ).toEqual(got.map(() => 'claude-fake-2'));
      expect(ans.receipt?.by).toBe('model');

      // 5) The message shown when SenAI is unavailable.
      await ap.getByLabel(t('Message when it is unavailable')).fill(MSG);
      await ap.getByRole('button', { name: t('Save'), exact: true }).click();
      await expect(ap.getByText(t('Saved.'), { exact: true })).toBeVisible();
      expect((await senaiSettings()).unavailableMessage).toBe(MSG);

      // 6) The AI fails every call: 'Explain more' shows that message, in the warn tone.
      await setAi('fail');
      await page.goto(`${new URL(page.url()).origin}/#/cv/${v.documents[3]!.id}`);
      await page.getByRole('search').getByRole('textbox').press('Enter');
      const cvPanel = page.getByRole('complementary', { name: 'Elon' });
      await cvPanel.getByRole('button', { name: t('Explain more'), exact: true }).click();
      await expect(cvPanel.getByText(MSG)).toBeVisible({ timeout: 30_000 });
      await expect(
        cvPanel.locator('div.bg-warn').filter({ hasText: MSG }),
        'in the warn tone',
      ).toBeVisible();
      expect(await cvPanel.innerText()).not.toMatch(/\bat \S+ \(|TypeError|Error:|ECONN|stack/i);
      await ux.check('unavailable', [...STD, 'AZ']);
      flush();
    } finally {
      await setAi('scripted');
      await setReader(false);
      await senaiPut({
        name: before.name,
        understandModelRowId: before.understandModelRowId,
        unavailableMessage: before.unavailableMessage,
      });
      await senaiOn();
    }
  },
);

uat(
  'SX-03',
  'Function switches change the panels after a reload and the API refuses switched-off calls',
  { on: ['D'], langs: 'EN+AZ', timeout: 240_000 },
  async ({ page, ux, meta }) => {
    const t = T(meta.lang);
    const acc = accounts();
    const v = await gBackend();
    const rec = await login(acc.recruiter);
    const sid = await matchOf(rec, v.id, v.documents[0]!.id);
    await senaiOn();
    await setAi('scripted');
    await setReader(true);
    const ap = await page.context().newPage();
    const flush = ux.watch(ap);
    const switchTo = async (label: string, on: boolean) => {
      const box = ap.getByRole('checkbox', { name: t(label), exact: true });
      await (on ? box.check() : box.uncheck());
      await ap.getByRole('button', { name: t('Save'), exact: true }).click();
      await expect(ap.getByText(t('Saved.'), { exact: true })).toBeVisible();
    };
    // The Changes list keeps the newest 30, so the rows are counted where they are written.
    const saved = async () =>
      (
        await db<{ n: number }>(
          `SELECT count(*)::int AS n FROM audit_event WHERE action = 'assistant.setting_changed'`,
        )
      )[0]!.n;
    const newest = () => cardOf(ap, t('Changes')).getByRole('listitem').first();
    const chips = page.getByRole('list', { name: t('Suggested questions') });
    const cv = `#/cv/${v.documents[0]!.id}`;
    const openPanel = async () => {
      await page.getByRole('search').getByRole('textbox').press('Enter');
      const panel = page.getByRole('complementary', { name: 'SenAI' });
      await expect(panel).toBeVisible();
      return panel;
    };
    try {
      await openAs(ap, acc.admin, '#/admin/assistant');
      // Before: all three chips are there (the panel is open on this CV).
      await openAs(page, acc.recruiter, cv);
      let panel = await openPanel();
      await expect(chips.getByRole('button', { name: t('Challenge this match') })).toBeVisible();
      await expect(chips.getByRole('button', { name: t('Interview questions') })).toBeVisible();
      await expect(chips.getByRole('button', { name: t('Compare with…') })).toBeVisible();
      await expect(newest()).toBeVisible();
      const n0 = await saved();

      // 1) Switch off 'Challenge this match'.
      await switchTo('Challenge this match', false);
      expect(await saved()).toBe(n0 + 1);
      await expect(newest()).toContainText(t('Settings changed'));
      // The open panel is stale: its chip still works, and the service says why it does not.
      await chips.getByRole('button', { name: t('Challenge this match') }).click();
      await panel
        .getByRole('button', { name: t('Challenge this match') })
        .first()
        .click();
      await expect(panel.getByRole('alert')).toHaveText(t('Challenge is switched off'));
      await ux.check('stale chip refused', [...STD, 'AZ']);
      // 2) After a reload there is no such chip.
      await page.reload();
      panel = await openPanel();
      await expect(chips.getByRole('button', { name: t('Explain more') })).toBeVisible();
      await expect(chips.getByRole('button', { name: t('Challenge this match') })).toHaveCount(0);
      // 3) The API refuses it.
      const ch = await api(rec).post(`/screenings/${sid}/assistant`, {
        intent: 'challenge',
        message: '',
      });
      expect(ch.status).toBe(404);
      expect(ch.body.message).toBe('Challenge is switched off');
      // 4) The same for 'Compare candidates' and 'Interview questions'.
      await switchTo('Compare candidates', false);
      await switchTo('Interview questions', false);
      await page.reload();
      panel = await openPanel();
      await expect(chips.getByRole('button', { name: t('Explain more') })).toBeVisible();
      await expect(chips.getByRole('button', { name: t('Compare with…') })).toHaveCount(0);
      await expect(chips.getByRole('button', { name: t('Interview questions') })).toHaveCount(0);
      for (const [intent, text] of [
        ['compare', 'Compare is switched off'],
        ['interview', 'Interview questions is switched off'],
      ] as const) {
        const r = await api(rec).post(`/screenings/${sid}/assistant`, {
          intent,
          message: '',
          ...(intent === 'compare' ? { compareWith: [] } : {}),
        });
        expect(r.status, intent).toBe(404);
        expect(r.body.code, intent).toBe('FEATURE_OFF');
        expect(r.body.message, intent).toBe(text);
      }
      await ux.check('three switched off', [...STD, 'AZ']);
      // 5) The model reader off: a long loose question is read by rules and no call is made.
      await switchTo('Let a model read questions the rules cannot (question text only)', false);
      await clearModelCalls();
      await page.goto(`${new URL(page.url()).origin}/#/vacancies`);
      const bar = page.getByRole('search').getByRole('textbox');
      await bar.fill(LONG(v.title));
      await bar.press('Enter');
      const pool = page.getByRole('complementary', { name: 'SenAI' });
      await expect(pool.getByText(t('How I got this'))).toBeVisible({ timeout: 30_000 });
      await pool.getByText(t('How I got this')).click();
      await expect(pool.getByText(t('Read by rules'))).toBeVisible();
      expect(await readerCalls(), 'the fake AI got no call').toHaveLength(0);
      // 6) Toggle 'Say when a question contradicts the record': each change is listed.
      const n1 = await saved();
      await switchTo('Say when a question contradicts the record', false);
      expect(await saved()).toBe(n1 + 1);
      await expect(newest()).toContainText(t('Settings changed'));
      await switchTo('Say when a question contradicts the record', true);
      expect(await saved()).toBe(n1 + 2);
      await ux.check('changes listed', [...STD, 'AZ']);
      flush();
    } finally {
      await setReader(false);
      await senaiOn();
    }
  },
);

uat(
  'SX-06',
  "Breaker and 'How SenAI is doing'",
  { on: ['D'], langs: 'EN', timeout: 240_000 },
  async ({ page, ux }) => {
    const acc = accounts();
    const v = await gBackend();
    const rec = await login(acc.recruiter);
    const admin = api(await login(acc.admin));
    await senaiOn();
    await setAi('scripted');
    await setReader(true);
    const mon = async (days: number) =>
      (await admin.get(`/admin/assistant/monitoring?days=${days}`)).body as {
        total: number;
        safeMode: number;
        readBy: { model: number };
      };
    try {
      const m0 = await mon(7);
      // 1) The AI fails; five questions of more than four words, within two minutes.
      await setAi('fail');
      const t0 = Date.now();
      for (const tail of ['today', 'now', 'quickly', 'this week', 'for me']) {
        const a = await poolAsk(rec, `${LONG(v.title)} ${tail}`);
        expect(a.rows.length, tail).toBeGreaterThan(0);
        expect(a.notes.join(' '), tail).toContain('read by fixed rules only');
        expect(a.flags, tail).toContain('safe_mode');
      }
      expect(Date.now() - t0, 'within two minutes').toBeLessThan(120_000);
      // 2) The administrator's view.
      await openAs(page, acc.admin, '#/admin/assistant');
      const card = cardOf(page, 'How SenAI is doing');
      await expect(
        card.getByText(
          'The AI reader is paused after repeated failures; questions are read by fixed rules until it recovers or you press Test.',
        ),
      ).toBeVisible();
      const dd = (label: string) =>
        card.locator('dt', { hasText: label }).locator('xpath=following-sibling::dd');
      await expect(dd('Rules only (AI unavailable)')).toHaveText(String(m0.safeMode + 5));
      // Counts only: no question text and no names.
      const names = (
        await db<{ n: string }>(
          `SELECT DISTINCT candidate_name AS n FROM screening WHERE candidate_name IS NOT NULL`,
        )
      ).map((r) => r.n);
      const text = await card.innerText();
      expect(text).not.toContain('find candidates');
      expect(text).not.toContain(v.title);
      for (const n of names) expect(text, `no name: ${n}`).not.toContain(n);
      const raw = JSON.stringify(await mon(7));
      expect(raw).not.toContain('find candidates');
      for (const n of names) expect(raw).not.toContain(n);
      await ux.check('breaker open', STD);
      // 3) The period: the counts follow it.
      for (const [label, days] of [
        ['Last 7 days', 7],
        ['Last 90 days', 90],
      ] as const) {
        await card.getByLabel('Period').selectOption({ label });
        await expect(dd('Questions')).toHaveText(String((await mon(days)).total));
      }
      // 4) The AI is healthy again: Test passes and the notice is gone after a reload.
      await setAi('scripted');
      await page.getByRole('button', { name: 'Test connection' }).click();
      await expect(page.getByText(/answered in the expected shape\./)).toBeVisible();
      await page.reload();
      await expect(dd('Questions')).toBeVisible();
      await expect(card.getByText(/The AI reader is paused after repeated failures/)).toHaveCount(
        0,
      );
      // 5) The recruiter asks again: a model reads the question.
      const again = await poolAsk(rec, LONG(v.title));
      expect(again.receipt?.by).toBe('model');
      expect(again.flags).not.toContain('safe_mode');
      await ux.check('recovered', STD);
    } finally {
      await setAi('scripted');
      await setReader(false);
      await senaiOn();
    }
  },
);

uat(
  'SX-07',
  'Words the assistant knows: add, aliases, approve, reject, remove',
  { on: ['D'], langs: 'EN', timeout: 240_000 },
  async ({ page, ux }) => {
    const acc = accounts();
    const rec = await login(acc.recruiter);
    const admin = api(await login(acc.admin));
    await senaiOn();
    await setAi('scripted');
    await setReader(false);
    // A clean dictionary of added words (owner SQL); the first add below reloads the reader from it.
    await db(`DELETE FROM assistant_skill`);
    const cv = (i: number, line: string) => ({
      name: `words-${i}.txt`,
      type: 'text/plain',
      data: `Name: Words Person ${i}\n${line}\n${'Worked on network operations and automation. '.repeat(6)}`,
    });
    const zv = await screenedVacancy(rec, {
      title: uniq('UAT Words'),
      files: [
        cv(1, 'Qorvex monitoring of the core network.'),
        cv(2, 'Built korvex dashboards for the NOC.'),
        cv(3, 'Qorvecs alerts and triggers.'),
        cv(4, 'Python scripting daily.'),
      ],
    });
    const mine = new Set(zv.documents.map((d) => d.id));
    // Two suggestions from a recruiter.
    for (const label of ['Qorvexx', 'Nelvia']) {
      const r = await api(rec).post('/assistant/skills/suggest', {
        label,
        kind: 'tool',
        aliases: [],
      });
      expect(r.status, label).toBe(200);
    }
    const rp = await page.context().newPage();
    const flush = ux.watch(rp);
    try {
      await openAs(page, acc.admin, '#/admin/assistant');
      const card = cardOf(page, 'Words the assistant knows');
      const list = card.getByRole('list', { name: 'Added words' });
      const row = (word: RegExp) => list.getByRole('listitem').filter({ hasText: word });
      // The two suggestions are there; nothing is read until approved.
      await expect(row(/^Qorvexx \(proposed/)).toBeVisible();
      await expect(row(/^Nelvia \(proposed/)).toBeVisible();
      // The tools the dictionary already has are refused, with the reason ('Zabbix' is a way to write Monitoring).
      await card.getByLabel('Skill name').fill('Zabbix');
      await card.getByRole('button', { name: 'Add word' }).click();
      await expect(card.getByText('"Zabbix" is already read as Monitoring')).toBeVisible();
      // 1) Add 'Qorvex', kind Tool, other ways 'korvex, qorvecs'.
      await card.getByLabel('Skill name').fill('Qorvex');
      await card.getByLabel('Kind').selectOption({ label: 'Tool' });
      await card
        .getByLabel('Other ways it is written (separate with commas)')
        .fill('korvex, qorvecs');
      await card.getByRole('button', { name: 'Add word' }).click();
      await expect(card.getByText('SenAI reads this word now.')).toBeVisible();
      await expect(row(/^Qorvex \(approved\)/)).toBeVisible();
      // 2) 'XLS' as another way to write the built-in 'excel'.
      await card.getByLabel('Skill name').fill('XLS');
      await card.getByLabel('Other ways it is written (separate with commas)').fill('XLS');
      await card.getByLabel(/^Only more ways to write a built-in skill\?/).fill('excel');
      await card.getByRole('button', { name: 'Add word' }).click();
      await expect(row(/^XLS \(approved, more ways to write excel\)/)).toBeVisible();
      await ux.check('words added', STD);
      // 4) Before step 3: the recruiter asks about the word, in any spelling.
      for (const q of ['who knows korvex', 'who knows qorvecs']) {
        const a = await poolAsk(rec, q);
        expect(a.skills, q).toEqual(['Qorvex']);
        expect(
          a.rows.filter((r) => mine.has(r.documentId)).length,
          `${q}: rows for any spelling`,
        ).toBe(3);
      }
      await openAs(rp, acc.recruiter, '#/vacancies');
      const bar = rp.getByRole('search').getByRole('textbox');
      await bar.fill('who knows korvex');
      await bar.press('Enter');
      await expect(
        rp
          .getByRole('complementary', { name: 'SenAI' })
          .getByRole('list', { name: 'Used for this answer' })
          .locator('li[data-chip="skill"]'),
        "a 'Qorvex' skill chip",
      ).toContainText('Qorvex', { timeout: 30_000 });
      // 3) Approve 'Qorvexx', reject 'Nelvia', remove 'Qorvex': the buttons carry the word.
      await card.getByRole('button', { name: 'Approve Qorvexx', exact: true }).click();
      await expect(row(/^Qorvexx \(approved\)/)).toBeVisible();
      await card.getByRole('button', { name: 'Reject Nelvia', exact: true }).click();
      await expect(row(/^Nelvia \(rejected\)/)).toBeVisible();
      await card.getByRole('button', { name: 'Remove Qorvex', exact: true }).click();
      await expect(row(/^Qorvex \(rejected\)/)).toBeVisible();
      // Remove can be undone: the row has an 'Approve Qorvex' button.
      await expect(card.getByRole('button', { name: 'Approve Qorvex', exact: true })).toBeVisible();
      const gone = await poolAsk(rec, 'who knows korvex');
      expect(gone.skills ?? [], 'no longer read as a skill').not.toContain('Qorvex');
      await ux.check('decided', STD);
      flush();
    } finally {
      // Everything added here is switched off again, so no other case reads these words.
      type Entry = { id: string; status: string };
      const all = (await admin.get('/admin/assistant/skills')).body as Entry[];
      for (const e of all.filter((x) => x.status !== 'rejected'))
        await admin.post(`/admin/assistant/skills/${e.id}/decide`, { to: 'rejected' });
      await senaiOn();
    }
  },
);
