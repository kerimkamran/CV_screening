/**
 * Data minimisation for scoring (AISEC-03, design spec 6.6.4, docs/bias-review.md).
 *
 * The AI provider is shown the CV with the things that identify the person, or that a decision may
 * not rest on, replaced by neutral placeholders. Who the candidate is (name, e-mail) is read here,
 * by deterministic code, and stored by the server; the model is never asked for it and never sees it.
 *
 * Masked: e-mail addresses, phone numbers, links, the candidate's own name, and the value of
 * labelled personal fields (date of birth, age, gender, marital/family status, nationality,
 * religion, health, photo — in English, Azerbaijani and Russian). Everything else is left exactly
 * as written, so a quotation the model returns can still be found literally in the CV: the quote is
 * located in the masked text and mapped back to the original; a quote that touches a masked place
 * is not accepted as evidence.
 */

export interface Region {
  /** original [os, oe) was replaced by masked [ms, me) */
  os: number;
  oe: number;
  ms: number;
  me: number;
}

export interface MaskedCv {
  text: string;
  regions: Region[];
  /** how many places were masked, by kind (for the audit trail; never the values) */
  counts: Record<string, number>;
}

const HEADINGS = new Set(
  [
    'cv',
    'resume',
    'résumé',
    'curriculum vitae',
    'profile',
    'summary',
    'contact',
    'contacts',
    'experience',
    'education',
    'skills',
    'languages',
    'projects',
    'work experience',
    'personal details',
    'personal information',
    'about me',
    'objective',
    'references',
    'certifications',
    'courses',
    'tecrube',
    'təcrübə',
    'tehsil',
    'təhsil',
    'bacarıqlar',
    'резюме',
    'опыт',
    'образование',
    'навыки',
  ].map((s) => s.toLowerCase()),
);

const NAME_LABEL =
  /^\s*(?:full\s*name|name|first\s*name\s*(?:and|&)\s*last\s*name|ad\s*,?\s*soyad|adı\s*,?\s*soyadı|ad[ıi]|ф\.?и\.?о\.?|имя|фамилия\s*,?\s*имя)\s*[:\-–]\s*(.+?)\s*$/imu;

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
const PHONE = /(?<!\w)\+?\d[\d\s().-]{7,}\d(?!\w)/g;
const LINK =
  /https?:\/\/\S+|www\.\S+|(?:linkedin|github|facebook|instagram|t\.me)\.com\S*|t\.me\/\S+/gi;

/** "Label: value" lines whose value is personal, not professional. The value is masked. */
const PERSONAL_LABELS = [
  'date of birth',
  'birth date',
  'birthdate',
  'dob',
  'd\\.o\\.b\\.?',
  'born',
  'place of birth',
  'birthplace',
  'age',
  'gender',
  'sex',
  'marital status',
  'family status',
  'civil status',
  'children',
  'kids',
  'nationality',
  'citizenship',
  'ethnicity',
  'race',
  'religion',
  'faith',
  'health',
  'health status',
  'disability',
  'photo',
  'height',
  'weight',
  'military status',
  'spouse',
  'wife',
  'husband',
  "father'?s? name",
  "mother'?s? name",
  'place of residence',
  'address',
  'home address',
  // Azerbaijani
  'doğum tarixi',
  'dogum tarixi',
  'doğum yeri',
  'dogum yeri',
  'yaş',
  'yas',
  'cinsi',
  'cins',
  'ailə vəziyyəti',
  'aile veziyyeti',
  'övladları',
  'ovladlari',
  'milliyyət',
  'milliyyeti',
  'vətəndaşlıq',
  'vetendasliq',
  'din',
  'sağlamlıq',
  'saglamliq',
  'ünvan',
  'unvan',
  'hərbi vəziyyət',
  // Russian
  'дата рождения',
  'место рождения',
  'возраст',
  'пол',
  'семейное положение',
  'дети',
  'национальность',
  'гражданство',
  'религия',
  'здоровье',
  'фото',
  'рост',
  'вес',
  'адрес',
  'место жительства',
];
const PERSONAL_LINE = new RegExp(
  `^([ \\t>*•\\-–]*(?:${PERSONAL_LABELS.join('|')})[ \\t]*[:\\-–][ \\t]*)(.+)$`,
  'gimu',
);
const AGE_PHRASE =
  /(?<![\p{L}\p{N}])\d{2}\s*(?:years?[ -]old|y\.?o\.?|yaşında|летний|лет)(?![\p{L}\p{N}])/giu;
