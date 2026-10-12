/**
 * SenAI over the Candidate pool (Development Plan WP 4.3 and 4.4, design spec 6.6.9 to 6.6.11).
 *
 * Here: language detection, which vacancy a question names, and the sentences of every answer.
 * What the question means is read in senai/understand.ts (rules, then a model for what the rules
 * cannot read). The numbers and the order come from the pool (the server's rows) and the sentences
 * are written here, so nothing in an answer can be invented and no resume text goes to a model.
 */
import { foldText } from '@cv/shared';

export type Lang = 'en' | 'az' | 'ru';

/** The language the question is written in, or null when it says nothing (a bare number, an empty text). */
export function detectLanguage(text: string): Lang | null {
  if (/[Ѐ-ӿ]/.test(text)) return 'ru';
  if (/[əƏğĞşŞçÇöÖüÜıİ]/.test(text)) return 'az';
  const f = foldText(text);
  if (
    /(^| )(ucun|namized\w*|vakansiya\w*|tap|tapin|goster\w*|necə|nece|en yaxsi|haqqinda|hamisi|qisa siyahi|ile|ve|var|yox|kim)( |$)/.test(
      f,
    )
  )
    return 'az';
  return /[a-z]/.test(f) ? 'en' : null;
}

const ENGLISH = new Set(
  'the a an of for in on at to and or who what which how find show list give get best top all with that have has is are do does can you me my candidates candidate resume resumes vacancy vacancies know knows skill skills experience shortlist count many only also more less this those these them it its from by about please'.split(
    ' ',
  ),
);
/** Does the text hold a common English word? A bare "ingilis dili" does not, so the conversation's language wins. */
export const looksEnglish = (text: string): boolean =>
  foldText(text)
    .split(' ')
    .some((w) => ENGLISH.has(w));

// ----------------------------------------------------------------------------- vacancy resolution

const STOP = new Set([
  'the',
  'a',
  'an',
  'of',
  'for',
  'and',
  'in',
  'to',
  'at',
  've',
  'ile',
  'ucun',
  'на',
  'для',
  'и',
  'в',
]);
/** Words that name a level, not a job: they alone never make a match. */
const GENERIC = new Set([
  'senior',
  'junior',
  'lead',
  'middle',
  'mid',
  'head',
  'chief',
  'principal',
  'intern',
  'specialist',
  'expert',
  'manager',
  'baş',
  'bas',
  'aparici',
  'старший',
  'младший',
  'ведущий',
]);

/** Words that mean the same in English, Azerbaijani and Russian (folded). One group per idea. */
export const SYNONYMS: string[][] = [
  ['network', 'net', 'networking', 'sebeke', 'сеть', 'сетевой', 'сетей'],
  ['engineer', 'engineering', 'muhendis', 'инженер'],
  ['developer', 'dev', 'programmer', 'proqramci', 'proqramlasdirici', 'разработчик', 'программист'],
  ['software', 'proqram', 'программное', 'по'],
  ['manager', 'menecer', 'rehber', 'менеджер', 'руководитель'],
  ['analyst', 'analitik', 'analiz', 'аналитик'],
  ['designer', 'dizayner', 'дизайнер'],
  ['accountant', 'accounting', 'muhasib', 'muhasibat', 'бухгалтер'],
  ['sales', 'satis', 'продажи', 'продаж'],
  ['support', 'destek', 'дyes', 'поддержка'],
  ['security', 'tehlukesizlik', 'безопасность', 'информационной'],
  ['data', 'melumat', 'данные', 'данных'],
  ['project', 'layihe', 'проект', 'проектов'],
  ['recruiter', 'recruitment', 'kadr', 'рекрутер'],
  ['devops', 'sre'],
  ['qa', 'tester', 'testing', 'test', 'тестировщик'],
  ['cloud', 'bulud', 'облачный'],
  ['marketing', 'marketinq', 'маркетинг'],
];
const GROUP = new Map<string, number>();
SYNONYMS.forEach((g, i) => g.forEach((w) => GROUP.set(foldText(w), i)));

const words = (s: string) =>
  foldText(s)
    .split(' ')
    .filter((w) => w && !STOP.has(w));

/** Does a word in the question stand for this title word? Same word, same idea, or the same stem (Azerbaijani suffixes). */
function groupOf(w: string): number | undefined {
  const exact = GROUP.get(w);
  if (exact !== undefined) return exact;
  if (w.length < 5) return undefined;
  for (const [g, i] of GROUP) if (g.length >= 5 && (w.startsWith(g) || g.startsWith(w))) return i;
  return undefined;
}

