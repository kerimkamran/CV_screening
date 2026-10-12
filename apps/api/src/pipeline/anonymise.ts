/**
 * The anonymised resume (design spec 6.9, Development Plan WP 3.5). The server replaces what
 * identifies a person, or what a decision may not rest on, with labelled blocks. Nothing here runs
 * in the browser: a response for the report or the resume never contains a hidden string.
 *
 * Always replaced: name (full name, parts, initials, patronymic), contact details, date of birth
 * and stated age, marital status, gender (field values and honorifics), nationality, ID numbers.
 * Shown unchanged: employers, schools, job titles, dates of employment, city, skills.
 * This is "hidden on screen", not a guarantee: a name written in an unusual way can survive, which
 * is why the 10-resume fixture pack must show zero misses and the screen says so.
 */

export interface AnonRegion {
  /** original [os, oe) was replaced by anonymised [ms, me) */
  os: number;
  oe: number;
  ms: number;
  me: number;
  kind: Kind;
}
export interface Anonymised {
  text: string;
  regions: AnonRegion[];
  counts: Partial<Record<Kind, number>>;
}

export type Kind =
  'name' | 'contact' | 'dob' | 'marital' | 'gender' | 'nationality' | 'id' | 'photo' | 'personal';

export const PLACEHOLDER: Record<Kind, string> = {
  name: '[name hidden]',
  contact: '[contact hidden]',
  dob: '[date of birth hidden]',
  marital: '[marital status hidden]',
  gender: '[gender hidden]',
  nationality: '[nationality hidden]',
  id: '[ID hidden]',
  photo: '[photo hidden]',
  personal: '[personal detail hidden]',
};

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const HANDLE = /(?<![\w@])@[A-Za-z][\w.]{2,}/g;
const PHONE = /(?<!\w)\+?\d[\d\s().-]{7,}\d(?!\w)/g;
const LINK =
  /https?:\/\/\S+|www\.\S+|(?:linkedin|github|facebook|instagram|twitter|t)\.(?:com|me)\/\S*|t\.me\/\S+/gi;
const POSTAL = /(?<![\p{L}\p{N}])AZ\s?-?\s?\d{4}(?![\p{L}\p{N}])/giu;
const STREET_LINE =
  /^.*(?:küç(?:əsi|\.)?|kuc\.|prospekt\w*|\bpr\.|mkr\b|massiv|street|\bst\.|avenue|\bave\.?\b|boulevard|ул\.|улица|проспект|пр-т|дом\s*\d).*\d.*$/gimu;

const GROUPS: [Kind, string[]][] = [
  [
    'dob',
    [
      'date of birth',
      'birth date',
      'birthdate',
      'dob',
      'd\\.o\\.b\\.?',
      'born',
      'place of birth',
      'birthplace',
      'age',
      'doğum tarixi',
      'dogum tarixi',
      'doğum yeri',
      'dogum yeri',
      'yaş',
      'yas',
      'дата рождения',
      'место рождения',
      'возраст',
    ],
  ],
  [
    'marital',
    [
      'marital status',
      'family status',
      'civil status',
      'children',
      'kids',
      'spouse',
      'wife',
      'husband',
      'ailə vəziyyəti',
      'aile veziyyeti',
      'övladları',
      'ovladlari',
      'семейное положение',
      'дети',
    ],
  ],
  ['gender', ['gender', 'sex', 'cinsi', 'cins', 'пол']],
  [
    'nationality',
    [
      'nationality',
      'citizenship',
      'ethnicity',
      'race',
      'religion',
      'faith',
      'milliyyət',
      'milliyyeti',
      'vətəndaşlıq',
      'vetendasliq',
      'din',
      'национальность',
      'гражданство',
      'религия',
    ],
  ],
  ['photo', ['photo', 'фото', 'şəkil', 'sekil']],
  [
    'contact',
    [
      'address',
      'home address',
      'place of residence',
      'ünvan',
      'unvan',
      'адрес',
      'место жительства',
      'phone',
      'tel',
      'telephone',
      'mobile',
      'mob',
      'cell',
      'telefon',
      'e-?mail',
      'email',
      'skype',
      'telegram',
      'whatsapp',
      'viber',
      'linkedin',
      'github',
      'facebook',
      'instagram',
      'телефон',
      'почта',
    ],
  ],
  [
    'id',
    [
      'passport(?:\\s*(?:no\\.?|number|№|#))?',
      'pasport(?:\\s*(?:no\\.?|nömrəsi|№|#))?',
      'паспорт(?:\\s*(?:no\\.?|номер|№|#))?',
      'fin(?:\\s*(?:code|kod))?',
      'фин',
      'vöen',
      'voen',
      'инн',
      'tax\\s*(?:id|number|no\\.?)',
      'ssn',
      "driver'?s?\\s*licen[sc]e(?:\\s*(?:no\\.?|number))?",
      'sürücülük\\s*vəsiqəsi',
      'id\\s*card(?:\\s*(?:no\\.?|number))?',
      'şəxsiyyət\\s*vəsiqəsi',
      'удостоверение\\s*личности',
    ],
  ],
  [
    'personal',
    [
      'health',
      'health status',
      'disability',
      'height',
      'weight',
      'military status',
      "father'?s? name",
      "mother'?s? name",
      'sağlamlıq',
      'saglamliq',
      'hərbi vəziyyət',
      'здоровье',
      'рост',
      'вес',
    ],
  ],
];

const labelLine = (labels: string[]) =>
  new RegExp(`^([ \\t>*•\\-–]*(?:${labels.join('|')})[ \\t]*[:\\-–][ \\t]*)(.+)$`, 'gimu');

