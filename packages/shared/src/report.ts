/**
 * Pure rules for how a screening is presented to a person (design spec 6.2 and 6.5). They live
 * here so the results screen, the live report and the shared snapshot cannot disagree: the same
 * bands, the same order, the same pseudonyms and the same reasons a file was not read.
 */

export type MatchBand = 'strong' | 'good' | 'partial' | 'limited' | 'human';

/** Open in the spec: 80 / 70 / 50 are not calibrated against the model yet. */
export const BAND_CUTOFFS = { strong: 80, good: 70, partial: 50 } as const;

export const BAND_LABEL: Record<MatchBand, string> = {
  strong: 'Strong',
  good: 'Good',
  partial: 'Partial',
  limited: 'Limited',
  human: 'Needs a human look',
};

export interface RankItem {
  requirementId: string;
  text: string;
  classification: string;
  status: string;
}
export interface RankRow {
  documentId: string;
  uploadedAt: string;
  state: string;
  parseStatus: string;
  erased: boolean;
  error: string | null;
  band: string | null;
  score: { value: number; breakdown: { mandatoryGaps: number; items: RankItem[] } } | null;
}

export const isPending = (r: { state: string }) => r.state === 'queued' || r.state === 'processing';

export function matchBand(r: Pick<RankRow, 'state' | 'score' | 'band'>): MatchBand {
  if (r.state !== 'completed' || r.score === null || r.band === 'needs_review') return 'human';
  const v = r.score.value;
  return v >= BAND_CUTOFFS.strong
    ? 'strong'
    : v >= BAND_CUTOFFS.good
      ? 'good'
      : v >= BAND_CUTOFFS.partial
        ? 'partial'
        : 'limited';
}

export function mustHaveTally(b: { items: RankItem[] } | undefined): {
  found: number;
  total: number;
} {
  const m = (b?.items ?? []).filter((i) => i.classification === 'mandatory');
  return { found: m.filter((i) => i.status === 'met').length, total: m.length };
}

const uploadOrder = (a: RankRow, b: RankRow) =>
  a.uploadedAt.localeCompare(b.uploadedAt) || a.documentId.localeCompare(b.documentId);

/**
 * Score descending. Ties: more must-haves met first, then upload order, so the order is stable.
 * Unreadable and failed files come last.
 */
export function orderCandidates<T extends RankRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const sa = a.score?.value ?? -1;
    const sb = b.score?.value ?? -1;
    if (sa !== sb) return sb - sa;
    const ma = mustHaveTally(a.score?.breakdown).found;
    const mb = mustHaveTally(b.score?.breakdown).found;
    if (ma !== mb) return mb - ma;
    return uploadOrder(a, b);
  });
}

/** "Candidate 07": numbered by upload order, so it never changes when scores do. */
export function pseudonyms(rows: RankRow[]): Map<string, string> {
  const byUpload = [...rows].sort(uploadOrder);
  const width = Math.max(2, String(byUpload.length).length);
  return new Map(
    byUpload.map((r, i) => [r.documentId, `Candidate ${String(i + 1).padStart(width, '0')}`]),
  );
}

/** Found, partly found and not found, must-haves first (spec 6.2.3). */
export function skillChips<I extends RankItem>(b: { items: I[] } | undefined) {
  const items = (b?.items ?? []).slice().sort((x, y) => {
    const w = (c: string) => (c === 'mandatory' ? 0 : 1);
    return w(x.classification) - w(y.classification);
  });
  const kind = (s: string): 'found' | 'partly' | 'missing' =>
    s === 'met' ? 'found' : s === 'partially_met' ? 'partly' : 'missing';
  return items.map((i) => ({ ...i, kind: kind(i.status) }));
}

/** Plain reason a file was not read, for the report's data-quality list (spec 6.5). */
export function unreadReason(r: Pick<RankRow, 'state' | 'parseStatus' | 'error'>): string | null {
  if (r.state === 'queued' || r.state === 'processing' || r.state === 'completed') return null;
  if (r.state === 'stopped') return 'Stopped before it was read';
  if (r.parseStatus === 'empty') return 'Scan only: no readable text in the file';
  if (r.parseStatus === 'failed') return 'Damaged or locked file';
  if (r.state === 'failed') return 'Could not be scored. Try again from the Table tab';
  return 'No readable text in the file';
}

