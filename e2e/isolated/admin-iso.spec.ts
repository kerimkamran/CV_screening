import { expect, uat } from '../ux/test';
import {
  accounts,
  adminApi,
  api,
  db,
  login,
  openAs,
  resumeFiles,
  screenedVacancy,
  uniq,
} from '../fullstack/stack';

// 7.x Administration (AD), isolated stack (L2 on its own API and database, see
// playwright.iso.config.ts): cases that change global settings. Run alone, in this order.

const FAKE_KEY = 'fake-key-0001';

uat(
  'AD-19',
  'Data retention for real: preview, hold, erase and certificate',
  { on: ['D'], langs: 'EN' },
  async ({ page, ux }) => {
    const acc = accounts();
    const rec = await login(acc.recruiter);
    const names = resumeFiles();
    const A = await screenedVacancy(rec, {
      title: uniq('UAT Retention A'),
      files: names.slice(0, 3),
    });
    const B = await screenedVacancy(rec, {
      title: uniq('UAT Retention B'),
      files: names.slice(3, 5),
    });
    expect(A.documents).toHaveLength(3);
    expect(B.documents).toHaveLength(2);
    // Owner SQL: the CVs of both vacancies were uploaded 60 days ago.
    await db(
      `UPDATE cv_document SET uploaded_at = now() - interval '60 days' WHERE vacancy_id = ANY($1::text[])`,
      [[A.id, B.id]],
    );
    // Clean slate (owner SQL, isolated stack only): files and holds left by an earlier run of this
    // case must not count, so exactly these five are due and no other vacancy is under hold.
    await db(
      `UPDATE cv_document SET uploaded_at = now()
        WHERE erased_at IS NULL AND NOT (vacancy_id = ANY($1::text[]))`,
      [[A.id, B.id]],
    );
    await db(
      `UPDATE vacancy SET legal_hold = false, legal_hold_matter = NULL, legal_hold_by = NULL, legal_hold_at = NULL
        WHERE legal_hold AND NOT (id::text = ANY($1::text[]))`,
      [[A.id, B.id]],
    );
    await openAs(page, acc.admin, '#/admin/retention');
    const days = page.getByLabel(/^Keep CV files for/);
    await expect(days).toBeVisible();
    // 1) Keep CV files for 30 days, Save.
    await days.fill('30');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
    await expect(page.getByText(/Right now: 5 file\(s\) older than 30 days/)).toBeVisible();
    const certs0 = (await db(`SELECT id FROM retention_certificate`)).length;
    // 2) Preview.
    const preview = page.getByRole('button', { name: 'Preview what would be erased' });
    await preview.click();
    await expect(
      page.getByText('Preview: 5 file(s) would be erased; 0 kept because of a legal hold.'),
    ).toBeVisible();
    // 3) Hold 'HR-2026-07' on B.
    await page.getByLabel(`Matter reference for ${B.title}`).fill('HR-2026-07');
    await page
      .getByRole('row')
      .filter({ hasText: B.title })
      .getByRole('button', { name: 'Place hold' })
      .click();
    await expect(page.getByRole('row').filter({ hasText: B.title })).toContainText('HR-2026-07');
    // 4) Preview again.
    await preview.click();
    await expect(
      page.getByText('Preview: 3 file(s) would be erased; 2 kept because of a legal hold.'),
    ).toBeVisible();
    // The previews write no certificate.
    expect((await db(`SELECT id FROM retention_certificate`)).length).toBe(certs0);
    await ux.check('retention before erase');
    // 5) Erase now (confirm in the page's own box).
    await page.getByRole('button', { name: 'Erase expired files now' }).click();
    const box = page.getByRole('alertdialog', { name: 'Erase expired files' });
    await expect(box).toContainText('Erase 3 files now? This cannot be undone.');
    await box.getByRole('button', { name: 'Yes, erase now' }).click();
    await expect(
      page.getByText('Done: 3 file(s) erased; 2 kept because of a legal hold.'),
    ).toBeVisible();
    const state = await db<{ vacancy_id: string; erased: boolean }>(
      `SELECT vacancy_id, (erased_at IS NOT NULL) AS erased FROM cv_document WHERE vacancy_id = ANY($1::text[])`,
      [[A.id, B.id]],
    );
    expect(state.filter((d) => d.vacancy_id === A.id && d.erased)).toHaveLength(3);
    expect(state.filter((d) => d.vacancy_id === B.id && d.erased)).toHaveLength(0);
    // The certificate table gains exactly one row.
    const certs = await db<{
      id: string;
      days: number;
      documents: number;
      held_back: number;
      trigger: string;
    }>(`SELECT id, days, documents, held_back, trigger FROM retention_certificate ORDER BY run_at`);
    expect(certs.length).toBe(certs0 + 1);
    const cert = certs.at(-1)!;
    expect([cert.days, cert.documents, cert.held_back, cert.trigger]).toEqual([30, 3, 2, 'manual']);
    const certRow = page.getByRole('table', { name: 'Deletion certificates' }).getByRole('row');
    const row = certRow.filter({ hasText: cert.id });
    await expect(row).toHaveCount(1);
    const adminName = ((await (await adminApi()).get('/me')).body.displayName ??
      'Administrator') as string;
    expect(adminName.length).toBeGreaterThan(0);
    await expect(row).toContainText(adminName);
    await expect(row).toContainText('30 days');
    await expect(row.getByRole('cell').nth(3)).toHaveText('3');
    await expect(row.getByRole('cell').nth(4)).toHaveText('2');
    // Audit: one document.purge per erased file, one retention.run for the certificate.
    const purges = await db<{ entity_id: string }>(
      `SELECT entity_id FROM audit_event WHERE action = 'document.purge' AND entity_id = ANY($1::text[])`,
      [A.documents.map((d) => d.id)],
    );
    expect(purges.map((p) => p.entity_id).sort()).toEqual(A.documents.map((d) => d.id).sort());
    const runs = await db(
      `SELECT 1 FROM audit_event WHERE action = 'retention.run' AND entity_id = $1`,
      [cert.id],
    );
    expect(runs).toHaveLength(1);
    // 6) Lift the hold on B: '—' under Hold.
    await page
      .getByRole('row')
      .filter({ hasText: B.title })
      .getByRole('button', { name: 'Lift hold' })
      .click();
    await expect(
      page.getByRole('row').filter({ hasText: B.title }).getByRole('cell').nth(2),
    ).toHaveText('—');
    await ux.check('retention after erase');
    // Put the global setting back so no later case on this stack sees a 30-day period.
    await (await adminApi()).put('/admin/retention', { enabled: false, days: 180 });
  },
);

