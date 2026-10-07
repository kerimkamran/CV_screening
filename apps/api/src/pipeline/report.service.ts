import { ConflictException, Injectable } from '@nestjs/common';
import {
  experienceLine,
  isPending,
  KIND_NAME,
  matchBand,
  mustHaveTally,
  orderCandidates,
  pseudonyms,
  reportCounts,
  skillChips,
  unreadReason,
  type MatchBand,
  type RankRow,
  type SharedReportSnapshot,
  type SnapshotCandidate,
} from '@cv/shared';
import type { Principal } from '../auth/principal';
import { DbService, type Queryable } from '../db/db.service';
import { AdjustmentService } from './adjustments.service';
import { CandidatesService } from './candidates.service';

export const EXPANDED = 15;
const BANDS: MatchBand[] = ['strong', 'good', 'partial', 'limited', 'human'];

/** Remove the candidate's own name, e-mail addresses and phone numbers from free text. */
export function redact(text: string, name: string | null): string {
  let out = text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[e-mail]')
    .replace(/(?<!\w)\+?\d[\d\s().-]{7,}\d(?!\w)/g, '[phone]');
  const parts = (name ?? '')
    .split(/\s+/)
    .map((x) => x.replace(/[^\p{L}\p{N}'-]/gu, ''))
    .filter((x) => x.length >= 3);
  for (const part of parts) {
    const esc = part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, 'giu'), '[name]');
  }
  return out;
}

/**
 * Builds the snapshot a share link shows (design spec 6.5). Everything comes from the same rows
 * and the same presentation rules (`@cv/shared`) as the live report, so the two cannot disagree.
 */
@Injectable()
export class ReportService {
  constructor(
    private readonly db: DbService,
    private readonly cands: CandidatesService,
    private readonly adj: AdjustmentService,
  ) {}

  async build(
    vid: string,
    title: string,
    opts: { includeNames: boolean; includeQuotes: boolean },
    p: Principal,
    creatorName: string,
  ): Promise<SharedReportSnapshot> {
    const all = (await this.cands.rows(vid)).filter((r) => !r.erased);
    // A snapshot is only offered when the run is done (spec 6.5, states).
    if (all.some((r) => isPending(r))) {
      throw new ConflictException(
        'The scan is still running. Share the report when every resume has been read, or stop the scan first.',
      );
    }
    const rank = all as unknown as RankRow[];
    const labels = pseudonyms(rank);
    const ordered = orderCandidates(all);
    const scoredRows = ordered.filter((r) => matchBand(r) !== 'human' && r.state === 'completed');
    if (scoredRows.length === 0) {
      throw new ConflictException(
        'No candidate has been scored yet, so there is nothing to share.',
      );
    }

    // Names: only candidates this recruiter revealed or shortlisted, and only if asked for.
    const shown = new Set<string>();
    if (opts.includeNames) {
      const revealed = new Set(await this.cands.revealedBy(vid, p.userId));
      for (const r of scoredRows) {
        if ((r.screeningId && revealed.has(r.screeningId)) || r.decision?.outcome === 'shortlist') {
          shown.add(r.documentId);
        }
      }
    }

    // Reasons and quotes for the expanded candidates only.
    const top = scoredRows.slice(0, EXPANDED).filter((r) => r.screeningId);
    const detail = new Map<
      string,
      {
        summary: string | null;
        quotes: { requirement: string; quote: string; page?: number | null }[];
      }
    >();
    if (top.length) {
      const ids = top.map((r) => r.screeningId!);
      const sums = await this.db.query<{ id: string; summary: string | null }>(
        `SELECT id, summary FROM screening WHERE id = ANY($1::text[])`,
        [ids],
      );
      const ass = await this.db.query<{
        screening_id: string;
        text: string;
        status: string | null;
        evidence: { quote: string; page?: number | null }[] | null;
      }>(
        `SELECT a.screening_id, r.text, a.status, a.evidence
           FROM requirement_assessment a JOIN requirement r ON r.id = a.requirement_id
          WHERE a.screening_id = ANY($1::text[]) AND r.classification <> 'disqualifier'
          ORDER BY r.position, r.id`,
        [ids],
      );
      for (const s of sums.rows) detail.set(s.id, { summary: s.summary, quotes: [] });
      for (const a of ass.rows) {
        const d = detail.get(a.screening_id);
        if (!d || d.quotes.length >= 2) continue;
        if ((a.status === 'met' || a.status === 'partially_met') && a.evidence?.[0]?.quote) {
          d.quotes.push({
            requirement: a.text,
            quote: a.evidence[0].quote,
            page: a.evidence[0].page ?? null,
          });
        }
      }
    }

    const candidates: SnapshotCandidate[] = scoredRows.map((r, i) => {
      const label = labels.get(r.documentId)!;
      const name = shown.has(r.documentId) ? (r.candidateName ?? null) : null;
      const tally = mustHaveTally(r.score?.breakdown as never);
      const chips = skillChips(r.score?.breakdown as never).map((c) => ({
        text: c.text,
        kind: c.kind,
        classification: c.classification,
      }));
      const expanded = i < EXPANDED;
      const d = r.screeningId ? detail.get(r.screeningId) : undefined;
      // The reason is written by the model and may repeat the person's name; hide it with the name.
      const clean = (t: string) => (name ? t : redact(t, r.candidateName));
      const missing = chips.find((c) => c.kind === 'missing' && c.classification === 'mandatory');
      return {
        documentId: r.documentId,
        rank: i + 1,
        label,
        name,
        band: matchBand(r),
        score: Math.round(r.score!.value),
        mustFound: tally.found,
        mustTotal: tally.total,
        chips,
        expanded,
        summary: expanded && d?.summary ? clean(d.summary) : null,
        quotes:
          expanded && opts.includeQuotes
            ? (d?.quotes ?? []).map((q) => ({
                requirement: q.requirement,
                quote: clean(q.quote),
                page: q.page ?? null,
              }))
            : [],
        missing: expanded && missing ? missing.text : null,
      };
    });

    const view = await this.adj.view(vid);
    const used = view.requirements;
    const set = (
      await this.db.query<{ version: number; frozenAt: string | null }>(
        `SELECT version, frozen_at AS "frozenAt" FROM requirement_set
          WHERE vacancy_id = $1 AND frozen_at IS NOT NULL ORDER BY version DESC LIMIT 1`,
        [vid],
      )
    ).rows[0];
    const ai = (
      await this.db.query<{ provider: string | null; model: string | null }>(
        `SELECT sc.ai_provider AS provider, sc.ai_model AS model
           FROM screening sc JOIN cv_document d ON d.id = sc.document_id
          WHERE d.vacancy_id = $1 AND sc.ai_model IS NOT NULL ORDER BY sc.id DESC LIMIT 1`,
        [vid],
      )
    ).rows[0];

    const counts = reportCounts(rank);
    return {
      version: 1,
      runId: vid.slice(-8),
      title,
      takenAt: new Date().toISOString(),
      createdBy: creatorName,
      includeNames: opts.includeNames,
      includeQuotes: opts.includeQuotes,
      counts,
      role: {
        must: used.filter((r) => r.current === 'mandatory').map((r) => r.text),
        nice: used.filter((r) => r.current === 'preferred').map((r) => r.text),
        ignored: used.filter((r) => r.current === 'ignore').map((r) => r.text),
        experience: experienceLine(used.filter((r) => r.current !== 'ignore').map((r) => r.text)),
      },
      method: {
        criteriaVersion: set?.version ?? null,
        frozenAt: set?.frozenAt ? new Date(set.frozenAt).toISOString() : null,
        provider: ai?.provider ?? null,
        model: ai?.model ?? null,
      },
      bands: Object.fromEntries(
        BANDS.map((b) => [
          b,
          all.filter((r) => matchBand(r) === b && !isPending(r) && r.state !== 'stopped').length,
        ]),
      ) as Record<MatchBand, number>,
      candidates,
      expandedCount: EXPANDED,
      unread: all
        .filter((r) => unreadReason(r) !== null)
        .map((r) => ({ label: labels.get(r.documentId)!, reason: unreadReason(r)! })),
      changes: view.changes.map((c) => ({
        text: c.reset
          ? 'Requirements set back to the original'
          : `${c.requirement}: ${KIND_NAME[c.from!].toLowerCase()} to ${KIND_NAME[c.to!].toLowerCase()}`,
        by: c.by,
        at: new Date(c.at).toISOString(),
      })),
      decisions: ordered
        .filter((r) => r.decision)
        .map((r) => ({
          documentId: r.documentId,
          label: labels.get(r.documentId)!,
          outcome: r.decision!.outcome,
          by: r.decision!.decidedBy,
          at: new Date(r.decision!.decidedAt).toISOString(),
          reason: (shown.has(r.documentId)
            ? r.decision!.reason
            : redact(r.decision!.reason, r.candidateName)
          ).slice(0, 400),
        })),
    };
  }

  /**
   * A resume was erased: take the person's name, reason and quotes out of every snapshot that
   * carries them. The candidate stays as a numbered row, so the counts and ranks do not change.
   */
  async scrubDocument(tx: Queryable, vacancyId: string, documentId: string): Promise<number> {
    const { rows } = await tx.query<{ id: string; snapshot: SharedReportSnapshot }>(
      `SELECT id, snapshot FROM report_share WHERE vacancy_id = $1`,
      [vacancyId],
    );
    let touched = 0;
    for (const s of rows) {
      let hit = false;
      for (const c of s.snapshot.candidates) {
        if (c.documentId !== documentId) continue;
        if (c.name || c.summary || c.quotes.length) hit = true;
        c.name = null;
        c.summary = null;
        c.quotes = [];
      }
      for (const d of s.snapshot.decisions) {
        if (d.documentId !== documentId || d.reason === undefined) continue;
        d.reason = '';
        hit = true;
      }
      if (hit) {
        await tx.query(`UPDATE report_share SET snapshot = $2 WHERE id = $1`, [
          s.id,
          JSON.stringify(s.snapshot),
        ]);
        touched++;
      }
    }
    return touched;
  }
}