const AGE_PHRASE =
  /(?<![\p{L}\p{N}])\d{2}\s*(?:years?[ -]old|y\.?o\.?|yaşında|летний|лет)(?![\p{L}\p{N}])/giu;
const AGED = /(?<![\p{L}\p{N}])aged\s+\d{2}(?![\p{L}\p{N}])/giu;
const HONORIFIC_EN = /(?<![\p{L}\p{N}])(?:Mr|Mrs|Ms|Miss|Mx)\.?(?=\s+\p{Lu})/gu;
const HONORIFIC_OTHER =
  /(?<![\p{L}\p{N}])(?:Cənab|Cenab|Xanım|Xanim|Господин|Госпожа|г-н|г-жа)(?![\p{L}\p{N}])/giu;
const PATRONYMIC =
  /(?<![\p{L}\p{N}])\p{Lu}[\p{L}'’-]+\s+(?:oğlu|oglu|qızı|qizi|gizi|kızı|ogly|kyzy|оглы|кызы)(?![\p{L}\p{N}])/gu;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Hit {
  s: number;
  e: number;
  kind: Kind;
}

/** Every spelling of a name worth hiding: the full name and each part of three letters or more. */
export function nameParts(names: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const n of names) {
    for (const raw of (n ?? '').split(/\s+/)) {
      const p = raw.replace(/[^\p{L}\p{N}'’-]/gu, '');
      if (p.length >= 3) out.add(p);
    }
  }
  return [...out];
}

export function anonymise(text: string, names: (string | null | undefined)[] = []): Anonymised {
  const hits: Hit[] = [];
  const add = (re: RegExp, kind: Kind) => {
    for (const m of text.matchAll(re)) {
      if (m[0].length) hits.push({ s: m.index!, e: m.index! + m[0].length, kind });
    }
  };
  add(EMAIL, 'contact');
  add(LINK, 'contact');
  add(HANDLE, 'contact');
  add(POSTAL, 'contact');
  add(STREET_LINE, 'contact');
  for (const m of text.matchAll(PHONE)) {
    if (m[0].replace(/\D/g, '').length >= 9)
      hits.push({ s: m.index!, e: m.index! + m[0].length, kind: 'contact' });
  }
  add(AGE_PHRASE, 'dob');
  add(AGED, 'dob');
  add(HONORIFIC_EN, 'gender');
  add(HONORIFIC_OTHER, 'gender');
  add(PATRONYMIC, 'name');
  for (const [kind, labels] of GROUPS) {
    for (const m of text.matchAll(labelLine(labels))) {
      const s = m.index! + m[1]!.length;
      hits.push({ s, e: s + m[2]!.length, kind });
    }
  }
  // Date of birth written as a bare date after "born" is covered above; a full date in the first
  // lines beside a name is not guessed at.

  const parts = nameParts(names);
  const flat = names.map((n) => (n ?? '').trim()).filter((n) => n.split(/\s+/).length > 1);
  for (const full of flat) {
    const words = full.split(/\s+/).map(escapeRe);
    add(new RegExp(`(?<![\\p{L}\\p{N}])${words.join('\\s+')}(?![\\p{L}\\p{N}])`, 'giu'), 'name');
  }
  for (const part of parts) {
    const e = escapeRe(part);
    // Every case form: a name is hidden wherever it appears, even where a surname doubles as a skill word.
    const forms = new Set([
      part,
      part.toLocaleUpperCase('az'),
      part.toLocaleUpperCase('en'),
      part.charAt(0).toLocaleUpperCase('az') + part.slice(1).toLocaleLowerCase('az'),
      part.charAt(0).toLocaleUpperCase('en') + part.slice(1).toLocaleLowerCase('en'),
    ]);
    for (const f of forms) {
      add(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(f)}(?![\\p{L}\\p{N}])`, 'giu'), 'name');
    }
    // Initials: "R. Aliyev", "Aliyev R.", "Aliyev R. A."
    add(
      new RegExp(
        `(?<![\\p{L}\\p{N}])\\p{Lu}\\.\\s*(?:\\p{Lu}\\.\\s*)?${e}(?![\\p{L}\\p{N}])`,
        'gu',
      ),
      'name',
    );
    add(new RegExp(`(?<![\\p{L}\\p{N}])${e}\\s+\\p{Lu}\\.(?:\\s*\\p{Lu}\\.)?`, 'gu'), 'name');
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
  const regions: AnonRegion[] = [];
  const counts: Partial<Record<Kind, number>> = {};
  for (const h of merged) {
    out += text.slice(cursor, h.s);
    const ms = out.length;
    out += PLACEHOLDER[h.kind];
    regions.push({ os: h.s, oe: h.e, ms, me: out.length, kind: h.kind });
    counts[h.kind] = (counts[h.kind] ?? 0) + 1;
    cursor = h.e;
  }
  out += text.slice(cursor);
  return { text: out, regions, counts };
}

/** A position in the original text, expressed in the anonymised text (snapped out of a hidden block). */
export function toAnon(regions: AnonRegion[], pos: number, edge: 'start' | 'end'): number {
  let delta = 0;
  for (const r of regions) {
    if (r.oe <= pos) delta += r.me - r.ms - (r.oe - r.os);
    else if (r.os < pos) return edge === 'start' ? r.ms : r.me;
    else break;
  }
  return pos + delta;
}

/** A position in the anonymised text, expressed in the original (used to search the original view). */
export function toAnonRange(regions: AnonRegion[], start: number, end: number) {
  return { start: toAnon(regions, start, 'start'), end: toAnon(regions, end, 'end') };
}

/** Hide names and contact details in a short sentence (a summary or a reason) the same way. */
export function anonymiseLine(
  s: string | null,
  names: (string | null | undefined)[],
): string | null {
  if (s === null) return null;
  return anonymise(s, names).text;
}