uat(
  'AD-22',
  'The last active administrator can never be removed, also by two admins at the same moment',
  { on: ['D'], langs: 'EN' },
  async ({ page, ux }) => {
    const acc = accounts();
    const a1 = api(await login(acc.admin));
    const a2 = api(await login(acc.adminTa));
    const id1 = (await a1.get('/me')).body.userId as string;
    const id2 = (await a2.get('/me')).body.userId as string;
    const active = async () =>
      (
        await db<{ n: number }>(
          `SELECT count(*)::int AS n FROM role_assignment r JOIN app_user u ON u.id = r.user_id
            WHERE r.role = 'ADMIN' AND r.revoked_at IS NULL AND u.status = 'active'`,
        )
      )[0]!.n;
    expect(await active()).toBe(2);
    const before = (await db(`SELECT 1 FROM audit_event WHERE action = 'role.revoke'`)).length;
    // 1) Both at once.
    const [r1, r2] = await Promise.all([
      a1.del(`/admin/users/${id2}/roles/ADMIN`),
      a2.del(`/admin/users/${id1}/roles/ADMIN`),
    ]);
    const codes = [r1.status, r2.status].sort();
    expect(codes.filter((c) => c < 300)).toHaveLength(1);
    const loser = r1.status < 300 ? r2 : r1;
    expect([409, 403]).toContain(loser.status);
    if (loser.status === 409)
      expect(loser.body.message).toBe('cannot revoke the last active ADMIN');
    // 2) The one who is still an administrator cannot remove their own role.
    const survivor =
      r1.status < 300
        ? { api: a1, id: id1, acc: acc.admin }
        : { api: a2, id: id2, acc: acc.adminTa };
    const own = await survivor.api.del(`/admin/users/${survivor.id}/roles/ADMIN`);
    expect(own.status).toBe(409);
    expect(own.body.message).toBe('cannot revoke the last active ADMIN');
    // 3) Nor disable their own account.
    const dis = await survivor.api.post(`/admin/users/${survivor.id}/status`, {
      status: 'disabled',
    });
    expect(dis.status).toBe(400);
    expect(dis.body.message).toBe('You cannot disable your own account');
    // 4) Exactly one active ADMIN, exactly one revoke audit row.
    expect(await active()).toBe(1);
    const after = (await db(`SELECT 1 FROM audit_event WHERE action = 'role.revoke'`)).length;
    expect(after - before).toBe(1);
    // 5) The remaining administrator opens the admin page: the Users tab.
    await openAs(page, survivor.acc, '#/admin');
    await expect(
      page.getByRole('navigation', { name: 'Administration' }).getByRole('link', { name: 'Users' }),
    ).toHaveClass(/bg-accent/);
    await expect(page.getByRole('heading', { name: 'Add a user' })).toBeVisible();
    await ux.check('admin after revoke');
    // Give the revoked account its role back so the stack stays usable.
    const loserAcc = survivor.acc === acc.admin ? acc.adminTa : acc.admin;
    const loserId = survivor.acc === acc.admin ? id2 : id1;
    const g = await survivor.api.post(`/admin/users/${loserId}/roles`, { role: 'ADMIN' });
    expect(g.status).toBeLessThan(300);
    void loserAcc;
  },
);

