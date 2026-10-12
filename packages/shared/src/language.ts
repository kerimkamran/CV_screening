/**
 * One way of reading messy text, shared by search, vacancy-title matching, the skills dictionary
 * and SenAI (SenAI plan section 4.2). Azerbaijani typed with or without diacritics, in Cyrillic or
 * Latin, Russian typed in Latin letters, and typos all end up in the same folded form.
 *
 * Folded form: lower case, no diacritics (ə→e, ö→o, ü→u, ş→s, ç→c, ğ→g, ı→i), Cyrillic written in
 * Latin letters, punctuation turned into single spaces. It is only for comparing; the original text is
 * always kept for display.
 */

const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF\u00AD]/g;

const CYR: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'j',
  з: 'z',
  и: 'i',
  й: 'i',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'x',
  ц: 'c',
  ч: 'c',
  ш: 's',
  щ: 's',
  ъ: '',
  ы: 'i',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  // Azerbaijani Cyrillic
  ә: 'e',
  ғ: 'g',
  ҝ: 'g',
  ҹ: 'c',
  ң: 'n',
  ө: 'o',
  ү: 'u',
  һ: 'h',
  ј: 'y',
  ґ: 'g',
  і: 'i',
  ї: 'i',
};

/** Latin look-alikes of Cyrillic letters, used when one word mixes both scripts. */
const TO_LATIN: Record<string, string> = {
  а: 'a',
  е: 'e',
  о: 'o',
  р: 'p',
  с: 'c',
  х: 'x',
  у: 'y',
  к: 'k',
  м: 'm',
  н: 'h',
  т: 't',
  в: 'b',
  А: 'A',
  Е: 'E',
  О: 'O',
  Р: 'P',
  С: 'C',
  Х: 'X',
  У: 'Y',
  К: 'K',
  М: 'M',
  Н: 'H',
  Т: 'T',
  В: 'B',
};

/** NFKC, no zero-width or bidirectional control characters, look-alike letters inside Latin words fixed. */
export function clean(s: string): string {
  const t = s.normalize('NFKC').replace(INVISIBLE, '');
  return t.replace(/[\p{L}\p{M}]+/gu, (w) => {
    const hasLatin = /[A-Za-z]/.test(w);
    const hasCyr = /[Ѐ-ӿ]/.test(w);
    if (!(hasLatin && hasCyr)) return w;
    return w.replace(/[Ѐ-ӿ]/g, (c) => TO_LATIN[c] ?? c);
  });
}

/** Cyrillic letters written in Latin ones (Кубернетес → kubernetes, питон → piton). */
export function translit(s: string): string {
  let out = '';
  for (const ch of s) out += CYR[ch.toLowerCase()] ?? ch;
  return out;
}

/** Folded form for comparing (see the top of this file). */
export function fold(s: string): string {
  return translit(
    clean(s)
      .replace(/İ/g, 'i')
      .replace(/I/g, 'i')
      .replace(/ı/g, 'i')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/ə/g, 'e')
      .replace(/ö/g, 'o')
      .replace(/ü/g, 'u')
      .replace(/ş/g, 's')
      .replace(/ç/g, 'c')
      .replace(/ğ/g, 'g'),
  )
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Folded words of a text. */
export const tokens = (s: string): string[] => fold(s).split(' ').filter(Boolean);

// Azerbaijani endings, longest first. Only cut when a stem of 4 or more letters stays.
export const AZ_ENDINGS = [
  'larin',
  'lerin',
  'lardan',
  'lerden',
  'larda',
  'lerde',
  'lara',
  'lere',
  'lari',
  'leri',
  'lar',
  'ler',
  'inin',
  'unun',
  'nin',
  'nun',
  'dan',
  'den',
  'tan',
  'ten',
  'da',
  'de',
  'ta',
  'te',
  'ya',
  'ye',
  'na',
  'ne',
  'ni',
  'nu',
  'si',
  'su',
  'in',
  'un',
  'le',
  'la',
  'ci',
  'ciler',
  'ciya',
  'siz',
  'li',
  'i',
  'u',
  'a',
  'e',
];
// Russian endings (folded), only for the stem comparison.
const RU_ENDINGS = [
  'ami',
  'ov',
  'ev',
  'ah',
  'iah',
  'ej',
  'oj',
  'ij',
  'yj',
  'ie',
  'ye',
  'oe',
  'ae',
  'am',
  'om',
  'em',
  'ov',
  'u',
  'y',
  'a',
  'e',
  'i',
  'o',
];

/** Is this what is left after a word with an Azerbaijani ending ("excel" + "de")? */
export const isEnding = (rest: string): boolean => rest.length > 0 && AZ_ENDINGS.includes(rest);

/** A light stem: the word without a common Azerbaijani or Russian ending, never shorter than 4 letters. */
export function stem(word: string): string {
  let w = word;
  for (let pass = 0; pass < 2; pass++) {
    let cut = false;
    for (const e of AZ_ENDINGS) {
      if (w.length - e.length >= 4 && w.endsWith(e)) {
        w = w.slice(0, -e.length);
        cut = true;
        break;
      }
    }
    if (!cut) break;
  }
  for (const e of RU_ENDINGS) {
    if (w.length - e.length >= 5 && w.endsWith(e)) {
      w = w.slice(0, -e.length);
      break;
    }
  }
  return w;
}

/** Damerau-Levenshtein distance, stopping early once it passes `max`. */
export function editDistance(a: string, b: string, max = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        v = Math.min(v, prev2[j - 2]! + 1);
      cur.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev2[j] = prev[j]!;
    prev = cur;
  }
  return prev[b.length]!;
}

/** How many typos a word of this length may have: none under 4 letters, one up to 7, then two. */
export const typoBudget = (len: number): number => (len < 4 ? 0 : len < 8 ? 1 : 2);

/** The closest word of a closed vocabulary within the typo budget, or null. Ties return null. */
export function closest(word: string, vocab: Iterable<string>): string | null {
  const budget = typoBudget(word.length);
  if (budget === 0) return null;
  let best: string | null = null;
  let bd = budget + 1;
  let tie = false;
  for (const v of vocab) {
    if (Math.abs(v.length - word.length) > budget) continue;
    const d = editDistance(word, v, budget);
    if (d < bd) {
      bd = d;
      best = v;
      tie = false;
    } else if (d === bd && v !== best) tie = true;
  }
  return best && bd <= budget && !tie ? best : null;
}
