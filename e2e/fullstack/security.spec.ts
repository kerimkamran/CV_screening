import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { PDF } from '../fixtures/api';
import { FILES } from '../fixtures/files';
import { wordsB } from '../fixtures/pkg-b';
import { expect, test, uat } from '../ux/test';
import {
  accounts,
  adminApi,
  api,
  BASE,
  db,
  freshAccount,
  login,
  openAs,
  outbox,
  resumeFiles,
  ROOT,
  screenedVacancy,
  signInUi,
  tempPasswordFor,
  uniq,
} from './stack';

// 7.x Security (SEC), full-stack journeys (L2). Only the local servers on 127.0.0.1 are used.

const CSP =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'";
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const LINK_USED =
  'This link has already been used or was replaced by a newer one. Ask your administrator for a new one.';

uat(
  'SEC-01',
  'Security headers from the real server',
  { on: ['D'], langs: 'EN' },
  async ({ info }) => {
    const index = await fetch(`${BASE}/`);
    const html = await index.text();
    const script = /<script[^>]+src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
    expect(script, 'main module script in index.html').toBeTruthy();
    const answers: [string, Response][] = [
      ['GET /', index],
      [`GET ${script}`, await fetch(`${BASE}${script}`)],
      ['GET /me', await fetch(`${BASE}/me`)],
      ['GET /readyz', await fetch(`${BASE}/readyz`)],
      [
        'POST /auth/login',
        await fetch(`${BASE}/auth/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{"bad":1}',
        }),
      ],
    ];
    const nodeEnvProd = false; // fullstack/server.mjs starts the API with NODE_ENV=development
    for (const [name, r] of answers) {
      const h = r.headers;
      expect.soft(h.get('content-security-policy'), name).toBe(CSP);
      expect.soft(h.get('x-frame-options'), name).toBe('DENY');
      expect.soft(h.get('x-content-type-options'), name).toBe('nosniff');
      expect.soft(h.get('referrer-policy'), name).toBe('no-referrer');
      expect.soft(h.get('x-correlation-id') ?? h.get('x-request-id'), name).toBeTruthy();
      // PLAN: the plan expects strict-transport-security on every L2 answer ("NODE_ENV production") —
      // the shared L2 server runs NODE_ENV=development, and app.factory.ts sends HSTS only in
      // production; the header is checked only when the server runs in production.
      if (nodeEnvProd)
        expect
          .soft(h.get('strict-transport-security'), name)
          .toBe('max-age=31536000; includeSubDomains');
      else
        info.annotations.push({
          type: 'PLAN',
          description: `${name}: HSTS not checked (L2 runs NODE_ENV=development); got ${h.get('strict-transport-security')}`,
        });
      if (!name.includes('/assets/'))
        expect.soft(h.get('cache-control'), name).toContain('no-store');
    }
    // 3) The L1 server (e2e/serve.mjs) sends the same CSP.
    const l1 = await fetch('http://127.0.0.1:4310/');
    expect(l1.headers.get('content-security-policy')).toBe(CSP);
  },
);

uat(
  'SEC-02',
  'No inline script and no CSP violation on any page',
  { on: ['D', 'I'], langs: 'EN', timeout: 120_000 },
  async ({ page, ux, context }) => {
    // 1) index.html as served: every script has a src and no body; no inline handlers.
    const html = await (await fetch(`${BASE}/`)).text();
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    expect(scripts.length).toBeGreaterThan(0);
    for (const [, attrs, body] of scripts) {
      expect(attrs).toMatch(/\bsrc="/);
      expect(body!.trim()).toBe('');
    }
    expect(html).toMatch(/theme-init\.js/);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);

    // 2) Listen for violations and console errors.
    const violations: string[] = [];
    const cspConsole: string[] = [];
    const hosts = new Set<string>();
    await context.addInitScript(() => {
      (window as any).__csp = [];
      document.addEventListener('securitypolicyviolation', (e) =>
        (window as any).__csp.push(`${e.violatedDirective} ${e.blockedURI}`),
      );
    });
    page.on('console', (m) => {
      if (m.type() === 'error' && /Content Security Policy|Refused to/i.test(m.text()))
        cspConsole.push(m.text());
    });
    page.on('request', (r) => hosts.add(new URL(r.url()).host));
    const collect = async (where: string) => {
      const v = await page.evaluate(() => (window as any).__csp as string[]).catch(() => []);
      for (const x of v) violations.push(`${where}: ${x}`);
      const inline = await page.evaluate(() =>
        [...document.querySelectorAll('*')].flatMap((el) =>
          [...el.attributes]
            .filter((a) => /^on/i.test(a.name))
            .map((a) => `${el.tagName} ${a.name}`),
        ),
      );
      expect(inline, `${where}: inline handlers`).toEqual([]);
    };

    // A vacancy with a PDF and a Word CV, made by admin+TA.
    const acc = accounts();
    const token = await login(acc.adminTa);
    const v = await screenedVacancy(token, {
      title: uniq('UAT SEC-02 Network Engineer'),
      files: [
        { name: 'sec02-cv.pdf', type: 'application/pdf', data: PDF },
        {
          name: 'sec02-cv.docx',
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          data: FILES.docx(),
        },
      ],
    });
    // 3) Sign in, then every page.
    await page.goto(`${BASE}/#/`);
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await collect('sign in');
    await openAs(page, acc.adminTa, '#/vacancies');
    await page.reload(); // the hash change alone does not reload the page with the session
    await expect(page.getByLabel('Account menu', { exact: true })).toBeVisible();
    const routes = [
      '#/vacancies',
      '#/candidates',
      `#/vacancies/${v.id}`,
      `#/vacancies/${v.id}/results`,
      '#/reports',
      ...v.documents.map((d) => `#/cv/${d.id}`),
      '#/admin',
      '#/admin/ai',
      '#/admin/assistant',
      '#/admin/monitoring',
      '#/admin/retention',
      '#/security',
      '#/password',
    ];
    for (const r of routes) {
      await page.goto(`${BASE}/${r}`);
      await page.waitForTimeout(r.startsWith('#/cv/') ? 3000 : 900);
      await collect(r);
    }
    expect(violations).toEqual([]);
    expect(cspConsole).toEqual([]);
    // The PDF worker and fonts come from the app's own origin: every request host is the app's.
    expect([...hosts].filter((h) => h !== new URL(BASE).host)).toEqual([]);

    // 4) The app in an iframe from another origin (the L1 server's origin, answered by the test).
    const framer = await context.newPage();
    const flush = ux.watch(framer);
    const refused: string[] = [];
    framer.on('console', (m) => {
      if (/frame-ancestors|Refused to frame/i.test(m.text())) refused.push(m.text());
    });
    await framer.route('http://127.0.0.1:4310/frame-test', (r) =>
      r.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><title>t</title><iframe id="f" src="${BASE}/#/"></iframe>`,
      }),
    );
    await framer.goto('http://127.0.0.1:4310/frame-test');
    await framer.waitForTimeout(1500);
    const child = framer.frames().find((f) => f !== framer.mainFrame());
    const loaded = child
      ? await child.evaluate(() => !!document.querySelector('#root')).catch(() => false)
      : false;
    expect(loaded, 'the app must not render inside a foreign frame').toBe(false);
    ux.allow(/frame-ancestors|Refused to frame/);
    flush();
  },
);

uat(
  'SEC-06',
  'A token past its lifetime ends the session; refresh does not lengthen it',
  { on: ['D'], langs: 'EN' },
  async () => {
    test_skip(
      'Blocked: needs its own API process started with LOCAL_SESSION_SECONDS=300 and MAX_TOKEN_LIFETIME_SECONDS=60; the shared L2 server (4320) must not be restarted and no other server may be started for this package.',
    );
  },
);

uat(
  'SEC-07',
  'Sign out ends the session for real and leaves nothing for the next person',
  { on: ['D'], langs: 'EN' },
  async ({ page, ux }) => {
    ux.allow(/401/);
    // Throwaway accounts stand in for the recruiter (dark, az saved) and recruiter2 (nothing saved).
    const r1 = await freshAccount('TA_PARTNER');
    const r2 = await freshAccount('TA_PARTNER');
    const t1 = await login(r1);
    expect(
      (await api(t1).put('/me/preferences', { background: 'dark', language: 'az' })).status,
    ).toBeLessThan(300);
    const token = await openAs(page, r1, '#/candidates');
    await expect(page.locator('html')).toHaveAttribute('data-bg', 'dark');
    await expect(page.locator('html')).toHaveAttribute('lang', 'az');
    // 1) Sign out from the account menu (Azerbaijani UI).
    await page
      .getByLabel('Hesab menyusu', { exact: true })
      .or(page.getByLabel('Account menu', { exact: true }))
      .click();
    await page.getByRole('button', { name: /^(Sign out|Çıxış)$/ }).click();
    await expect(page.getByRole('button', { name: /^(Sign in|Daxil olun)$/ })).toBeVisible();
    // 2) The token taken before sign-out is withdrawn.
    const me = await api(token).get('/me');
    expect.soft(me.status, 'GET /me with the token from before sign-out').toBe(401);
    // 3) The Sign in page: default background, browser language (en), URL #/.
    expect
      .soft(await page.locator('html').getAttribute('data-bg'), 'background after sign-out')
      .toBeNull();
    expect
      .soft(await page.locator('html').getAttribute('lang'), 'language after sign-out')
      .toBe('en');
    expect.soft(new URL(page.url()).hash, 'URL after sign-out').toBe('#/');
    await ux.check('signed out', ['OCC', 'OVL', 'OVF']);
    // 4) recruiter2 signs in on the same browser.
    await page.getByLabel(/^(Email|E-poçt)$/).fill(r2.email);
    await page.getByLabel(/^(Password|Parol)$/).fill(r2.password);
    await page.getByRole('button', { name: /^(Sign in|Daxil olun)$/ }).click();
    await expect(page.getByLabel(/^(Account menu|Hesab menyusu)$/)).toBeVisible();
    expect.soft(new URL(page.url()).hash, 'recruiter2 lands on #/').toMatch(/^#\/?$/);
    expect
      .soft(await page.locator('html').getAttribute('data-bg'), 'recruiter2 background')
      .toBeNull();
    expect.soft(await page.locator('html').getAttribute('lang'), 'recruiter2 language').toBe('en');
  },
);

uat(
  'SEC-08',
  'No AI provider key, SDK or endpoint in the browser bundle (AISEC-01)',
  { on: ['D'], langs: 'EN' },
  async ({ page, info }) => {
    // 1) PLAN: 'npm run build' is not run (the UAT never rebuilds the app); the guard runs on the built dist.
    info.annotations.push({
      type: 'PLAN',
      description:
        'npm run build not run (no rebuilds during UAT); guard:bundle run on the existing apps/web/dist',
    });
    const out = execFileSync('npm', ['run', '-s', 'guard:bundle'], { cwd: ROOT, encoding: 'utf8' });
    expect(out).toBeDefined(); // a non-zero exit throws
    // 2) Search dist for provider hosts, SDK names and key-shaped strings.
    const dist = join(ROOT, 'apps/web/dist');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(js|mjs|html|css|json|map|txt)$/.test(n)) files.push(p);
      }
    };
    walk(dist);
    const bad = [
      /api\.openai\.com/,
      /api\.anthropic\.com/,
      /generativelanguage\.googleapis\.com/,
      /openai\.azure\.com/,
      /api\.mistral\.ai/,
      /@anthropic-ai\/sdk/,
      /["']openai["']\s*[,;)]/,
      /@google\/generative-ai/,
      /sk-ant-[A-Za-z0-9_-]{20,}/,
      /sk-[A-Za-z0-9]{32,}/,
      /AIza[0-9A-Za-z_-]{35}/,
    ];
    const hits: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const re of bad) if (re.test(text)) hits.push(`${f.replace(ROOT, '')}: ${re}`);
    }
    expect(hits).toEqual([]);
    // 3) A short session (sign-in, upload, admin model page): every request goes to the app's origin.
    const hosts = new Set<string>();
    page.on('request', (r) => hosts.add(new URL(r.url()).host));
    const acc = accounts();
    const token = await login(acc.adminTa);
    const v = await screenedVacancy(token, { title: uniq('UAT SEC-08 Network Engineer') });
    await openAs(page, acc.adminTa, `#/vacancies/${v.id}`);
    await expect(page.getByLabel('Account menu', { exact: true })).toBeVisible();
    await page.goto(`${BASE}/#/admin/ai`);
    await expect(page.getByRole('heading', { name: 'Administration' })).toBeVisible();
    await page.waitForTimeout(1500);
    await page.goto(`${BASE}/#/admin/assistant`);
    await page.waitForTimeout(1500);
    expect([...hosts]).toEqual([new URL(BASE).host]);
  },
);

uat(
  'SEC-09',
  'Audit and decision tables are append-only for the app role',
  { on: ['D'], langs: 'EN' },
  async () => {
    // A session of sign-ins and a reset runs first, on a throwaway account.
    const fresh = await freshAccount('TA_PARTNER', { keepTemp: true });
    const admin = await adminApi();
    await admin.post(`/admin/users/${fresh.userId}/reset-password`);
    const temp = await tempPasswordFor(fresh.email);
    const sessionToken = await login(accounts().recruiter);
    const created = await admin.post('/admin/users', {
      email: `uat.sec09.${Date.now()}@example.az`,
      displayName: 'Sec Nine',
      role: 'TA_PARTNER',
    });
    const setupToken = created.body.setupToken as string;

    // 1) As the app login: UPDATE, DELETE and TRUNCATE are refused.
    const app = new pg.Client({
      connectionString:
        process.env.UAT_APP_URL ?? 'postgresql://cv_api:cv_api@127.0.0.1:5432/cv_uat',
    });
    await app.connect();
    try {
      for (const t of ['audit_event', 'decision']) {
        for (const sql of [
          `UPDATE ${t} SET id = id WHERE false`,
          `DELETE FROM ${t} WHERE false`,
          `TRUNCATE ${t}`,
        ]) {
          const err = await app.query(sql).then(
            () => null,
            (e: Error) => e.message,
          );
          expect(err, `${sql} as cv_api`).toMatch(/permission denied/);
        }
      }
    } finally {
      await app.end();
    }
    // 2) As the owner: the append-only triggers reject each statement (inside a transaction that is rolled back).
    const own = new pg.Client({
      connectionString: process.env.UAT_OWNER_URL ?? 'postgresql://cv:cv@127.0.0.1:5432/cv_uat',
    });
    await own.connect();
    try {
      for (const t of ['audit_event', 'decision']) {
        for (const sql of [
          `UPDATE ${t} SET id = id WHERE id = (SELECT id FROM ${t} LIMIT 1)`,
          `DELETE FROM ${t} WHERE id = (SELECT id FROM ${t} LIMIT 1)`,
        ]) {
          await own.query('BEGIN');
          const err = await own.query(sql).then(
            (r) => `no error, ${r.rowCount} rows`,
            (e: Error) => e.message,
          );
          await own.query('ROLLBACK');
          expect(err, `${sql} as owner`).not.toMatch(/^no error/);
        }
      }
    } finally {
      await own.end();
    }
    // 3) The chain is intact.
    const chain = await db<{ v: string | null }>('SELECT audit_event_verify_chain() AS v');
    expect(chain[0]!.v).toBeNull();
    // 4) No secret in the audit trail.
    const secrets = [
      accounts().recruiter.password,
      accounts().admin.password,
      temp,
      setupToken,
      sessionToken,
    ].filter(Boolean);
    const where = secrets
      .map((_, i) => `(coalesce(before::text,'') || coalesce(after::text,'')) LIKE $${i + 1}`)
      .join(' OR ');
    const n = await db<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_event WHERE ${where}`,
      secrets.map((s) => `%${s}%`),
    );
    expect(n[0]!.n).toBe(0);
  },
);

uat(
  'SEC-10',
  'A shared report is readable only by its recipients',
  { on: ['D', 'A'], langs: 'EN+AZ', timeout: 120_000 },
  async ({ page, ux, browser, meta }) => {
    ux.allow(/403|410/);
    const w = wordsB(meta);
    const tx = (en: string, _az: string) => w(en);
    const acc = accounts();
    const rt = await login(acc.recruiter);
    const v = await screenedVacancy(rt, {
      title: uniq('UAT SEC-10 Network Engineer'),
      files: resumeFiles(['01-aysel-en.txt', '02-rashad-az.txt']),
    });
    const share = await api(rt).post(`/vacancies/${v.id}/shares`, {
      viewerIds: [acc.viewer.userId],
      expiresInDays: 7,
    });
    expect(share.status, JSON.stringify(share.body)).toBe(200);
    const id = share.body.id as string;
    // 1) The viewer: 'Shared with me' lists it and the report opens.
    await openAs(page, acc.viewer, '#/reports');
    await expect(
      page.getByRole('heading', {
        name: tx('Reports shared with me', 'Mənimlə paylaşılan hesabatlar'),
      }),
    ).toBeVisible();
    await expect(page.getByText(v.title).first()).toBeVisible();
    await page.goto(`${BASE}/#/reports/${id}`);
    await expect(page.getByText(v.title).first()).toBeVisible();
    await ux.check('viewer report', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE', 'AZ']);
    // 2) recruiter2 and governance: 403, the denied page, not in their lists.
    for (const who of [acc.recruiter2, acc.governance]) {
      const t = await login(who);
      const r = await api(t).get(`/reports/${id}`);
      expect(r.status, `${who.email} GET /reports/<id>`).toBe(403);
      const mine = await api(t).get('/reports/mine');
      expect(JSON.stringify(mine.body)).not.toContain(id);
      const ctx = await browser.newContext({
        viewport: page.viewportSize()!,
        locale: meta.lang === 'az' ? 'az-AZ' : 'en-US',
      });
      const p = await ctx.newPage();
      const flush = ux.watch(p);
      await p.addInitScript((l) => localStorage.setItem('cv-lang', l), meta.lang);
      await openAs(p, who, `#/reports/${id}`);
      await expect(
        p.getByText(
          tx(
            "You don't have access to this report. Ask the recruiter.",
            'Bu hesabata girişiniz yoxdur. İşə qəbul mütəxəssisindən soruşun.',
          ),
        ),
      ).toBeVisible();
      await expect(
        p.getByRole('link', {
          name: tx('Reports shared with me', 'Mənimlə paylaşılan hesabatlar'),
        }),
      ).toBeVisible();
      flush();
      await ctx.close();
    }
    // 3) The recruiter revokes; the viewer reloads.
    expect((await api(rt).post(`/shares/${id}/revoke`, {})).status).toBeLessThan(300);
    await page.reload();
    await expect(
      page.getByText(
        tx(
          'This report is no longer available. Ask the recruiter for a new link.',
          'Bu hesabat artıq mövcud deyil. İşə qəbul mütəxəssisindən yeni keçid istəyin.',
        ),
      ),
    ).toBeVisible();
  },
);

uat(
  'SEC-11',
  'ZIP download links need no Authorization header, work once and expire',
  { on: ['D'], langs: 'EN' },
  async ({ info }) => {
    const acc = accounts();
    const rt = await login(acc.recruiter);
    const v = await screenedVacancy(rt, {
      title: uniq('UAT SEC-11 Network Engineer'),
      files: resumeFiles(['01-aysel-en.txt', '02-rashad-az.txt', '03-ivan-ru.txt']),
    });
    // 1) Two CVs. PLAN: the ticket is made through the API and fetched without any header, as the
    // browser's GET does (the UI's 'Download CVs' path is covered by the pool cases).
    info.annotations.push({
      type: 'PLAN',
      description:
        'ticket made with POST /downloads and fetched with no Authorization header (not through the pool UI)',
    });
    const t0 = Date.now();
    const made = await api(rt).post('/downloads', {
      documentIds: v.documents.slice(0, 2).map((d) => d.id),
    });
    expect(made.status).toBe(201);
    const url = made.body.url as string;
    const token = url.split('/').pop()!;
    const exp = Date.parse(made.body.expiresAt) - t0;
    expect(exp).toBeGreaterThan(115_000);
    expect(exp).toBeLessThan(125_000);
    const g = await fetch(`${BASE}${url}`);
    expect(g.status).toBe(200);
    expect(g.headers.get('content-type')).toContain('application/zip');
    expect(g.headers.get('referrer-policy')).toBe('no-referrer');
    const date = new Date().toISOString().slice(0, 10);
    expect(decodeURIComponent(g.headers.get('content-disposition') ?? '')).toContain(
      `CVs - ${v.title} - `,
    );
    expect(made.body.archiveName).toMatch(
      new RegExp(
        `^CVs - ${v.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} - \\d{4}-\\d{2}-\\d{2}\\.zip$`,
      ),
    );
    void date;
    await g.arrayBuffer();
    // 2) The same URL again; 3) an expired ticket; 4) a nonsense token.
    const GONE = 'This download link has been used or has expired. Start the download again.';
    const again = await api().get(url);
    expect(again.status).toBe(410);
    expect(again.body.message).toBe(GONE);
    const second = await api(rt).post('/downloads', { documentIds: [v.documents[2]!.id] });
    const tok2 = (second.body.url as string).split('/').pop()!;
    await db(
      `UPDATE download_ticket SET expires_at = now() - interval '1 second' WHERE token_hash = $1`,
      [sha(tok2)],
    );
    const old = await api().get(second.body.url);
    expect(old.status).toBe(410);
    expect(old.body.message).toBe(GONE);
    const abc = await api().get('/downloads/abc');
    expect(abc.status).toBe(410);
    expect(abc.body.message).toBe(GONE);
    // 5) No token in clear in the table or the API log.
    const rows = await db(`SELECT * FROM download_ticket WHERE token_hash IN ($1, $2)`, [
      sha(token),
      sha(tok2),
    ]);
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(JSON.stringify(rows)).not.toContain(tok2);
    for (const log of ['/tmp/claude-0/serve-l2.log', '/tmp/claude-0/uat-server.log', '/tmp/l2.log'])
      if (existsSync(log)) {
        const text = readFileSync(log, 'utf8');
        expect(text, log).not.toContain(token);
        expect(text, log).not.toContain(tok2);
      }
  },
);

uat(
  'SEC-12',
  'Invitation links: one use, newer replaces older, checks are throttled',
  { on: ['D'], langs: 'EN' },
  async ({ info }) => {
    const admin = await adminApi();
    const email = `uat.sec12.${Date.now().toString(36)}@example.az`;
    const c = await admin.post('/admin/users', {
      email,
      displayName: 'Sec Twelve',
      role: 'TA_PARTNER',
    });
    expect(c.status).toBe(201);
    const L1 = c.body.setupToken as string;
    const l2r = await admin.post(`/admin/users/${c.body.user.id}/setup-link`);
    expect(l2r.status).toBeLessThan(300);
    const L2 = l2r.body.setupToken as string;
    expect(L2).toBeTruthy();
    // 1) The older link is replaced.
    const chk = await api().post('/auth/setup-link/check', { token: L1 });
    expect(chk.status).toBe(400);
    expect(chk.body.message).toBe(LINK_USED);
    // 2) L2 sets a password and signs in.
    const pw = `${accounts().recruiter.password}s12`;
    const set = await api().post('/auth/setup-password', { token: L2, newPassword: pw });
    expect(set.status).toBe(200);
    expect(set.body.token).toBeTruthy();
    // 3) L2 again.
    const again = await api().post('/auth/setup-password', { token: L2, newPassword: `${pw}x` });
    expect(again.status).toBe(400);
    expect(again.body.message).toBe(LINK_USED);
    // 4) Only hashes are stored and L2 is used.
    const rows = await db<{ token_hash: string; used_at: Date | null }>(
      `SELECT token_hash, used_at FROM password_setup WHERE user_id = $1`,
      [c.body.user.id],
    );
    expect(JSON.stringify(rows)).not.toContain(L1);
    expect(JSON.stringify(rows)).not.toContain(L2);
    expect(rows.find((r) => r.token_hash === sha(L2))?.used_at).toBeTruthy();
    // 5) Blocked here: the per-address limiter is shared by every package on the L2 server (600 a minute there).
    info.annotations.push({
      type: 'Blocked',
      description:
        'step 5 (31 checks a minute → 429) needs its own API process with the default limit of 30; the shared L2 server runs 600 a minute',
    });
  },
);

uat(
  'SEC-13',
  'Five wrong passwords lock the account; 30 attempts a minute per address',
  { on: ['D'], langs: 'EN' },
  async ({ page, ux, info }) => {
    ux.allow(/401/);
    const acc = await freshAccount('TA_PARTNER');
    // 1) Five wrong passwords; 2) the right one.
    const bodies: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await api().post('/auth/login', {
        email: acc.email,
        password: `Wrong-${i}-password`,
      });
      expect(r.status).toBe(401);
      bodies.push(JSON.stringify(r.body));
    }
    const right = await api().post('/auth/login', { email: acc.email, password: acc.password });
    expect(right.status).toBe(401);
    bodies.push(JSON.stringify(right.body));
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toContain('Invalid email or password');
    // 3) locked_until ≈ now + 15 min; an 'auth.locked' row.
    const lock = await db<{ m: number }>(
      `SELECT EXTRACT(EPOCH FROM (locked_until - now()))/60 AS m FROM local_credential WHERE user_id = $1`,
      [acc.userId],
    );
    expect(Number(lock[0]!.m)).toBeGreaterThan(14);
    expect(Number(lock[0]!.m)).toBeLessThan(15.5);
    const locked = await db(
      `SELECT 1 FROM audit_event WHERE action = 'auth.locked' AND (entity_id = $1 OR actor_id = $1)`,
      [acc.userId],
    );
    expect(locked.length).toBeGreaterThan(0);
    // 4) The admin resets the password; the temporary one opens the forced change page.
    const admin = await adminApi();
    expect((await admin.post(`/admin/users/${acc.userId}/reset-password`)).status).toBeLessThan(
      300,
    );
    const temp = await tempPasswordFor(acc.email);
    await signInUi(page, { email: acc.email, password: temp });
    await expect(page.getByRole('heading', { name: 'Choose your own password' })).toBeVisible();
    await ux.check('forced change', ['OCC', 'OVL', 'OVF']);
    info.annotations.push({
      type: 'Blocked',
      description:
        'step 5 (31 sign-ins a minute → 429) needs its own API process with the default limit of 30; the shared L2 server runs 600 a minute',
    });
    void outbox;
  },
);

uat(
  'SEC-14',
  'UAT seed tooling loads accounts and data without errors',
  { on: ['D'], langs: 'EN' },
  async () => {
    test_skip(
      'Not built: P3; running scripts/uat-seed.mjs creates four more accounts and a vacancy in the shared database (time budget).',
    );
  },
);

function test_skip(reason: string) {
  test.skip(true, reason);
}
