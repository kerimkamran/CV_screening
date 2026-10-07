import type { Answer } from './assistant-rules';

/**
 * Azerbaijani wording for the answers the server writes itself (no model involved): the refusals,
 * the "check by hand" and "what would change" lists, and the facts line. The model's own answers
 * are written in the chosen language by the model and are not touched here. The offered follow-up
 * questions stay in English and are translated for display by the page. Wording is checked by
 * the same rules in either language, because the evidence and the state words come from the record.
 */

const FIXED: Record<string, string> = {
  'This CV needs a human look, so I have nothing to explain.':
    'Bu CV-yə insan baxışı lazımdır, ona görə izah edəcək bir şeyim yoxdur.',
  "That isn't related to the job requirements, so I can't use it.":
    'Bu, vəzifənin tələbləri ilə əlaqəli deyil, ona görə onu istifadə edə bilmirəm.',
  "I can't change how I work, but I can explain this candidate's stored match from the evidence.":
    'İş qaydamı dəyişə bilmərəm, amma bu namizədin saxlanmış uyğunluğunu sübutlar əsasında izah edə bilərəm.',
  "I can't recommend rejecting, ranking out or hiring anyone; that decision is yours. Here are the checks to do before deciding.":
    'Heç kimi rədd etməyi, siyahıdan çıxarmağı və ya işə götürməyi tövsiyə edə bilmərəm; bu qərar sizindir. Qərar verməzdən əvvəl bunları yoxlayın.',
  'Some passages were left out of what I can see, so the evidence may be incomplete.':
    'Bəzi hissələr mənim gördüklərimdən çıxarılıb, ona görə sübut natamam ola bilər.',
  'I only see the stored match and short passages, not the whole CV.':
    'Mən yalnız saxlanmış uyğunluğu və qısa hissələri görürəm, bütün CV-ni yox.',
  'My assessment is unchanged, because nothing in the record has changed.':
    'Qiymətləndirmə dəyişmir, çünki qeydlərdə heç nə dəyişməyib.',
  'The band moves only through changed requirements or new evidence in the CV; the decision is yours.':
    'Səviyyə yalnız dəyişdirilmiş tələblər və ya CV-dəki yeni sübut ilə dəyişir; qərar sizindir.',
  "I can't change the band from here. If it should count, adjust a requirement or scan again, and note it in your own decision reason.":
    'Səviyyəni buradan dəyişə bilmərəm. Bu nəzərə alınmalıdırsa, tələbi dəyişin və ya yenidən yoxlayın, qərar səbəbinizdə də qeyd edin.',
  'The band changes only through changed requirements or new evidence in the CV, never through this chat.':
    'Səviyyə yalnız dəyişdirilmiş tələblər və ya CV-dəki yeni sübut ilə dəyişir, bu söhbət vasitəsilə heç vaxt.',
  'Every must-have is found, so the band could only move down if the requirements became stricter.':
    'Bütün vacib tələblər tapılıb, ona görə səviyyə yalnız tələblər sərtləşərsə aşağı düşə bilər.',
  'Editing a requirement changes everyone’s ranking; you will see what it would do before it is applied.':
    'Tələbi dəyişmək hamının sıralamasını dəyişir; tətbiq olunmazdan əvvəl nəticəni görəcəksiniz.',
  'These are the points the stored record leaves open.': 'Saxlanmış qeyd bu məqamları açıq qoyur.',
  'Every requirement is found in the stored record.': 'Bütün tələblər saxlanmış qeyddə tapılıb.',
  'Some passages were left out of what I can see, so check the original CV as well.':
    'Bəzi hissələr mənim gördüklərimdən çıxarılıb, ona görə orijinal CV-ni də yoxlayın.',
  "I couldn't confirm that from the CV, so I'm not saying it.":
    'Bunu CV əsasında təsdiq edə bilmədim, ona görə demirəm.',
  'This is what the stored record shows; the decision is yours.':
    'Saxlanmış qeyd bunu göstərir; qərar sizindir.',
  'Challenge held: no CV evidence found against the band.':
    'Etiraz öz təsdiqini tapmadı: CV-də səviyyəyə qarşı sübut tapılmadı.',
};

const STATE: Record<string, string> = {
  found: 'tapıldı',
  'partly found': 'qismən tapıldı',
  'not found in this cv': 'bu CV-də tapılmadı',
  unclear: 'aydın deyil',
};
const state = (s: string) => STATE[s.trim().toLowerCase()] ?? s;

const BAND: Record<string, string> = {
  Strong: 'Güclü',
  Good: 'Yaxşı',
  Partial: 'Qismən',
  Limited: 'Məhdud',
  'Needs a human look': 'İnsan baxışı lazımdır',
};

/** Longest-first templates; `$1`… are the captured parts, whose own text is never translated. */
const PATTERNS: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^Check (.+) by hand: (.+)\.$/s, (m) => `${m[1]} üzrə əl ilə yoxlayın: ${state(m[2]!)}.`],
  [
    /^(.+): (found|partly found|not found in this CV|unclear)\. If the CV showed it, it would count as met; treating it as nice-to-have would lower its weight\.$/is,
    (m) =>
      `${m[1]}: ${state(m[2]!)}. CV bunu göstərsəydi, ödənilmiş sayılardı; üstünlük kimi qəbul etsəniz, çəkisi azalar.`,
  ],
  [
    /^(.+): (found|partly found|not found in this CV|unclear)\. Read the CV for it yourself\.$/is,
    (m) => `${m[1]}: ${state(m[2]!)}. CV-ni özünüz oxuyun.`,
  ],
  [/^That passage is in the CV: (".*)$/s, (m) => `Bu hissə CV-dədir: ${m[1]}`],
];

function facts(line: string): string {
  const m =
    /^(.+?) · (.+?) · (\d+) of (\d+) must-haves found(?: · not found in this CV: (.+))?$/s.exec(
      line,
    );
  if (!m) return line;
  return (
    `${m[1]} · ${BAND[m[2]!] ?? m[2]} · ${m[4]} vacib tələbdən ${m[3]} tapıldı` +
    (m[5] ? ` · bu CV-də tapılmadı: ${m[5]}` : '')
  );
}

export function azText(s: string): string {
  if (FIXED[s]) return FIXED[s];
  for (const [re, f] of PATTERNS) {
    const m = re.exec(s);
    if (m) return f(m);
  }
  return s;
}

/** The answer with the server-written sentences in Azerbaijani; everything else unchanged. */
export function localiseAnswer(a: Answer, lang: 'en' | 'az' | undefined): Answer {
  if (lang !== 'az') return a;
  return {
    ...a,
    headline: azText(a.headline),
    cantSee: azText(a.cantSee),
    claims: a.claims.map((c) => ({ ...c, text: azText(c.text) })),
    facts: a.facts.map(facts),
  };
}
