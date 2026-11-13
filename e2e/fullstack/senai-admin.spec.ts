import { expect, test, uat } from '../ux/test';
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

const blocked: [string, string, string][] = [
  [
    'SX-07',
    'Words the assistant knows: add, aliases, approve, reject, remove',
    'Not built: P3, outside the time budget of package B',
  ],
  [
    'SX-12',
    'Admin > Assistant page: loading, errors, empty states and layout',
    'Not built: P3 (needs a fresh database), outside the time budget of package B',
  ],
];
for (const [id, title, why] of blocked)
  uat(id, title, { on: ['D'], langs: 'EN' }, async () => {
    test.skip(true, why);
  });

// ================================================================ package G: SX-01..06, SX-09..11
// Package G owns SenAI during its run: it switches SenAI on through the admin API (SX-01 does it
// through the page) and puts every setting back at the end of its run (fixtures/pkg-g.ts).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { senaiOn, senaiPut, senaiSettings } from '../fixtures/pkg-g';
import { STD } from '../ux/test';
import {
  clearModelCalls,
  db,
  freshAccount,
  modelCalls,
  resumeFiles,
  screenedVacancy,
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
      await expect(
        page.getByText(new RegExp(`Last confirmed by ${acc.admin.displayName}`)),
      ).toBeVisible();
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
      await expect(page.getByText(/SenAI is off\. Recruiters do not see it\./)).toBeVisible();
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
      const panel = page.getByRole('complementary', {
        name: meta.lang === 'az' ? 'Köməkçi' : 'Assistant',
      });
      await panel
        .getByRole('button', {
          name: meta.lang === 'az' ? /Ətraflı izah et|Daha çox izah/ : 'Explain more',
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
      const daily = p2.getByLabel(/Answers per day/);
      await daily.click();
      await daily.press('End');
      for (let i = 0; i < 4; i++) await daily.press('Backspace');
      await expect(daily).toHaveValue('');
      const warn = p2.getByLabel(/Warn me at/);
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
          p.getByText(/What SenAI remembers|SenAI nəyi xatırlayır/),
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
      page.getByText(
        meta.lang === 'az' ? /SenAI.*xatırla|What SenAI remembers/ : 'What SenAI remembers',
      ),
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
    const cand = page.getByRole('complementary', { name: 'Assistant' });
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

const gNotBuilt: [string, string][] = [
  ['SX-02', 'Name, reader model and the unavailable message'],
  [
    'SX-03',
    'Function switches change the panels after a reload and the API refuses switched-off calls',
  ],
  ['SX-06', "Breaker and 'How SenAI is doing'"],
];
for (const [id, title] of gNotBuilt)
  uat(id, title, { on: ['D'], langs: 'EN' }, async () => {
    test.skip(true, 'Not built: P2, outside the time budget of package G');
  });
void senaiSettings;
