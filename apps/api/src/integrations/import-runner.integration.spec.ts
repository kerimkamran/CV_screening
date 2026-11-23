import { describeDb } from '../testing/pg-harness';
import type { Harness } from '../testing/app-harness';
import {
  bootOracle,
  drainAll,
  makeApps,
  MemorySource,
  readyVacancy,
  runner,
  runRow,
  seedRun,
} from '../testing/oracle-harness';
import { SourceError } from './import-source';
import { finishRun } from './import-runs';
import { RUNNER } from './import-runner.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Stage 3, S3-INT-03 (runner), S3-INT-11 (listing) and S3-INT-12 (fetching), against the in-memory source.
describeDb('import runner (S3-INT-03, S3-INT-11, S3-INT-12)', () => {
  let h: Harness;
  let rec: { userId: string; api: any };
  beforeAll(async () => {
    h = await bootOracle('runner');
    rec = await h.recruiter('runner.rec@azerconnect.test');
  }, 120_000);
  afterAll(async () => h?.close());

  const q = (sql: string, p: unknown[] = []) => h.db.owner.query(sql, p);
  const fresh = async (apps = makeApps(0)) => {
    const vid = await readyVacancy(h, rec.api, `Runner ${Math.random()}`);
    const src = new MemorySource(apps);
    runner(h).source = src;
    return { vid, src };
  };

  it('tick claims one queued run and returns true; with none it returns false (1)', async () => {
    const { vid } = await fresh(makeApps(0));
    const rid = await seedRun(h, vid, rec.userId);
    expect(await runner(h).tick()).toBe(true);
    expect((await runRow(h, rid)).state).toBe('completed');
    expect(await runner(h).tick()).toBe(false);
  });

  it('two parallel ticks on one queued run: exactly one claims it (2)', async () => {
    const { vid, src } = await fresh(makeApps(3));
    src.hold = 100;
    await seedRun(h, vid, rec.userId);
    const [a, b] = await Promise.all([runner(h).tick(), runner(h).tick()]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it('a lapsed lease goes back to the queue with attempts + 1; at 5 the run fails did_not_finish (3)', async () => {
    const { vid } = await fresh();
    const rid = await seedRun(h, vid, rec.userId);
    await q(
      `UPDATE import_run SET state = 'running', claim_id = 'x', lease_until = now() - interval '1 s' WHERE id = $1`,
      [rid],
    );
    await runner(h).recover();
    let r = await runRow(h, rid);
    expect([r.state, r.attempts, r.claim_id]).toEqual(['queued', 1, null]);
    await q(
      `UPDATE import_run SET state = 'running', claim_id = 'x', attempts = 4, lease_until = now() - interval '1 s' WHERE id = $1`,
      [rid],
    );
    await runner(h).recover();
    r = await runRow(h, rid);
    expect([r.state, r.error_code]).toEqual(['failed', 'did_not_finish']);
  });

  it('a state write with a stale claim changes nothing (5)', async () => {
    const { vid } = await fresh();
    const rid = await seedRun(h, vid, rec.userId);
    await q(`UPDATE import_run SET state = 'running', claim_id = 'mine' WHERE id = $1`, [rid]);
    const ok = await h.db.owner.query('SELECT 1'); // keep the owner connection warm
    expect(ok.rowCount).toBe(1);
    expect(await finishRun(h.db.owner, rid, 'completed', null, { claimId: 'stale' })).toBe(false);
    expect((await runRow(h, rid)).state).toBe('running');
    await finishRun(h.db.owner, rid, 'cancelled');
  });

  it('a park keeps attempts; 2 hours for one reason fails with that reason; the budget waits for tomorrow (6)', async () => {
    const { vid, src } = await fresh(makeApps(2));
    src.listFault = () => new SourceError('unavailable');
    const rid = await seedRun(h, vid, rec.userId);
    await runner(h).drainRuns();
    let r = await runRow(h, rid);
    expect([r.state, r.wait_reason, r.attempts]).toEqual(['queued', 'oracle_unavailable', 0]);
    expect(new Date(r.run_after).getTime()).toBeGreaterThan(Date.now());
    await q(`UPDATE import_run SET waited_since = now() - interval '121 minutes' WHERE id = $1`, [
      rid,
    ]);
    await runner(h).recover();
    r = await runRow(h, rid);
    expect([r.state, r.error_code]).toEqual(['failed', 'oracle_unavailable']);

    src.listFault = () => new SourceError('budget');
    const rid2 = await seedRun(h, vid, rec.userId);
    await runner(h).drainRuns();
    await q(`UPDATE import_run SET waited_since = now() - interval '5 hours' WHERE id = $1`, [
      rid2,
    ]);
    await runner(h).recover();
    r = await runRow(h, rid2);
    expect([r.state, r.wait_reason]).toEqual(['queued', 'oracle_budget']);
    await finishRun(h.db.owner, rid2, 'cancelled');
  });

  it('lists 120 over several pages, oldest first, one batch, then fetches all 120 (S3-INT-11 (1), S3-INT-12 (1), (2))', async () => {
    const apps = makeApps(120);
    // Application-ID order and application-date order differ: the batch follows the date.
    apps.reverse().forEach((a, k) => (a.appliedAt = new Date(Date.UTC(2026, 0, 1 + k))));
    const { vid, src } = await fresh(apps);
    src.pageSize = 50;
    const rid = await seedRun(h, vid, rec.userId, { estimate: 120 });
    await drainAll(h);
    const r = await runRow(h, rid);
    expect(r.state).toBe('completed');
    expect(r.stats).toMatchObject({ seen: 120, listed: 120, fetched: 120, pages: 3 });
    expect(src.maxInFlight).toBeLessThanOrEqual(2);
    const items = (
      await q(
        `SELECT u.filename, u.outcome, i.external_application_id, i.document_id, d.uploaded_by, i.external_applied_at
           FROM import_item i JOIN upload_item u ON u.id = i.upload_item_id
           LEFT JOIN cv_document d ON d.id = i.document_id
          WHERE i.run_id = $1 ORDER BY u.position`,
        [rid],
      )
    ).rows;
    expect(items).toHaveLength(120);
    expect(items[0].filename).toBe('Oracle application 1');
    expect(items[119].filename).toBe('Oracle application 120');
    const dates = items.map((i: any) => new Date(i.external_applied_at).getTime());
    expect([...dates].sort((a, b) => a - b)).toEqual(dates);
    expect(items.every((i: any) => i.document_id && i.uploaded_by === rec.userId)).toBe(true);
    // Raw Oracle IDs are gone once the run ended.
    expect(items.every((i: any) => i.external_application_id === null)).toBe(true);
    expect(r.list_cursor).toBeNull();
    const audits = (
      await q(
        `SELECT after FROM audit_event WHERE action = 'document.upload' AND after->>'runId' = $1`,
        [rid],
      )
    ).rows;
    expect(audits).toHaveLength(120);
    expect(audits[0].after.via).toBe('oracle_hcm');
    const listedAudit = (
      await q(
        `SELECT after FROM audit_event WHERE action = 'import_run.listed' AND entity_id = $1`,
        [rid],
      )
    ).rows[0].after;
    expect(listedAudit).toMatchObject({ estimate: 120, listed: 120, confirmedBy: rec.userId });
    const batch = (
      await q(`SELECT source, file_count FROM upload_batch WHERE id = $1`, [r.batch_id])
    ).rows[0];
    expect(batch).toEqual({ source: 'oracle_hcm', file_count: 120 });
    // The fetched bytes equal the sum of the item sizes.
    const sum = (
      await q(`SELECT sum(size_bytes)::bigint AS s FROM import_item WHERE run_id = $1`, [rid])
    ).rows[0].s;
    expect(String(r.fetched_bytes)).toBe(String(sum));
    // Analyses ran for all of them.
    const analyzed = (
      await q(
        `SELECT count(*)::int AS n FROM screening s JOIN cv_document d ON d.id = s.document_id WHERE d.vacancy_id = $1 AND s.state = 'completed'`,
        [vid],
      )
    ).rows[0].n;
    expect(analyzed).toBe(120);
  }, 180_000);

  it('pauses above the estimate with nothing copied (S3-INT-11 (2)) and above the room (3)', async () => {
    const { vid } = await fresh(makeApps(12));
    const rid = await seedRun(h, vid, rec.userId, { estimate: 10 });
    await runner(h).drainRuns();
    const r = await runRow(h, rid);
    expect([r.state, r.confirm_reason, r.batch_id, r.listed]).toEqual([
      'awaiting_confirm',
      'above_estimate',
      null,
      12,
    ]);
    const docs = (
      await q(`SELECT count(*)::int AS n FROM cv_document WHERE vacancy_id = $1`, [vid])
    ).rows[0].n;
    expect(docs).toBe(0);
    // Two hours unanswered: cancelled, not_confirmed, nothing copied.
    await q(`UPDATE import_run SET awaiting_since = now() - interval '121 minutes' WHERE id = $1`, [
      rid,
    ]);
    await runner(h).recover();
    expect((await runRow(h, rid)).error_code).toBe('not_confirmed');
    expect((await runRow(h, rid)).state).toBe('cancelled');

    const intake = h.app.get((await import('../pipeline/intake.service')).IntakeService);
    const max = intake.maxCvs;
    Object.defineProperty(intake, 'maxCvs', { get: () => 5, configurable: true });
    try {
      const rid2 = await seedRun(h, vid, rec.userId, { estimate: 50 });
      await runner(h).drainRuns();
      expect((await runRow(h, rid2)).confirm_reason).toBe('above_room');
      await finishRun(h.db.owner, rid2, 'cancelled');
    } finally {
      Object.defineProperty(intake, 'maxCvs', { get: () => max, configurable: true });
    }
  });

  it('resumes from the cursor after the claim is lost between pages: 0 duplicates (S3-INT-11 (4))', async () => {
    const { vid, src } = await fresh(makeApps(120));
    src.pageSize = 50;
    const rid = await seedRun(h, vid, rec.userId, { estimate: 120 });
    src.afterPage = async (n) => {
      // After page 2 is read, another worker "steals" the run: this worker must stop writing.
      if (n === 2) await q(`UPDATE import_run SET claim_id = 'other' WHERE id = $1`, [rid]);
    };
    await runner(h).drainRuns();
    let r = await runRow(h, rid);
    expect(r.listed).toBe(50);
    src.afterPage = null;
    await q(`UPDATE import_run SET state = 'queued', claim_id = NULL WHERE id = $1`, [rid]);
    await drainAll(h);
    r = await runRow(h, rid);
    expect([r.state, r.listed]).toEqual(['completed', 120]);
    const n = (
      await q(
        `SELECT count(DISTINCT app_key_hash)::int AS d, count(*)::int AS n FROM import_item WHERE run_id = $1`,
        [rid],
      )
    ).rows[0];
    expect(n).toEqual({ d: 120, n: 120 });
  }, 120_000);

  it('leaves no row for filtered, pre-notice and no-file applications; counts them (S3-INT-11 (5))', async () => {
    const apps = makeApps(6);
    apps[0]!.eligibility = 'filtered';
    apps[1]!.attachments = [];
    apps[2]!.appliedAt = new Date('2020-01-01T00:00:00Z');
    const { vid } = await fresh(apps);
    await q(
      `INSERT INTO integration_connection (id, system, base_url, principal_name, notice_effective_from)
       VALUES ('01JZZZZZZZZZZZZZZZZZZZZZZ1','oracle_hcm','https://x.fa.em2.oraclecloud.com','u','2025-01-01')
       ON CONFLICT (system) DO UPDATE SET notice_effective_from = '2025-01-01'`,
    );
    try {
      const rid = await seedRun(h, vid, rec.userId, { estimate: 10 });
      await drainAll(h);
      const r = await runRow(h, rid);
      expect(r.stats).toMatchObject({ seen: 6, filtered: 1, noFile: 1, preNotice: 1, listed: 3 });
      const rows = (await q(`SELECT count(*)::int AS n FROM import_item WHERE run_id = $1`, [rid]))
        .rows[0].n;
      expect(rows).toBe(3);
    } finally {
      await q(`UPDATE integration_connection SET notice_effective_from = NULL`);
    }
  });

  it('a refresh on unchanged data finds everything already here: no batch, 0 downloads (S3-INT-11 (7))', async () => {
    const { vid, src } = await fresh(makeApps(5));
    await seedRun(h, vid, rec.userId, { estimate: 5 });
    await drainAll(h);
    const before = src.downloads;
    const rid = await seedRun(h, vid, rec.userId, { estimate: 5, mode: 'refresh' });
    await drainAll(h);
    const r = await runRow(h, rid);
    expect([r.state, r.batch_id, r.listed]).toEqual(['completed', null, 0]);
    expect(r.stats.already).toBe(5);
    expect(src.downloads).toBe(before);
  });

  it('a newer CV on an imported application points at the older one, which stays (S3-INT-11 (8))', async () => {
    const apps = makeApps(2);
    const { vid, src } = await fresh(apps);
    await seedRun(h, vid, rec.userId, { estimate: 2 });
    await drainAll(h);
    const newer = Buffer.from(`${apps[0]!.file!.toString()}\nUpdated CV with Python scripting.`);
    apps[0]!.attachments = [
      {
        attachmentId: 'T-NEW',
        fileName: 'Applicant_new.txt',
        size: newer.length,
        category: 'Resume',
      },
    ];
    apps[0]!.file = newer;
    src.apps = apps;
    const rid = await seedRun(h, vid, rec.userId, { estimate: 2, mode: 'refresh' });
    await drainAll(h);
    const it = (
      await q(`SELECT supersedes_document_id, document_id FROM import_item WHERE run_id = $1`, [
        rid,
      ])
    ).rows;
    expect(it).toHaveLength(1);
    expect(it[0].supersedes_document_id).toBeTruthy();
    const older = (
      await q(`SELECT erased_at FROM cv_document WHERE id = $1`, [it[0].supersedes_document_id])
    ).rows[0];
    expect(older.erased_at).toBeNull();
  });

  it('storage projection too high: failed storage_low, no batch, nothing copied (S3-INT-11 (9))', async () => {
    const { vid } = await fresh(makeApps(3));
    const env = (runner(h) as any).env;
    const limit = env.DB_SIZE_LIMIT_MB;
    env.DB_SIZE_LIMIT_MB = 1; // far below the size of the test database
    try {
      const rid = await seedRun(h, vid, rec.userId, { estimate: 3 });
      await runner(h).drainRuns();
      const r = await runRow(h, rid);
      expect([r.state, r.error_code, r.batch_id]).toEqual(['failed', 'storage_low', null]);
    } finally {
      env.DB_SIZE_LIMIT_MB = limit;
    }
  });

  it('room 5, 12 confirmed: 5 admitted, at most room + 2 downloads, the rest vacancy_full (S3-INT-12 (6))', async () => {
    const { vid, src } = await fresh(makeApps(12));
    const intake = h.app.get((await import('../pipeline/intake.service')).IntakeService);
    const max = intake.maxCvs;
    Object.defineProperty(intake, 'maxCvs', { get: () => 5, configurable: true });
    try {
      const rid = await seedRun(h, vid, rec.userId, { estimate: 12 });
      await q(`UPDATE import_run SET confirmed_by = $2, confirmed_at = now() WHERE id = $1`, [
        rid,
        rec.userId,
      ]);
      await drainAll(h);
      const r = await runRow(h, rid);
      expect(r.state).toBe('completed');
      const live = (
        await q(
          `SELECT count(*)::int AS n FROM cv_document WHERE vacancy_id = $1 AND erased_at IS NULL`,
          [vid],
        )
      ).rows[0].n;
      expect(live).toBe(5);
      expect(src.downloads).toBeLessThanOrEqual(7);
      const full = (
        await q(
          `SELECT count(*)::int AS n FROM upload_item WHERE batch_id = $1 AND code = 'vacancy_full'`,
          [r.batch_id],
        )
      ).rows[0].n;
      expect(full).toBe(7);
    } finally {
      Object.defineProperty(intake, 'maxCvs', { get: () => max, configurable: true });
    }
  });

  it('two strikes: the third pick ends rejected/crash_limit with no download (S3-INT-12 (7))', async () => {
    const { vid, src } = await fresh(makeApps(3));
    const rid = await seedRun(h, vid, rec.userId, { estimate: 3 });
    // Listing only: hold the first download forever by failing it as an outage, then fake two deaths.
    src.downloadFault = () => new SourceError('unavailable');
    await runner(h).drainRuns();
    const first = (
      await q(`SELECT id FROM import_item WHERE run_id = $1 ORDER BY seq LIMIT 1`, [rid])
    ).rows[0].id;
    await q(`UPDATE import_item SET attempts = 2 WHERE id = $1`, [first]);
    src.downloadFault = null;
    const before = src.downloads;
    await q(`UPDATE import_run SET run_after = now() WHERE id = $1`, [rid]);
    await drainAll(h);
    const u = (
      await q(
        `SELECT u.outcome, u.code FROM import_item i JOIN upload_item u ON u.id = i.upload_item_id WHERE i.id = $1`,
        [first],
      )
    ).rows[0];
    expect(u).toEqual({ outcome: 'rejected', code: 'crash_limit' });
    expect(src.downloads - before).toBe(2);
    expect((await runRow(h, rid)).state).toBe('completed');
  });

  it('three 503 answers park the run with attempts unchanged; it resumes when the source recovers (S3-INT-12 (9))', async () => {
    const { vid, src } = await fresh(makeApps(4));
    const rid = await seedRun(h, vid, rec.userId, { estimate: 4 });
    let fails = 0;
    src.downloadFault = () => (fails++ < 3 ? new SourceError('unavailable') : null);
    await runner(h).drainRuns();
    let r = await runRow(h, rid);
    expect([r.state, r.wait_reason, r.attempts]).toEqual(['queued', 'oracle_unavailable', 0]);
    const strikes = (
      await q(`SELECT max(attempts)::int AS m FROM import_item WHERE run_id = $1`, [rid])
    ).rows[0].m;
    expect(strikes).toBe(0);
    for (let k = 0; k < 3 && r.state !== 'completed'; k++) {
      await q(`UPDATE import_run SET run_after = now() WHERE id = $1`, [rid]);
      await drainAll(h);
      r = await runRow(h, rid);
    }
    expect(r.state).toBe('completed');
    expect(r.wait_reason).toBeNull();
  });

  it('an 11 MB answer ends rejected/too_large; a forbidden link is read again once (S3-INT-12 (3), (10))', async () => {
    const { vid, src } = await fresh(makeApps(3, { prefix: 'X-' }));
    const big = 'X-T100001';
    let forbidden = 0;
    src.downloadFault = (ref) => {
      if (ref.attachmentId === big) return new SourceError('too_large');
      if (ref.attachmentId === 'X-T100002' && forbidden++ < 1)
        return new SourceError('link_forbidden');
      if (ref.attachmentId === 'X-T100003') return new SourceError('link_forbidden');
      return null;
    };
    const rid = await seedRun(h, vid, rec.userId, { estimate: 3 });
    await drainAll(h);
    const rows = (
      await q(
        `SELECT i.external_applied_at, u.outcome, u.code FROM import_item i JOIN upload_item u ON u.id = i.upload_item_id
          WHERE i.run_id = $1 ORDER BY i.seq`,
        [rid],
      )
    ).rows.map((x: any) => `${x.outcome}/${x.code ?? ''}`);
    expect(rows).toEqual(['rejected/too_large', 'queued/', 'skipped/source_unavailable']);
    const skip = (
      await q(`SELECT filename FROM intake_skip WHERE vacancy_id = $1 ORDER BY skipped_at`, [vid])
    ).rows.map((x: any) => x.filename);
    expect(skip).toEqual(['Oracle application 1', 'Oracle application 3']);
  });

  it('the person loses their role after a few files: the run fails actor_revoked, the rest are not fetched (S3-INT-12 (5))', async () => {
    const who = await h.recruiter(`revoked.${Date.now()}@azerconnect.test`);
    const vid = await readyVacancy(h, who.api, 'Revoked');
    const src = new MemorySource(makeApps(6));
    runner(h).source = src;
    const rid = await seedRun(h, vid, who.userId, { estimate: 6 });
    // The role goes during the third download, awaited, so the next check sees it (no race).
    let n = 0;
    src.beforeDownload = async () => {
      n++;
      if (n === 3)
        await q(
          `UPDATE role_assignment SET revoked_at = now(), revoked_by = $1 WHERE user_id = $1`,
          [who.userId],
        );
    };
    src.hold = 30;
    await drainAll(h);
    const r = await runRow(h, rid);
    expect([r.state, r.error_code]).toEqual(['failed', 'actor_revoked']);
    const open = (
      await q(
        `SELECT count(*)::int AS n FROM upload_item WHERE batch_id = $1 AND code = 'source_unavailable'`,
        [r.batch_id],
      )
    ).rows[0].n;
    expect(open).toBeGreaterThan(0);
  });

  it('memory above the ceiling parks capacity_unavailable with attempts unchanged (S3-INT-12 (14))', async () => {
    const { vid } = await fresh(makeApps(2));
    const rid = await seedRun(h, vid, rec.userId, { estimate: 2 });
    const mem = runner(h).memory;
    runner(h).memory = () => RUNNER.memoryCeiling + 0.01;
    try {
      await runner(h).drainRuns();
      const r = await runRow(h, rid);
      expect([r.state, r.wait_reason, r.attempts]).toEqual(['queued', 'capacity_unavailable', 0]);
    } finally {
      runner(h).memory = mem;
    }
    await q(`UPDATE import_run SET run_after = now() WHERE id = $1`, [rid]);
    await drainAll(h);
    expect((await runRow(h, rid)).state).toBe('completed');
  });

  it('cancel while fetching: at most 2 downloads finish, none is admitted, the run ends cancelled (S3-INT-13 (8))', async () => {
    const { vid, src } = await fresh(makeApps(10));
    src.hold = 50;
    const rid = await seedRun(h, vid, rec.userId, { estimate: 10 });
    const stop = (async () => {
      for (let k = 0; k < 100; k++) {
        const r = await runRow(h, rid);
        if (r.phase === 'fetching') break;
        await new Promise((res) => setTimeout(res, 10));
      }
      await rec.api.post(`/vacancies/${vid}/stop`);
    })();
    await Promise.all([runner(h).drainRuns(), stop]);
    const r = await runRow(h, rid);
    expect(r.state).toBe('cancelled');
    const docs = (
      await q(`SELECT count(*)::int AS n FROM cv_document WHERE vacancy_id = $1`, [vid])
    ).rows[0].n;
    expect(docs).toBeLessThanOrEqual(2);
    const cancelled = (
      await q(
        `SELECT count(*)::int AS n FROM upload_item WHERE batch_id = $1 AND code = 'cancelled'`,
        [r.batch_id],
      )
    ).rows[0].n;
    expect(cancelled + docs).toBe(10);
  });

  it('with the switch off, recovery cancels every active run with switched_off and one audit row (8)', async () => {
    const { vid } = await fresh();
    const rid = await seedRun(h, vid, rec.userId);
    const env = (runner(h) as any).env;
    env.ORACLE_IMPORT_ENABLED = 'false';
    try {
      await runner(h).recover();
      const r = await runRow(h, rid);
      expect([r.state, r.error_code]).toEqual(['cancelled', 'switched_off']);
      const a = (
        await q(
          `SELECT count(*)::int AS n FROM audit_event WHERE action = 'import_run.switched_off' AND entity_id = $1`,
          [rid],
        )
      ).rows[0].n;
      expect(a).toBe(1);
      expect(await runner(h).tick()).toBe(false);
    } finally {
      env.ORACLE_IMPORT_ENABLED = 'true';
    }
  });
});