export interface ReportCounts {
  read: number;
  scored: number;
  needLook: number;
  stopped: number;
  unread: number;
  total: number;
}

/** Header numbers for the evaluation report. "Need a human look" matches the Results screen. */
export function reportCounts(rows: RankRow[]): ReportCounts {
  const live = rows.filter((r) => !r.erased);
  const pending = live.filter(isPending).length;
  const stopped = live.filter((r) => r.state === 'stopped').length;
  const bands = live.map((r) => matchBand(r));
  const idle = live.map((r) => !isPending(r) && r.state !== 'stopped');
  return {
    total: live.length,
    read: live.length - pending - stopped,
    stopped,
    scored: bands.filter(
      (b, i) => idle[i] && (b === 'strong' || b === 'good' || b === 'partial' || b === 'limited'),
    ).length,
    needLook: bands.filter((b, i) => idle[i] && b === 'human').length,
    unread: live.filter((r) => unreadReason(r) !== null).length,
  };
}

export const KIND_NAME = {
  mandatory: 'Must-have',
  preferred: 'Nice-to-have',
  ignore: 'Ignore',
} as const;
export type Kind = keyof typeof KIND_NAME;

/**
 * The shared report (design spec 6.5): a snapshot taken when the recruiter shares. It is plain data
 * so the page that shows it needs no other call, and what a viewer sees cannot drift from what the
 * recruiter chose to share.
 */
/**
 * The experience asked for, as one short line ("3–5 years", "5+ years"), read from the wording of
 * the requirements. Null when no requirement states a number of years: nothing is guessed.
 */
export function experienceLine(texts: string[]): string | null {
  const unit = '(?:years?|yrs?|il|illik|года?|лет)';
  const range = new RegExp(`(\\d{1,2})\\s*(?:to|-|–|—|and)\\s*(\\d{1,2})\\s*\\+?\\s*${unit}`, 'i');
  const plus = new RegExp(
    `(?:(\\d{1,2})\\s*\\+\\s*${unit}|(\\d{1,2})\\s*(?:or more|and more|or above)\\s*${unit}|(?:at least|minimum(?: of)?|over|more than)\\s*(\\d{1,2})\\s*${unit})`,
    'i',
  );
  for (const t of texts) {
    const m = range.exec(t);
    if (m && Number(m[1]) < Number(m[2])) return `${m[1]}–${m[2]} years`;
  }
  for (const t of texts) {
    const m = plus.exec(t);
    const n = m && (m[1] ?? m[2] ?? m[3]);
    if (n) return `${n}+ years`;
  }
  return null;
}

export interface SnapshotChip {
  text: string;
  kind: 'found' | 'partly' | 'missing';
  classification: string;
}
export interface SnapshotCandidate {
  /** Internal key used to scrub the snapshot when a resume is erased; never sent to viewers. */
  documentId?: string;
  rank: number;
  /** "Candidate 07": always present. */
  label: string;
  /** Real name only when the recruiter included names and the candidate was revealed or shortlisted. */
  name: string | null;
  band: MatchBand;
  score: number;
  mustFound: number;
  mustTotal: number;
  chips: SnapshotChip[];
  /** Only the top candidates carry a reason and quotes. */
  expanded: boolean;
  summary: string | null;
  /** `page` is set for PDFs read after page numbers were kept; absent otherwise. */
  quotes: { requirement: string; quote: string; page?: number | null }[];
  missing: string | null;
}
export interface SharedReportSnapshot {
  version: 1;
  runId: string;
  title: string;
  takenAt: string;
  createdBy: string;
  includeNames: boolean;
  includeQuotes: boolean;
  counts: ReportCounts;
  role: { must: string[]; nice: string[]; ignored: string[]; experience?: string | null };
  method: {
    criteriaVersion: number | null;
    frozenAt: string | null;
    provider: string | null;
    model: string | null;
  };
  bands: Record<MatchBand, number>;
  candidates: SnapshotCandidate[];
  expandedCount: number;
  unread: { label: string; reason: string }[];
  changes: { text: string; by: string; at: string }[];
  /** `reason` is the reviewer's own words, with the candidate's name taken out unless shown. */
  decisions: {
    /** Internal key for scrubbing on erase; never sent to viewers. */
    documentId?: string;
    label: string;
    outcome: string;
    by: string;
    at: string;
    reason?: string;
  }[];
}
