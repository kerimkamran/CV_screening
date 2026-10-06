import { describe, expect, it } from 'vitest';
import type { CandidateRow } from './api';
import { shortlistCsv, shortlistEntries, shortlistText } from './shortlist';

const row = (
  id: string,
  score: number,
  outcome: string | null,
  reason = 'Good routing depth',
): CandidateRow =>
  ({
    documentId: id,
    state: 'completed',
    band: 'possible_match',
    score: {
      value: score,
      breakdown: {
        items: [
          { classification: 'mandatory', status: 'met' },
          { classification: 'mandatory', status: 'not_found' },
        ],
      },
    },
    decision: outcome ? { outcome, reason, decidedAt: 'x', decidedBy: 'me' } : null,
  }) as unknown as CandidateRow;

describe('shortlist export', () => {
  const rows = [
    row('a', 90, 'shortlist'),
    row('b', 80, 'hold'),
    row('c', 70, 'shortlist', '=HYPERLINK("x")'),
  ];
  const entries = shortlistEntries(rows, (r) => `Candidate ${r.documentId}`);

  it('contains only the shortlisted, in ranked order, with the band written out', () => {
    expect(entries.map((e) => e.name)).toEqual(['Candidate a', 'Candidate c']);
    expect(entries[0]).toMatchObject({ band: 'Strong', mustHaves: '1 of 2' });
  });

  it('copies as plain numbered lines', () => {
    expect(shortlistText(entries).split('\n')[0]).toBe(
      '1. Candidate a (Strong, must-haves found 1 of 2) Good routing depth',
    );
  });

  it('writes a CSV that cannot run a formula and escapes quotes', () => {
    const csv = shortlistCsv(entries);
    expect(csv.split('\r\n')[0]).toBe('"Candidate","Match","Must-haves found","My note"');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });
});
