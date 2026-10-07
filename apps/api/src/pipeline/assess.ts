import type { ReqStatus, RequirementClass } from '@cv/shared';
import type { AiGateway } from '../ai/ai-gateway.service';
import { pageAt } from './documents';
import { verifyEvidence } from './evidence';
import type { KnockoutRule } from './knockout';
import { ASSESS_SYSTEM, assessUser } from './prompts';
import { assessmentOutput, parseJsonLoose } from './schemas';
import { computeScore } from './score';
import { extractIdentity, maskForScoring, toOriginal, type MaskedCv } from './scoring-redaction';

export interface Req {
  id: string;
  text: string;
  classification: RequirementClass;
  weight: number | null;
  rule: KnockoutRule | null;
  confidence: string | null;
}

export interface Span {
  start: number;
  end: number;
  quote: string;
  page: number | null;
}
export interface AssessedRow {
  req: Req;
  status: ReqStatus;
  confidence: string;
  spans: Span[];
  dropped: number;
  rationale: string | null;
}

/**
 * One model call for everything that needs judgement, then verified evidence and the deterministic
 * score. Shared by the screening worker and the paired-CV fairness test, so the test exercises the
 * very same path production uses. `mask: false` exists only for the fairness test's comparison arm:
 * it shows what the model does with the CV as written, which is why production always masks.
 */
export async function assessCv(
  ai: Pick<AiGateway, 'complete'>,
  reqs: Req[],
  text: string,
  pages: number[] | null,
  opts: { mask?: boolean } = {},
) {
  const identity = extractIdentity(text);
  const masked: MaskedCv =
    opts.mask === false ? { text, regions: [], counts: {} } : maskForScoring(text, identity.name);
  const judged = reqs.filter((r) => r.classification !== 'disqualifier');
  const out = await ai.complete({
    system: ASSESS_SYSTEM,
    user: assessUser(
      judged.map((r) => ({ id: r.id, text: r.text, classification: r.classification })),
      masked.text,
    ),
    json: true,
    maxTokens: 4000,
  });
  const parsed = assessmentOutput.parse(parseJsonLoose(out.text));
  const byId = new Map(parsed.assessments.map((a) => [a.id, a]));

  const rows: AssessedRow[] = judged.map((r) => {
    const a = byId.get(r.id);
    if (!a) {
      // The model skipped it. Never guess: ambiguous, flagged for the recruiter.
      return {
        req: r,
        status: 'ambiguous',
        confidence: 'unknown',
        spans: [],
        dropped: 0,
        rationale: 'The model did not assess this criterion.',
      };
    }
    // Quotes are located in what the model saw, then mapped to the real CV; one that touches a
    // masked place cannot be shown as a literal quotation and counts as unverified.
    const found = verifyEvidence(masked.text, a.evidence ?? []);
    let dropped = found.dropped;
    const spans: Span[] = [];
    for (const sp of found.spans) {
      const o = toOriginal(masked, sp.start, sp.end);
      if (!o) {
        dropped++;
        continue;
      }
      spans.push({
        start: o.start,
        end: o.end,
        quote: text.slice(o.start, o.end),
        page: pageAt(pages, o.start),
      });
    }
    let status: ReqStatus = a.status;
    let rationale = a.rationale ?? null;
    let confidence = a.confidence ?? 'unknown';
    // MATCH-07: a claim without verifiable evidence is not accepted as stated.
    if ((status === 'met' || status === 'partially_met') && spans.length === 0) {
      status = 'ambiguous';
      confidence = 'low';
      rationale = `${rationale ?? ''} [No quoted evidence could be verified in the CV.]`.trim();
    } else if (status === 'not_met' && spans.length === 0) {
      // Unsupported "not met" is really "nothing found" — never the other way round (MATCH-04).
      status = 'not_found';
    }
    return { req: r, status, confidence, spans, dropped, rationale };
  });

  const { score, breakdown } = computeScore(
    rows.map((x) => ({
      requirementId: x.req.id,
      text: x.req.text,
      classification: x.req.classification,
      weight: x.req.weight,
      status: x.status,
    })),
  );
  return { identity, masked, parsed, out, rows, score, breakdown };
}
