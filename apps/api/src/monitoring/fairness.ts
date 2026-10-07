/**
 * Fairness monitor (docs/bias-review.md, plan EVAL-06). The platform does not collect protected
 * attributes, so it cannot measure adverse impact by gender, age or ethnicity, and it does not try
 * to guess them. What it can watch, without profiling anyone, are the factors that could silently
 * disadvantage a group of applicants for technical reasons: the language the CV is written in (the
 * model may read Azerbaijani or Russian less well than English), the file format (a parser may fail
 * more on one) and the length of the CV. For each it compares how often a CV reaches the Strong or
 * Good band against the best-served group, using the four-fifths rule of thumb as a trigger for a
 * human look, never as proof of anything.
 *
 * Aggregates only. A group smaller than K_MIN is not shown, and no individual appears.
 */

export const FOUR_FIFTHS = 0.8;
/** Below this many scored CVs in a group, no ratio is computed ("not enough data yet"). */
export const MIN_SCORED = 20;
/** Groups smaller than this are suppressed entirely so nobody can be singled out. */
export const K_MIN = 5;

export type Lang = 'az' | 'ru' | 'en';

const AZ_WORDS =
  /(?<![\p{L}\p{N}])(və|ilə|üzrə|təcrübə|təcrübəsi|təhsil|bacarıqlar|iş|şirkət|mühəndis|bakı)(?![\p{L}\p{N}])/giu;

/** Which language most of the CV is written in; mixed CVs go to the language with the most text. */
export function detectLanguage(text: string): Lang {
  const sample = text.slice(0, 6000);
  const letters = sample.match(/\p{L}/gu)?.length ?? 0;
  if (letters === 0) return 'en';
  const cyr = sample.match(/[Ѐ-ӿ]/g)?.length ?? 0;
  if (cyr / letters > 0.3) return 'ru';
  const azLetters = sample.match(/[əƏ]/g)?.length ?? 0;
  const azWords = sample.match(AZ_WORDS)?.length ?? 0;
  if (azLetters >= 3 || azWords >= 4) return 'az';
  return 'en';
}

export const lengthBucket = (chars: number): 'short' | 'medium' | 'long' =>
  chars < 1500 ? 'short' : chars <= 5000 ? 'medium' : 'long';

export const formatOf = (mime: string): 'pdf' | 'docx' | 'txt' =>
  mime === 'application/pdf' ? 'pdf' : mime.includes('wordprocessingml') ? 'docx' : 'txt';

export interface FairRow {
  /** null when the file had no readable text, so nothing can be said about its language or length. */
  language: Lang | null;
  format: 'pdf' | 'docx' | 'txt';
  length: 'short' | 'medium' | 'long' | null;
  /** Read and scored (not unreadable, not still running). */
  scored: boolean;
  /** Could not be read at all (scan only, damaged). */
  unread: boolean;
  score: number | null;
  band: string | null;
}

export interface GroupStat {
  group: string;
  /** Files in the group, read or not. */
  files: number;
  scored: number;
  meanScore: number | null;
  /** Share of scored CVs in the Strong or Good band (score 70 or more) and not sent to a human. */
  favourableRate: number | null;
  needsLookRate: number | null;
  unreadRate: number | null;
  /** favourableRate divided by the best group's rate; null until there is enough data. */
  impactRatio: number | null;
  flag: 'ok' | 'review' | 'not_enough_data';
}

export interface Dimension {
  key: 'language' | 'format' | 'length';
  label: string;
  groups: GroupStat[];
  suppressed: number;
}

const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

export function summarise(rows: FairRow[], key: Dimension['key'], label: string): Dimension {
  const by = new Map<string, FairRow[]>();
  for (const r of rows) {
    const g = r[key];
    if (g !== null) by.set(g, [...(by.get(g) ?? []), r]);
  }
  let suppressed = 0;
  const stats: GroupStat[] = [];
  for (const [group, rs] of [...by.entries()].sort()) {
    if (rs.length < K_MIN) {
      suppressed += rs.length;
      continue;
    }
    const scored = rs.filter((r) => r.scored);
    const fav = scored.filter((r) => r.band !== 'needs_review' && (r.score ?? 0) >= 70).length;
    const look = scored.filter((r) => r.band === 'needs_review').length;
    const scores = scored.map((r) => r.score).filter((v): v is number => v !== null);
    stats.push({
      group,
      files: rs.length,
      scored: scored.length,
      meanScore: scores.length ? round(scores.reduce((a, b) => a + b, 0) / scores.length, 1) : null,
      favourableRate: scored.length ? round(fav / scored.length) : null,
      needsLookRate: scored.length ? round(look / scored.length) : null,
      unreadRate: round(rs.filter((r) => r.unread).length / rs.length),
      impactRatio: null,
      flag: scored.length >= MIN_SCORED ? 'ok' : 'not_enough_data',
    });
  }
  const eligible = stats.filter((g) => g.flag === 'ok' && g.favourableRate !== null);
  const best = Math.max(0, ...eligible.map((g) => g.favourableRate!));
  if (eligible.length >= 2 && best > 0) {
    for (const g of eligible) {
      g.impactRatio = round(g.favourableRate! / best);
      if (g.impactRatio < FOUR_FIFTHS) g.flag = 'review';
    }
  }
  return { key, label, groups: stats, suppressed };
}

export function fairnessReport(rows: FairRow[]) {
  return {
    totals: {
      files: rows.length,
      scored: rows.filter((r) => r.scored).length,
      unread: rows.filter((r) => r.unread).length,
    },
    dimensions: [
      summarise(rows, 'language', 'Language of the CV'),
      summarise(rows, 'format', 'File format'),
      summarise(rows, 'length', 'Length of the CV'),
    ],
    method: {
      favourable: 'Strong or Good band (score 70 or more), not sent to a human look',
      rule: `A group whose favourable rate is below ${FOUR_FIFTHS * 100}% of the best group's, with at least ${MIN_SCORED} scored CVs, is marked "review". That is a prompt to look, not a finding.`,
      privacy: `No protected attribute is collected or inferred. Groups under ${K_MIN} files are not shown.`,
    },
  };
}
