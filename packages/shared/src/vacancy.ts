/**
 * Rules shared by the API and the web app for the Vacancy pool and the Candidate pool
 * (Development Plan, UAT round 1; design spec 6.7 to 6.9 and section 13).
 */

export const VACANCY_STATUSES = ['draft', 'open', 'on_hold', 'closed'] as const;
export type VacancyStatus = (typeof VACANCY_STATUSES)[number];
export const VACANCY_STATUS_LABEL: Record<VacancyStatus, string> = {
  draft: 'Draft',
  open: 'Open',
  on_hold: 'On hold',
  closed: 'Closed',
};

export const EXPERIENCE_RANGES = ['any', '1-3', '3-5', '5+'] as const;
export type ExperienceRange = (typeof EXPERIENCE_RANGES)[number];
export const EXPERIENCE_LINE: Record<ExperienceRange, string> = {
  any: '',
  '1-3': 'Experience: 1 to 3 years',
  '3-5': 'Experience: 3 to 5 years',
  '5+': 'Experience: 5 or more years',
};

/** The four marks a recruiter can set (spec 6.2.4). `hold` and `reject` are the stored names of Maybe and Not now. */
export const MARKS = ['new', 'shortlist', 'maybe', 'not_now'] as const;
export type Mark = (typeof MARKS)[number];
export const MARK_LABEL: Record<Mark, string> = {
  new: 'New',
  shortlist: 'Shortlist',
  maybe: 'Maybe',
  not_now: 'Not now',
};
/** Order used when sorting by decision: New, Shortlist, Maybe, Not now. */
export const MARK_ORDER: Record<Mark, number> = { new: 0, shortlist: 1, maybe: 2, not_now: 3 };

type Stored = 'new' | 'shortlist' | 'hold' | 'reject';
const TO_STORED: Record<Mark, Stored> = {
  new: 'new',
  shortlist: 'shortlist',
  maybe: 'hold',
  not_now: 'reject',
};
export const markToStored = (m: Mark): Stored => TO_STORED[m];
export const markFromStored = (s: string | null | undefined): Mark =>
  s === 'shortlist' ? 'shortlist' : s === 'hold' ? 'maybe' : s === 'reject' ? 'not_now' : 'new';

export const POOL_BANDS = ['strong', 'good', 'partial', 'limited'] as const;

/**
 * The folding used for every search and title match (spec section 13): Unicode NFKC, lower case
 * without regard to locale, and the Azerbaijani letters folded to their Latin base so that
 * "Şəbəkə", "sebeke" and "SEBEKE" are the same word. Dotted and dotless i fold together.
 */
export function foldText(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/İ/g, 'i')
    .replace(/I/g, 'i')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ə/gi, 'e')
    .replace(/ö/gi, 'o')
    .replace(/ü/gi, 'u')
    .replace(/ş/gi, 's')
    .replace(/ç/gi, 'c')
    .replace(/ğ/gi, 'g')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Sort order for titles in Azerbaijani: ç after c, ə after e, ğ after g, ı before i, and so on. */
export const azCollator = new Intl.Collator(['az', 'en'], { sensitivity: 'base', numeric: true });

/** "Candidate 07", numbered by upload order within the vacancy; the width follows the vacancy size. */
export function pseudonym(ordinal: number, total: number): string {
  const width = Math.max(2, String(Math.max(total, ordinal)).length);
  return `Candidate ${String(ordinal).padStart(width, '0')}`;
}