const AGED = /(?<![\p{L}\p{N}])aged\s+\d{2}(?![\p{L}\p{N}])/giu;

export interface Identity {
  name: string | null;
  email: string | null;
}

const looksLikeName = (line: string): boolean => {
  const t = line.trim();
  if (t.length < 5 || t.length > 60) return false;
  if (HEADINGS.has(t.toLowerCase())) return false;
  const words = t.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  return words.every((w) => /^[\p{L}][\p{L}'’.-]*$/u.test(w) && w.length >= 2);
};

/** The candidate's name and e-mail, read from the CV text by code (not by the model). */
export function extractIdentity(text: string): Identity {
  const email = text.match(EMAIL)?.[0]?.slice(0, 200) ?? null;
  const labelled = NAME_LABEL.exec(text.slice(0, 3000))?.[1];
  if (labelled && looksLikeName(labelled)) return { name: labelled.trim().slice(0, 200), email };
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 8);
  const first = lines.find((l) => looksLikeName(l));
  return { name: first ? first.slice(0, 200) : null, email };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Hit {
  s: number;
  e: number;
  kind: string;
  placeholder: string;
}

/** Replace what must not reach the provider; remember where, so evidence can be mapped back. */
export function maskForScoring(text: string, name: string | null): MaskedCv {
  const hits: Hit[] = [];
  const add = (re: RegExp, kind: string, placeholder: string) => {
    for (const m of text.matchAll(re)) {
      if (m[0].length) hits.push({ s: m.index!, e: m.index! + m[0].length, kind, placeholder });
    }
  };
  add(EMAIL, 'email', '[e-mail]');
  add(LINK, 'link', '[link]');
  for (const m of text.matchAll(PHONE)) {
    // Years, year ranges and dates also look like short digit runs; a phone number has 9+ digits.
    if (m[0].replace(/\D/g, '').length >= 9)
      hits.push({ s: m.index!, e: m.index! + m[0].length, kind: 'phone', placeholder: '[phone]' });
  }
  add(AGE_PHRASE, 'age', '[age]');
  add(AGED, 'age', '[age]');
  for (const m of text.matchAll(PERSONAL_LINE)) {
    const s = m.index! + m[1]!.length;
    hits.push({ s, e: s + m[2]!.length, kind: 'personal', placeholder: '[removed]' });
  }
  // The full name is masked wherever it appears; a single part (first or surname) only in the
  // spelling the CV gives it, so a surname that is also a skill word ("Routing") is not removed
  // from sentences that use the lower-case word.
  const parts = (name ?? '')
    .split(/\s+/)
    .map((x) => x.replace(/[^\p{L}\p{N}'’-]/gu, ''))
    .filter((x) => x.length >= 3);
  if (parts.length > 1) {
    add(
      new RegExp(`(?<![\\p{L}\\p{N}])${parts.map(escapeRe).join('\\s+')}(?![\\p{L}\\p{N}])`, 'giu'),
      'name',
      '[name]',
    );
  }
  for (const part of parts) {
    add(
      new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(part)}(?![\\p{L}\\p{N}])`, 'gu'),
      'name',
      '[name]',
    );
  }

  hits.sort((a, b) => a.s - b.s || b.e - a.e);
  const merged: Hit[] = [];
  for (const h of hits) {
    const last = merged[merged.length - 1];
    if (last && h.s < last.e) {
      if (h.e > last.e) last.e = h.e;
    } else merged.push({ ...h });
  }

  let out = '';
  let cursor = 0;
  const regions: Region[] = [];
  const counts: Record<string, number> = {};
  for (const h of merged) {
    out += text.slice(cursor, h.s);
    const ms = out.length;
    out += h.placeholder;
    regions.push({ os: h.s, oe: h.e, ms, me: out.length });
    counts[h.kind] = (counts[h.kind] ?? 0) + 1;
    cursor = h.e;
  }
  out += text.slice(cursor);
  return { text: out, regions, counts };
}

/**
 * A span found in the masked text, expressed in the original text; null when it touches a masked
 * place (its original wording would include the masked value, so it cannot be shown as a quotation).
 */
export function toOriginal(
  m: MaskedCv,
  start: number,
  end: number,
): { start: number; end: number } | null {
  let delta = 0;
  for (const r of m.regions) {
    if (r.me <= start) delta += r.oe - r.os - (r.me - r.ms);
    else if (r.ms < end) return null;
    else break;
  }
  return { start: start + delta, end: end + delta };
}
