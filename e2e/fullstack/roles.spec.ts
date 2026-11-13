import { freshAcc, loginR, openAsR } from '../fixtures/pkg-a';
import { expect, uat } from '../ux/test';
import { accounts, api, db, resumeFiles, screenedVacancy, uniq, type Res } from './stack';

// 7.5 Role matrix (RO), full-stack journeys (L2).

type Who = 'admin' | 'adminTa' | 'recruiter' | 'lead' | 'governance' | 'viewer' | 'mustChange';
const ALL: Who[] = ['admin', 'adminTa', 'recruiter', 'lead', 'governance', 'viewer', 'mustChange'];

uat('RO-07', 'API role checks for every account', { on: ['D'], langs: 'EN' }, async () => {
  const acc = accounts();
  // A temporary-password account of its own: the seeded one gets a new temporary password every
  // time any package starts the L2 run (seed.ts), so its password in accounts.json can be stale.
  const must = await freshAcc('TA_PARTNER', { keepTemp: true });
  const tokens: Record<Who, string> = {} as Record<Who, string>;
  for (const w of ALL) tokens[w] = await loginR(w === 'mustChange' ? must : acc[w]);
  const ids: Record<Who, string> = {} as Record<Who, string>;
  for (const w of ALL) ids[w] = (await api(tokens[w]).get('/me')).body.userId;
  const v = await screenedVacancy(tokens.recruiter, {
    title: uniq('RO-07 owned'),
    files: resumeFiles(['01-aysel-en.txt']),
  });
  const docId = v.documents[0]!.id;
  const since = (await db(`SELECT now() AS t`))[0].t;

  const calls: [string, string, () => unknown][] = [
    ['GET', '/me', () => undefined],
    ['GET', '/assistant/config', () => undefined],
    ['GET', '/reports/mine', () => undefined],
    ['GET', '/vacancies', () => undefined],
    ['POST', '/vacancies', () => ({ title: uniq('RO-07') })],
    ['GET', '/candidates', () => undefined],
    ['POST', '/downloads', () => ({ documentIds: [docId] })],
    ['POST', '/assistant/ask', () => ({ message: 'Who fits best?' })],
    ['GET', '/admin/users', () => undefined],
    [
      'POST',
      '/admin/users',
      () => ({
        email: `uat.ro7.${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}@example.az`,
        displayName: 'RO Seven',
        role: 'NONE',
      }),
    ],
    ['GET', '/admin/ai', () => undefined],
    ['GET', '/admin/assistant', () => undefined],
    ['GET', '/admin/assistant/audit', () => undefined],
    ['GET', '/admin/fairness', () => undefined],
    ['GET', '/admin/eval', () => undefined],
    // PLAN: a valid body would start a real paired-CV run in the shared stack. The role check runs
    // before the body is read, so an invalid body answers 400 when the role is allowed and 403 when not.
    ['POST', '/admin/eval/paired', () => ({ arms: ['nope'] })],
    ['GET', '/admin/retention', () => undefined],
  ];
  const send = (token: string | undefined, m: string, p: string, body: unknown): Promise<Res> =>
    m === 'GET' ? api(token).get(p) : api(token).post(p, body ?? {});

  // With no token every call answers 401.
  for (const [m, p, b] of calls)
    expect.soft((await send(undefined, m, p, b())).status, `no token: ${m} ${p}`).toBe(401);

  const TA: Who[] = ['recruiter', 'lead', 'adminTa'];
  const ADMINS: Who[] = ['admin', 'adminTa'];
  const OVERSIGHT: Who[] = ['admin', 'adminTa', 'governance'];
  const allowed = (w: Who, m: string, p: string): boolean => {
    const k = `${m} ${p}`;
    if (['GET /me', 'GET /assistant/config', 'GET /reports/mine'].includes(k)) return true;
    if (w === 'mustChange') return false;
    if (k === 'GET /vacancies' || k === 'GET /candidates')
      return TA.includes(w) || w === 'governance';
    if (['POST /vacancies', 'POST /downloads', 'POST /assistant/ask'].includes(k))
      return TA.includes(w);
    if (
      [
        'GET /admin/users',
        'POST /admin/users',
        'GET /admin/ai',
        'GET /admin/assistant',
        'POST /admin/eval/paired',
      ].includes(k)
    )
      return ADMINS.includes(w);
    if (
      [
        'GET /admin/fairness',
        'GET /admin/eval',
        'GET /admin/retention',
        'GET /admin/assistant/audit',
      ].includes(k)
    )
      return OVERSIGHT.includes(w);
    return false;
  };
  const roleDenied: Record<Who, string[]> = {
    admin: [],
    adminTa: [],
    recruiter: [],
    lead: [],
    governance: [],
    viewer: [],
    mustChange: [],
  };
  for (const w of ALL) {
    for (const [m, p, b] of calls) {
      const r = await send(tokens[w], m, p, b());
      const what = `${w}: ${m} ${p} → ${r.status} ${JSON.stringify(r.body).slice(0, 80)}`;
      if (allowed(w, m, p)) {
        if (m === 'POST' && p === '/assistant/ask')
          // PLAN: '2xx' — SenAI is off in the shared stack and enabling it would change other packages'
          // runs; the role check is passed when the answer is 2xx or the 404 'ASSISTANT_OFF'.
          expect
            .soft(r.status < 300 || (r.status === 404 && r.body?.code === 'ASSISTANT_OFF'), what)
            .toBe(true);
        else if (p === '/admin/eval/paired') expect.soft(r.status, what).toBe(400);
        else expect.soft(r.status, what).toBeLessThan(300);
      } else if (w === 'mustChange') {
        expect.soft(r.status, what).toBe(403);
        expect.soft(r.body?.code, what).toBe('PASSWORD_CHANGE_REQUIRED');
      } else {
        expect.soft(r.status, what).toBe(403);
        if (r.status === 403) roleDenied[w].push(`${m} ${p}`);
      }
    }
  }
  // Each role-based 403 adds exactly one 'access.denied' row naming the method and path; the
  // temporary-password 403s add none.
  for (const w of ALL) {
    const rows = await db<{ m: string; p: string }>(
      `SELECT after->>'method' AS m, after->>'resource' AS p FROM audit_event WHERE action = 'access.denied' AND actor_id = $1 AND occurred_at >= $2`,
      [ids[w], since],
    );
    const got = rows.map((r) => `${r.m} ${r.p}`).sort();
    expect.soft(got, `${w}: access.denied rows`).toEqual([...roleDenied[w]].sort());
  }
});