uat(
  'AD-12',
  'AI models for real: add the fake company, switch the active model, the key never reaches the browser',
  { on: ['D'], langs: 'EN' },
  async ({ page, ux }) => {
    const acc = accounts();
    const admin = await adminApi();
    // Start without a connection (the seed added one).
    const ai0 = (await admin.get('/admin/ai')).body as { connections: { id: string }[] };
    for (const c of ai0.connections) await admin.del(`/admin/ai/connections/${c.id}`);
    expect(((await admin.get('/admin/ai')).body as { active: unknown }).active).toBeNull();

    const bodies: string[] = [];
    page.on('response', async (r) => {
      try {
        if (r.url().includes('/admin/') || r.url().includes('/me')) bodies.push(await r.text());
      } catch {
        /* a redirect or a closed response has no body */
      }
    });
    page.on('dialog', (d) => void d.accept());
    await openAs(page, acc.admin, '#/admin/ai');
    await expect(page.getByText(/^No model is active\./)).toBeVisible();
    // 1) Add the company with its key and two models.
    const card = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Add a model' }) });
    await card
      .locator('label:has(> span:text-is("Company")) select')
      .selectOption({ label: 'Anthropic' });
    await card.getByLabel(/^API key/).fill(FAKE_KEY);
    const boxes = card.getByRole('list', { name: 'Models' }).getByRole('checkbox');
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    await card.getByRole('button', { name: /^Save company and model \(2 models\)$/ }).click();
    await expect(card.getByText(/^Saved\. Press "Test" on the model below/)).toBeVisible();
    const conn = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Anthropic' }) });
    const items = conn.getByRole('listitem');
    await expect(items).toHaveCount(2);
    const ids = await items.locator('span.font-mono').allTextContents();
    // 2) Test both, then 'Use this' on the second.
    for (let i = 0; i < 2; i++) {
      await items.nth(i).getByRole('button', { name: 'Test', exact: true }).click();
      await expect(
        conn.getByText(
          new RegExp(`^${ids[i]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} works \\(\\d+ ms\\)\\.$`),
        ),
      ).toBeVisible();
    }
    await items.nth(1).getByRole('button', { name: 'Use this' }).click();
    await expect(items.nth(1)).toContainText('Active');
    await expect(items.nth(0)).not.toContainText('Active');
    await expect(
      page.getByText(
        new RegExp(
          `^Screening uses Anthropic · ${ids[1]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.`,
        ),
      ),
    ).toBeVisible();
    await ux.check('second model active');
    // 3) The API returns only the last four characters.
    const overview = await admin.get('/admin/ai');
    const text = JSON.stringify(overview.body);
    expect(text).not.toContain(FAKE_KEY);
    expect(overview.body.connections[0].keyHint).toBe('0001');
    expect(Object.keys(overview.body.connections[0]).some((k) => /key(?!Hint)/i.test(k))).toBe(
      false,
    );
    // 4) Remove the active model: nothing is active and the notice says so.
    await conn.getByRole('button', { name: `Remove ${ids[1]}` }).click();
    await expect(page.getByText(/^No model is active\./)).toBeVisible();
    // 5) The key appears in no response body, no page text, no web storage.
    const storage = await page.evaluate(() =>
      JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage } }),
    );
    expect(storage).not.toContain(FAKE_KEY);
    expect(await page.locator('body').innerText()).not.toContain(FAKE_KEY);
    expect(await page.content()).not.toContain(FAKE_KEY);
    for (const b of bodies) expect(b).not.toContain(FAKE_KEY);
    expect(bodies.length).toBeGreaterThan(3);
    // 6) Stored encrypted.
    const rows = await db<{ key_ciphertext: unknown; key_hint: string }>(
      `SELECT key_ciphertext, key_hint FROM ai_connection`,
    );
    expect(rows).toHaveLength(1);
    const raw = rows[0]!.key_ciphertext;
    const asText = Buffer.isBuffer(raw) ? raw.toString('latin1') : String(raw);
    expect(asText).not.toContain(FAKE_KEY);
    expect(Buffer.isBuffer(raw) ? raw.toString('base64') : asText).not.toContain(FAKE_KEY);
    expect(rows[0]!.key_hint).toBe('0001');
    // The audit trail has the changes, without the key.
    const audit = await db<{ action: string; after: unknown }>(
      `SELECT action, after FROM audit_event WHERE entity_type = 'ai_provider' ORDER BY occurred_at`,
    );
    const actions = audit.map((a) => a.action);
    for (const a of ['ai.connection_added', 'ai.activate', 'ai.model_removed'])
      expect(actions).toContain(a);
    expect(JSON.stringify(audit)).not.toContain(FAKE_KEY);
    // Put a working active model back for the cases that follow on this stack.
    const left = (await admin.get('/admin/ai')).body.connections[0].models[0].id as string;
    expect((await admin.put('/admin/ai/active', { modelId: left })).status).toBeLessThan(300);
  },
);
