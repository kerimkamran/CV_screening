import { describeDb } from '../testing/pg-harness';
import { boot, type Harness } from '../testing/app-harness';
import { IntakeService } from './intake.service';
import { PrincipalLoader } from '../integrations/principal-loader';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Stage 3, Phase 7 (plan 14.5, decision 1): SenAI's copy of a CV goes through intake.
describeDb('a CV copied from another vacancy goes through intake', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await boot('copyintake');
  }, 120_000);
  afterAll(async () => h?.close());
  const q = (sql: string, p: unknown[] = []) => h.db.owner.query(sql, p);

  async function source(h: Harness, who: any) {
    const from = await h.scenario(
      who.api,
      [{ name: 'Copy Source', lines: ['BGP routing for ten years.'] }],
      'Copy from',
    );
    const d = (
      await q(
        `SELECT id, filename, mime, size_bytes AS size, sha256 AS sha, content, text, text_truncated AS truncated,
                page_starts AS "pageStarts", rendition_pdf AS "renditionPdf", rendition_state AS "renditionState"
           FROM cv_document WHERE vacancy_id = $1`,
        [from],
      )
    ).rows[0];
    return d;
  }

  it('copies once, refuses a live duplicate, but not one whose copy was erased; respects the cap and the gate', async () => {
    const rec = await h.recruiter('copy.rec@azerconnect.test');
    const d = await source(h, rec);
    const to = await h.scenario(rec.api, [], 'Copy to');
    const intake = h.app.get(IntakeService);
    const p = await h.app.get(PrincipalLoader).byUserId(rec.userId);
    const noAudit = async () => undefined;
    const first = await intake.admitCopy(p, to, d, noAudit);
    expect(first).toBeTruthy();
    await expect(intake.admitCopy(p, to, d, noAudit)).rejects.toThrow(/already in this vacancy/);
    await rec.api.post(`/documents/${first}/erase`);
    const again = await intake.admitCopy(p, to, d, noAudit);
    expect(again).not.toBe(first);

    const max = intake.maxCvs;
    Object.defineProperty(intake, 'maxCvs', { get: () => 1, configurable: true });
    try {
      const full = await h.scenario(
        rec.api,
        [{ name: 'Already Here', lines: ['Kubernetes.'] }],
        'Copy full',
      );
      await expect(intake.admitCopy(p, full, d, noAudit)).rejects.toThrow(/at most 1 CVs/);
    } finally {
      Object.defineProperty(intake, 'maxCvs', { get: () => max, configurable: true });
    }

    // The gate: an archived vacancy, and one whose notice was never confirmed.
    await q(`UPDATE vacancy SET archived_at = now(), archived_by = $2 WHERE id = $1`, [
      to,
      rec.userId,
    ]);
    await expect(intake.admitCopy(p, to, d, noAudit)).rejects.toThrow(/Restore this vacancy/);
    await q(`UPDATE vacancy SET archived_at = NULL, archived_by = NULL WHERE id = $1`, [to]);
    await q(`UPDATE vacancy SET candidate_notice_confirmed_at = NULL WHERE id = $1`, [to]);
    await expect(intake.admitCopy(p, to, d, noAudit)).rejects.toThrow(/Confirm that candidates/);
  });
});