function same(q: string, t: string): boolean {
  if (q === t) return true;
  const gq = groupOf(q);
  if (gq !== undefined && gq === groupOf(t)) return true;
  if (q.length >= 4 && t.length >= 4 && (q.startsWith(t) || t.startsWith(q))) return true;
  // The title word with an Azerbaijani suffix cut (şəbəkə → sebeke, sebekeler, sebekesi)
  if (t.length >= 5 && q.length >= 5 && q.slice(0, 5) === t.slice(0, 5)) return true;
  return false;
}

export type Tier = 'exact' | 'close' | 'partial';
export interface VacancyRef {
  id: string;
  title: string;
  status: string;
}
export interface Resolution {
  tier: Tier | 'none';
  matches: VacancyRef[];
}

/** How well one vacancy title is named in the question. */
export function tierOf(question: string, title: string): Tier | 'none' {
  const q = foldText(question);
  const t = foldText(title);
  if (!t) return 'none';
  if (new RegExp(`(^| )${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(q)) return 'exact';
  const qw = words(question);
  const tw = words(title);
  if (!tw.length) return 'none';
  const hit = tw.filter((w) => qw.some((x) => same(x, w)));
  if (hit.length === tw.length) return 'close';
  const specific = hit.filter((w) => !GENERIC.has(w));
  if (hit.length >= Math.ceil(tw.length / 3) && specific.length >= 1) return 'partial';
  return 'none';
}

const ORDER: Tier[] = ['exact', 'close', 'partial'];

/** The best tier that has any vacancy, with every vacancy in that tier. */
export function resolveVacancy(question: string, vacancies: VacancyRef[]): Resolution {
  const scored = vacancies.map((v) => ({ v, t: tierOf(question, v.title) }));
  for (const tier of ORDER) {
    const hits = scored.filter((s) => s.t === tier).map((s) => s.v);
    if (hits.length) {
      // An exact title that contains another vacancy's title wins over it ("Network Engineer" inside "Senior Network Engineer").
      if (tier === 'exact' && hits.length > 1) {
        const longest = Math.max(...hits.map((h) => foldText(h.title).length));
        const top = hits.filter((h) => foldText(h.title).length === longest);
        return { tier, matches: top };
      }
      return { tier, matches: hits };
    }
  }
  return { tier: 'none', matches: [] };
}

// ----------------------------------------------------------------------------- wording

type Dict = Record<Lang, string>;
const D = {
  found: {
    en: 'Found {n} for {title}: {strong} Strong, {good} Good, {partial} Partial, {limited} Limited.',
    az: '{title} üçün {n} namizəd tapıldı: {strong} Güclü, {good} Yaxşı, {partial} Qismən, {limited} Məhdud.',
    ru: 'Кандидатов для «{title}»: {n} — Сильное {strong}, Хорошее {good}, Частичное {partial}, Слабое {limited}.',
  },
  count: {
    en: '{title} has {n} analyzed resumes ({strong} Strong, {shortlist} on the Shortlist).',
    az: '{title} üçün {n} təhlil olunmuş CV var ({strong} Güclü, {shortlist} qısa siyahıda).',
    ru: 'Для «{title}» проанализировано резюме: {n} (Сильное {strong}, в коротком списке {shortlist}).',
  },
  shortlist: {
    en: '{n} on the Shortlist for {title}.',
    az: '{title} üçün qısa siyahıda {n} namizəd var.',
    ru: 'В коротком списке для «{title}»: {n}.',
  },
  shortlistNone: {
    en: 'Nobody is on the Shortlist for {title} yet.',
    az: '{title} üçün qısa siyahıda hələ heç kim yoxdur.',
    ru: 'В коротком списке для «{title}» пока никого нет.',
  },
  top: {
    en: 'Showing the top {k}.',
    az: 'İlk {k} göstərilir.',
    ru: 'Показаны первые {k}.',
  },
  outOfDate: {
    en: '{n} were scored against earlier requirements. Re-analyze to refresh them.',
    az: '{n} nəticə əvvəlki tələblərə görə hesablanıb. Yeniləmək üçün yenidən təhlil edin.',
    ru: '{n} результатов получены по прежним требованиям. Проанализируйте заново, чтобы обновить.',
  },
  running: {
    en: '{n} resumes are being analyzed now, so this list will change.',
    az: '{n} CV hazırda təhlil olunur, ona görə bu siyahı dəyişəcək.',
    ru: 'Сейчас анализируется резюме: {n}, поэтому список изменится.',
  },
  unanalyzed: {
    en: '{n} resumes have no result yet and need a look.',
    az: '{n} CV üçün hələ nəticə yoxdur və baxış tələb edir.',
    ru: 'Для {n} резюме пока нет результата, нужен ручной просмотр.',
  },
  noResumes: {
    en: '{title} has no resumes yet. Add some on the vacancy page.',
    az: '{title} üçün hələ CV yoxdur. Vakansiya səhifəsində əlavə edin.',
    ru: 'Для «{title}» пока нет резюме. Добавьте их на странице вакансии.',
  },
  noneAnalyzed: {
    en: 'No resume for {title} has a result yet.',
    az: '{title} üçün heç bir CV-nin hələ nəticəsi yoxdur.',
    ru: 'Ни у одного резюме для «{title}» пока нет результата.',
  },
  which: {
    en: 'Which vacancy do you mean?',
    az: 'Hansı vakansiyanı nəzərdə tutursunuz?',
    ru: 'Какую вакансию вы имеете в виду?',
  },
  confirm: {
    en: 'Is this the vacancy you mean?',
    az: 'Bu, nəzərdə tutduğunuz vakansiyadır?',
    ru: 'Вы имеете в виду эту вакансию?',
  },
  noMatch: {
    en: 'I could not find a vacancy that matches that. Pick one to search:',
    az: 'Buna uyğun vakansiya tapa bilmədim. Axtarmaq üçün birini seçin:',
    ru: 'Я не нашёл подходящую вакансию. Выберите, где искать:',
  },
  noVacancies: {
    en: 'There are no vacancies to search yet.',
    az: 'Axtarmaq üçün hələ vakansiya yoxdur.',
    ru: 'Пока нет вакансий для поиска.',
  },
  archived: {
    en: '{title} is archived, so I leave it out. Restore it to search it.',
    az: '{title} arxivdədir, ona görə onu axtarışa daxil etmirəm. Axtarmaq üçün bərpa edin.',
    ru: '«{title}» в архиве, поэтому я её не использую. Восстановите её, чтобы искать.',
  },
  decision: {
    en: "I can't recommend who to hire or reject; that decision is yours. I can show who matches the requirements best.",
    az: 'Kimi işə götürmək və ya rədd etmək barədə tövsiyə verə bilmərəm; bu qərar sizindir. Tələblərə ən yaxşı uyğun olanları göstərə bilərəm.',
    ru: 'Я не могу рекомендовать, кого нанять или отклонить: решение за вами. Могу показать, кто лучше всего соответствует требованиям.',
  },
  protectedAttr: {
    en: "That isn't related to the job requirements, so I can't use it.",
    az: 'Bu, vəzifənin tələbləri ilə əlaqəli deyil, ona görə onu istifadə edə bilmirəm.',
    ru: 'Это не связано с требованиями к должности, поэтому я не могу это использовать.',
  },
  hijack: {
    en: "I can't change how I work. I can find the best matches for a vacancy from the stored results.",
    az: 'İş qaydamı dəyişə bilmərəm. Saxlanmış nəticələrə əsasən vakansiya üçün ən yaxşı uyğunları tapa bilərəm.',
    ru: 'Я не могу менять правила работы. Могу найти лучшие совпадения для вакансии по сохранённым результатам.',
  },
  skillFound: {
    en: 'Candidates whose resume mentions {skills}: {n} ({scope}).',
    az: 'CV-sində {skills} qeyd olunan namizədlər: {n} ({scope}).',
    ru: 'Кандидаты, у которых в резюме упомянуто {skills}: {n} ({scope}).',
  },
  skillNone: {
    en: 'No resume mentions {skills} ({scope}).',
    az: 'Heç bir CV-də {skills} qeyd olunmayıb ({scope}).',
    ru: 'Ни в одном резюме не упомянуто {skills} ({scope}).',
  },
  skillNote: {
    en: 'This shows what the resumes say, not how well the person knows it. Open the resume to check.',
    az: 'Bu, CV-lərdə yazılanı göstərir, biliyin səviyyəsini yox. Yoxlamaq üçün CV-yə baxın.',
    ru: 'Это то, что написано в резюме, а не уровень владения. Откройте резюме, чтобы проверить.',
  },
  skillUnsearched: {
    en: '{n} resumes have no analysis yet, so they were not searched.',
    az: '{n} CV hələ təhlil olunmayıb, ona görə axtarışa daxil edilməyib.',
    ru: '{n} резюме ещё не проанализированы, поэтому поиск по ним не выполнялся.',
  },
  skillScopePage: {
    en: 'I searched only {title}. To search every vacancy, ask again with "all vacancies".',
    az: 'Yalnız {title} üzrə axtardım. Bütün vakansiyalarda axtarmaq üçün "bütün vakansiyalarda" yazın.',
    ru: 'Я искал только в «{title}». Чтобы искать по всем вакансиям, напишите «по всем вакансиям».',
  },
  scopeAll: {
    en: 'all vacancies',
    az: 'bütün vakansiyalar',
    ru: 'все вакансии',
  },
  filtered: {
    en: 'Showing {n} of {analyzed} analyzed for {title}.',
    az: '{title} üçün təhlil olunmuş {analyzed} namizədin {n}-i göstərilir.',
    ru: 'Показано {n} из {analyzed} проанализированных для «{title}».',
  },
  filterNote: {
    en: 'Only: {filters}.',
    az: 'Yalnız: {filters}.',
    ru: 'Только: {filters}.',
  },
  followReplace: {
    en: 'Searching {skills} in the same scope as before.',
    az: 'Əvvəlki axtarışın əhatəsində {skills} axtarıram.',
    ru: 'Ищу {skills} в той же области, что и раньше.',
  },
  alsoChip: {
    en: 'Also {skill}',
    az: 'Həm də {skill}',
    ru: 'Ещё и {skill}',
  },
  clarify: {
    en: 'I am not sure what you want to see. Is it one of these?',
    az: 'Nə görmək istədiyinizi dəqiq başa düşmədim. Bunlardan biridir?',
    ru: 'Не уверен, что вы хотите увидеть. Это что-то из этого?',
  },
  help: {
    en: 'I can find the best matches for a vacancy, search the resumes for a skill, count candidates, or list the Shortlist. Try: Who knows Excel?',
    az: 'Vakansiya üçün ən yaxşı uyğunları tapa, CV-lərdə bacarıq axtara, namizədləri say və qısa siyahını göstərə bilərəm. Məsələn: Excel bilən namizədləri çıxart.',
    ru: 'Я могу найти лучшие совпадения для вакансии, найти в резюме навык, посчитать кандидатов или показать короткий список. Например: Найди кандидатов, знающих Excel.',
  },
} satisfies Record<string, Dict>;

export type Say = keyof typeof D;
export const say = (lang: Lang, key: Say, vars: Record<string, string | number> = {}): string =>
  D[key][lang].replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));

/** What SenAI can be asked, shown under the Ask bar. Fixed wording, so it is logged as asked. */
export const SUGGESTIONS: Record<Lang, string[]> = {
  en: [
    'Find the right candidate for {vacancy}',
    'How many candidates for {vacancy}?',
    'Show the Shortlist for {vacancy}',
    'Who knows Excel?',
  ],
  az: [
    '{vacancy} üçün uyğun namizədi tap',
    '{vacancy} üçün neçə namizəd var?',
    '{vacancy} üçün qısa siyahını göstər',
    'Excel bilən namizədləri çıxart',
  ],
  ru: [
    'Найди подходящего кандидата для {vacancy}',
    'Сколько кандидатов для {vacancy}?',
    'Покажи короткий список для {vacancy}',
    'Найди кандидатов, знающих Excel',
  ],
};

/** Names of the bands and marks in the language of the answer (for notes; the screen has its own). */
export const BAND_WORD: Record<Lang, Record<string, string>> = {
  en: { strong: 'Strong', good: 'Good', partial: 'Partial', limited: 'Limited' },
  az: { strong: 'Güclü', good: 'Yaxşı', partial: 'Qismən', limited: 'Məhdud' },
  ru: { strong: 'Сильное', good: 'Хорошее', partial: 'Частичное', limited: 'Слабое' },
};
export const MARK_WORD: Record<Lang, Record<string, string>> = {
  en: { shortlist: 'Shortlist', maybe: 'Maybe', not_now: 'Not now', new: 'No decision yet' },
  az: { shortlist: 'Qısa siyahı', maybe: 'Bəlkə', not_now: 'İndi yox', new: 'Hələ qərar yoxdur' },
  ru: {
    shortlist: 'Короткий список',
    maybe: 'Возможно',
    not_now: 'Не сейчас',
    new: 'Решения ещё нет',
  },
};