uat(
  'RO-08',
  'Governance cannot change retention, erase files or set holds',
  { on: ['D'], langs: 'EN' },
  async ({ page, ux }) => {
    const acc = accounts();
    const gov = api(await loginR(acc.governance));
    const admin = api(await loginR(acc.admin));
    const govId = (await gov.get('/me')).body.userId as string;
    // PLAN: 'one vacancy with old CVs' — the tests may not write the database, so the CVs are new;
    // the checks still show whether governance could change the setting, run a purge or set a hold.
    const v = await screenedVacancy(await loginR(acc.recruiter), {
      title: uniq('RO-08 retention'),
      files: resumeFiles(['02-rashad-az.txt']),
    });
    const setting = async () =>
      (
        await db<{ enabled: boolean; days: number }>(
          `SELECT enabled, days FROM retention_setting WHERE id = 1`,
        )
      )[0] ?? { enabled: false, days: 180 };
    const certs = async () =>
      (await db<{ n: number }>(`SELECT count(*)::int AS n FROM retention_certificate`))[0]!.n;
    const hold = async () =>
      (await db<{ h: boolean }>(`SELECT legal_hold AS h FROM vacancy WHERE id = $1`, [v.id]))[0]!.h;
    const erased = async () =>
      (
        await db<{ n: number }>(
          `SELECT count(*)::int AS n FROM cv_document WHERE vacancy_id = $1 AND erased_at IS NOT NULL`,
          [v.id],
        )
      )[0]!.n;
    const before = await setting();
    const certsBefore = await certs();
    const since = (await db(`SELECT now() AS t`))[0].t;
    let r1: Res | undefined, r2: Res | undefined, r3: Res | undefined, r4: Res | undefined;
    let afterSetting = before;
    let afterHold = false;
    let certsAfter = certsBefore;
    try {
      r1 = await gov.put('/admin/retention', { enabled: true, days: 30 });
      afterSetting = await setting();
      // A changed setting would apply to every package's data: put it back at once.
      if (afterSetting.enabled !== before.enabled || afterSetting.days !== before.days)
        await admin.put('/admin/retention', before);
      r2 = await gov.post('/admin/retention/run', { dryRun: false });
      certsAfter = await certs();
      r3 = await gov.put(`/admin/vacancies/${v.id}/legal-hold`, { hold: true, matter: 'GOV-1' });
      afterHold = await hold();
      r4 = await gov.get('/admin/retention');
    } finally {
      const s = await setting();
      if (s.enabled !== before.enabled || s.days !== before.days)
        await admin.put('/admin/retention', before);
      if (await hold()) await admin.put(`/admin/vacancies/${v.id}/legal-hold`, { hold: false });
    }
    expect.soft(r1!.status, 'PUT /admin/retention as governance').toBe(403);
    expect.soft(r2!.status, 'POST /admin/retention/run as governance').toBe(403);
    expect.soft(r3!.status, 'PUT legal-hold as governance').toBe(403);
    expect(r4!.status, 'GET /admin/retention as governance (reading is allowed)').toBe(200);
    expect.soft(afterSetting, 'the retention setting is unchanged').toEqual(before);
    expect.soft(afterHold, 'no legal hold was set').toBe(false);
    expect.soft(certsAfter, 'no new deletion certificate').toBe(certsBefore);
    expect.soft(await erased(), 'no file erased').toBe(0);
    const denied = await db<{ m: string; p: string }>(
      `SELECT after->>'method' AS m, after->>'resource' AS p FROM audit_event WHERE action = 'access.denied' AND actor_id = $1 AND occurred_at >= $2 ORDER BY seq`,
      [govId, since],
    );
    expect
      .soft(
        denied.map((d) => `${d.m} ${d.p}`),
        'access.denied rows for the three refused calls',
      )
      .toEqual([
        'PUT /admin/retention',
        'POST /admin/retention/run',
        `PUT /admin/vacancies/${v.id}/legal-hold`,
      ]);
    // 6) The browser.
    await openAsR(page, acc.governance, '#/admin/retention');
    await expect(page.getByRole('alert').filter({ hasText: 'Administrators only.' })).toBeVisible();
    await ux.check('governance on retention', ['OCC', 'OVL', 'OVF', 'TGT', 'AXE']);
  },
);
