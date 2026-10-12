/**
 * The consistency mirror at the moment of a decision (SenAI plan M2). Private to the recruiter: only
 * their own marks are read. It never blocks a mark, is never a verdict, and speaks once per pair.
 */
import { foldText, markFromStored, type Mark } from '@cv/shared';
import type { Queryable } from '../db/db.service';

const uw = (alts: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts.replace(/\*/g, '\\p{L}*')})(?![\\p{L}\\p{N}])`, 'iu');

/** Reasons that are not about the job: age, family, looks, origin, place. Folded and original spellings. */
export const NOT_JOB_RELATED = uw(
  'old|young|age|aged|married|single|evli*|subay|yas*|yaş*|ganja|gence|gəncə|sumqayit|sumgait|lenkeran|lənkəran|sheki|şəki|accent|surname|looks|ugly|fat|женат*|замужем|стар*|молод*|гянджи|акцент|внешн*|национ*|religio*|din|dini',
);

export interface Mirror {
  kind: 'pair' | 'reason';
  /** The other candidate of the pair (kind pair). */
  with?: string;
  /** The mark the other candidate has (kind pair). */
  mark?: Mark;
}

const markOf = (s: string): Mark => markFromStored(s);
const positive = (m: string) => m === 'shortlist' || m === 'maybe';
interface Item {
  text: string;
  classification: string;
  status: string;
}
const signature = (items: Item[] | null): string =>
  (items ?? [])
    .filter((i) => i.classification === 'mandatory')
    .map((i) => `${i.text}:${i.status}`)
    .sort()
    .join('|');

/** Called inside the mark's transaction, after the mark is saved. Returns what to say, if anything. */
export async function mirrorFor(
  tx: Queryable,
  userId: string,
  documentId: string,
  vacancyId: string,
  mark: Mark,
  note: string | null,
): Promise<Mirror | null> {
  if (
    mark === 'not_now' &&
    note &&
    (NOT_JOB_RELATED.test(note) || NOT_JOB_RELATED.test(foldText(note)))
  )
    return { kind: 'reason' };
  if (mark === 'new') return null;
  const { rows } = await tx.query<{
    document_id: string;
    outcome: string;
    name: string | null;
    items: Item[] | null;
  }>(
    `WITH mine AS (
       SELECT DISTINCT ON (s.document_id) s.document_id, x.outcome
         FROM decision x JOIN screening s ON s.id = x.screening_id
         JOIN cv_document d ON d.id = s.document_id
        WHERE d.vacancy_id = $1 AND x.decided_by = $2 AND d.erased_at IS NULL
        ORDER BY s.document_id, x.decided_at DESC, x.id DESC)
     SELECT m.document_id, m.outcome, sc.candidate_name AS name, sc.breakdown->'items' AS items
       FROM mine m JOIN LATERAL (
         SELECT candidate_name, breakdown FROM screening
          WHERE document_id = m.document_id AND state = 'completed'
          ORDER BY completed_at DESC LIMIT 1) sc ON true`,
    [vacancyId, userId],
  );
  const me = rows.find((r) => r.document_id === documentId);
  if (!me) return null;
  const sig = signature(me.items);
  if (!sig) return null;
  for (const r of rows) {
    if (r.document_id === documentId) continue;
    if (signature(r.items) !== sig) continue;
    const theirs = markOf(r.outcome);
    const opposite =
      (positive(mark) && theirs === 'not_now') || (mark === 'not_now' && positive(theirs));
    if (!opposite) continue;
    const [a, b] = [documentId, r.document_id].sort();
    const fresh = await tx.query(
      `INSERT INTO assistant_mirror_seen (user_id, doc_a, doc_b) VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING RETURNING 1`,
      [userId, a, b],
    );
    if (!fresh.rows.length) return null;
    return { kind: 'pair', with: r.name ?? undefined, mark: theirs };
  }
  return null;
}
