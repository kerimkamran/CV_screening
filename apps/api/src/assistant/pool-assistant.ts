/**
 * SenAI over the Candidate pool (Development Plan WP 4.3 and 4.4, design spec 6.6.9 to 6.6.11).
 *
 * The question is read by rules, not by a model: which vacancy is meant, and whether the person
 * wants the best matches, a count, or the Shortlist. The numbers and the order come from the pool
 * (the server's rows), and the sentences are written here, so nothing in an answer can be invented
 * and nothing about a person leaves the server. The model is not called for these answers.
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

// ----------------------------------------------------------------------------- the question

export type Ask = 'find' | 'count' | 'shortlist' | 'unknown';
export interface Parsed {
  ask: Ask;
  top: number;
  /** True when the question named a number ("top 3"). */
  topGiven: boolean;
  all: boolean;
}

const COUNT = /(how many|number of|count|necə|nece|сколько|количество)/;
const SHORT = /(shortlist|short list|qisa siyahi|шорт|избранн)/;
const FIND =
  /(find|best|top|right|fits?|fitting|suit\w*|match\w*|who|show|list|candidate|namized|uygun|en yaxsi|tap\b|tapin|goster|лучш|подход|кандидат|найд|покаж)/;
const ALL = /(\ball\b|every|hamisi|bütün|butun|все|всех)/;

export function parseQuestion(q: string): Parsed {
  const f = foldText(q);
  const n = /(?:top|ilk|en yaxsi|first|лучших|топ)\s*(\d{1,2})\b/.exec(f)?.[1];
  const top = n ? Math.min(Math.max(parseInt(n, 10), 1), 50) : 5;
  const all = ALL.test(f);
  const ask: Ask = COUNT.test(f)
    ? 'count'
    : SHORT.test(f)
      ? 'shortlist'
      : FIND.test(f)
        ? 'find'
        : 'unknown';
  return { ask, top, topGiven: !!n, all };
}

// ----------------------------------------------------------------------------- skills in the question

/**
 * "Candidates who know Excel": a skill or keyword in the question, searched in the resumes
 * themselves (not in the vacancy titles). Read by rules, in English, Azerbaijani and Russian.
 */
export interface SkillQuery {
  /** One group per skill; the words in a group mean the same thing (folded). */
  groups: string[][];
  /** How each skill is shown in the answer. */
  labels: string[];
  /** "Excel or SQL": any skill is enough. Otherwise every skill must be mentioned. */
  any: boolean;
}

const KNOWN_SKILLS: { label: string; words: string[] }[] = [
  { label: 'Excel', words: ['excel', 'eksel', 'эксель', 'ексель', 'vlookup', 'pivot'] },
  { label: 'Word', words: ['word', 'ворд'] },
  { label: 'PowerPoint', words: ['powerpoint', 'пауэрпоинт'] },
  { label: 'Power BI', words: ['powerbi'] },
  { label: 'SQL', words: ['sql', 'mysql', 'postgresql', 'postgres', 'mssql', 'plsql'] },
  { label: 'Python', words: ['python', 'питон', 'пайтон'] },
  { label: 'Java', words: ['java', 'джава'] },
  { label: 'JavaScript', words: ['javascript', 'js', 'typescript', 'джаваскрипт'] },
  { label: 'C#', words: ['csharp'] },
  { label: 'C++', words: ['cpp'] },
  { label: '.NET', words: ['dotnet'] },
  { label: 'Linux', words: ['linux', 'линукс'] },
  { label: 'Oracle', words: ['oracle', 'оракл'] },
  { label: 'SAP', words: ['sap'] },
  { label: 'Cisco', words: ['cisco', 'cisko', 'циско'] },
  { label: 'BGP', words: ['bgp'] },
  { label: 'OSPF', words: ['ospf'] },
  { label: 'Docker', words: ['docker'] },
  { label: 'Kubernetes', words: ['kubernetes', 'k8s'] },
  { label: 'Tableau', words: ['tableau'] },
  { label: 'AutoCAD', words: ['autocad'] },
  { label: 'Photoshop', words: ['photoshop'] },
  { label: 'Figma', words: ['figma'] },
  { label: 'English', words: ['english', 'ingilis', 'английск'] },
  { label: 'Russian', words: ['russian', 'rusca', 'русск'] },
  { label: 'Azerbaijani', words: ['azerbaijani', 'azerbaycanca', 'азербайджанск'] },
];

/** Joins words the way resumes write them, so "Power BI", "C#" and ".NET" stay one word. */
const prep = (s: string) =>
  s
    .replace(/c\+\+/gi, ' cpp ')
    .replace(/c#/gi, ' csharp ')
    .replace(/\.net\b/gi, ' dotnet ')
    .replace(/node\.?js/gi, ' nodejs ')
    .replace(/power\s*bi\b/gi, ' powerbi ')
    .replace(/power\s*point/gi, ' powerpoint ')
    .replace(/t-?sql|pl\/sql/gi, ' sql ');
export const skillFold = (s: string): string => foldText(prep(s));

const fset = (xs: string[]) => new Set(xs.map(skillFold));
/** Words that ask for something but name no skill. */
const FILLER = fset([
  // English
  'find',
  'show',
  'list',
  'give',
  'get',
  'extract',
  'pull',
  'pick',
  'search',
  'who',
  'whom',
  'which',
  'what',
  'candidate',
  'candidates',
  'people',
  'person',
  'applicant',
  'applicants',
  'resume',
  'resumes',
  'cv',
  'cvs',
  'with',
  'that',
  'have',
  'has',
  'having',
  'had',
  'the',
  'a',
  'an',
  'of',
  'for',
  'in',
  'on',
  'at',
  'from',
  'me',
  'my',
  'all',
  'any',
  'every',
  'best',
  'top',
  'good',
  'right',
  'how',
  'many',
  'much',
  'number',
  'count',
  'please',
  'can',
  'you',
  'could',
  'would',
  'do',
  'does',
  'is',
  'are',
  'was',
  'be',
  'it',
  'there',
  'their',
  'them',
  'us',
  'we',
  'i',
  'to',
  'by',
  'about',
  'among',
  'out',
  'only',
  'also',
  'both',
  'know',
  'knows',
  'knowing',
  'knowledge',
  'skill',
  'skills',
  'skilled',
  'experience',
  'experienced',
  'proficient',
  'familiar',
  'using',
  'use',
  'uses',
  'shortlist',
  'vacancy',
  'vacancies',
  'role',
  'job',
  'need',
  'want',
  'looking',
  'someone',
  'anyone',
  'who',
  'able',
  'ability',
  'work',
  'works',
  'working',
  // Azerbaijani (folded by skillFold)
  'mene',
  'men',
  'bize',
  'cixart',
  'cixar',
  'cixarin',
  'tap',
  'tapin',
  'taparsan',
  'goster',
  'gosterin',
  'ver',
  'verin',
  'sec',
  'secin',
  'bax',
  'axtar',
  'axtarin',
  'siyahi',
  'siyahisi',
  'namized',
  'namizedi',
  'namizedler',
  'namizedleri',
  'namizedlerin',
  'namizede',
  'cvler',
  'cvlerde',
  'cvsi',
  'bilen',
  'bilir',
  'bilenler',
  'bilenleri',
  'bilenlerin',
  'malik',
  'sahib',
  'sahibi',
  'sahibleri',
  'tecrube',
  'tecrubesi',
  'tecrubeli',
  'bacariq',
  'bacariqli',
  'bacariqlari',
  'ile',
  'ucun',
  'uzre',
  'uzere',
  'haqqinda',
  'nece',
  'say',
  'sayi',
  'var',
  'yox',
  'hansi',
  'hansilar',
  'kim',
  'kimler',
  'kimlerdir',
  'hamisi',
  'butun',
  'bu',
  'o',
  'en',
  'yaxsi',
  'uygun',
  'ideal',
  'lazim',
  'lazimdir',
  'olan',
  'olanlar',
  'olanlari',
  'qeyd',
  'edir',
  'edilib',
  'edenler',
  'istifade',
  'bilirlermi',
  'varmi',
  'vakansiya',
  'vakansiyalar',
  'vakansiyada',
  'vakansiyalarda',
  'qisa',
  'mutexessis',
  'xahis',
  'edirem',
  'ede',
  'bilersen',
  'sira',
  'siraya',
  'hazirda',
  'indi',
  'movcud',
  'yalniz',
  'daha',
  'cox',
  'az',
  'da',
  'de',
  // Russian
  'найди',
  'найти',
  'покажи',
  'выведи',
  'дай',
  'выбери',
  'кандидат',
  'кандидата',
  'кандидаты',
  'кандидатов',
  'кто',
  'знает',
  'знают',
  'знающие',
  'знающих',
  'владеет',
  'владеют',
  'владеющие',
  'владеющих',
  'опыт',
  'опытом',
  'навык',
  'навыки',
  'навыками',
  'умеет',
  'умеют',
  'работающих',
  'с',
  'со',
  'и',
  'или',
  'для',
  'все',
  'всех',
  'всё',
  'лучших',
  'лучшие',
  'сколько',
  'резюме',
  'у',
  'которых',
  'которые',
  'есть',
  'пожалуйста',
  'мне',
  'нам',
  'по',
  'в',
  'на',
  'из',
  'вакансия',
  'вакансии',
  'вакансиям',
  'вакансиях',
  'список',
  'короткий',
]);
/** Words that point at a skill ("who KNOWS Excel", "with experience in"). */
const SKILL_TRIGGER = fset([
  'bilen',
  'bilir',
  'bilenler',
  'bilenleri',
  'bilenlerin',
  'malik',
  'sahib',
  'sahibi',
  'tecrube',
  'tecrubesi',
  'tecrubeli',
  'bacariq',
  'bacariqli',
  'bacariqlari',
  'know',
  'knows',
  'knowing',
  'knowledge',
  'skill',
  'skills',
  'skilled',
  'experience',
  'experienced',
  'proficient',
  'familiar',
  'using',
  'with',
  'ile',
  'знает',
  'знают',
  'знающие',
  'знающих',
  'владеет',
  'владеют',
  'владеющие',
  'владеющих',
  'опыт',
  'опытом',
  'навык',
  'навыки',
  'навыками',
  'умеет',
  'умеют',
  'с',
  'со',
]);
const AND_WORDS = fset(['ve', 'and', 'и', 'hem', 'eyni zamanda']);
const OR_WORDS = fset(['veya', 'ya', 'yaxud', 'or', 'или', 'либо']);

/** A known skill by its word; longer words also match with a suffix ("excelde", "английским"). */
const skillGroupOf = (token: string) =>
  KNOWN_SKILLS.find((k) => k.words.some((w) => skillFold(w) === token)) ??
  KNOWN_SKILLS.find((k) =>
    k.words.some((w) => {
      const f = skillFold(w);
      return f.length >= 5 && token.startsWith(f);
    }),
  );

const titleCase = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/**
 * The skills the question asks about, or null when it asks for nothing of the kind (then it is a
 * question about a vacancy). Words that belong to the vacancy's own title are not skills.
 */
export function skillQuery(question: string, vacancyTitle?: string | null): SkillQuery | null {
  const tokens = skillFold(question).split(' ').filter(Boolean);
  const titleWords = vacancyTitle ? words(vacancyTitle) : [];
  const groups: string[][] = [];
  const labels: string[] = [];
  let any = false;
  let trigger = false;
  let known = false;
  let buffer: string[] = [];
  const flush = () => {
    if (!buffer.length) return;
    const phrase = buffer.join(' ');
    groups.push([phrase]);
    labels.push(titleCase(phrase));
    buffer = [];
  };
  for (const tok of tokens) {
    if (SKILL_TRIGGER.has(tok)) trigger = true;
    if (OR_WORDS.has(tok)) {
      any = true;
      flush();
      continue;
    }
    const kg = skillGroupOf(tok);
    if (kg) {
      flush();
      known = true;
      if (!groups.some((g) => g[0] === skillFold(kg.words[0]!))) {
        groups.push(kg.words.map(skillFold));
        labels.push(kg.label);
      }
      continue;
    }
    if (FILLER.has(tok) || AND_WORDS.has(tok) || /^\d+$/.test(tok) || tok.length < 2) {
      flush();
      continue;
    }
    if (titleWords.some((w) => same(tok, w)) || GROUP.has(tok)) {
      flush();
      continue;
    }
    buffer.push(tok);
  }
  flush();
  if (!groups.length || !(trigger || known)) return null;
  return { groups: groups.slice(0, 5), labels: labels.slice(0, 5), any };
}

/** How many times a skill (any of its words) appears in a resume text that was already folded. */
export function mentions(foldedText: string, group: string[]): number {
  let n = 0;
  for (const w of group) {
    const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Short words must stand alone ("sap", "java" are not "sapphire", "javascript"); longer words
    // may carry an Azerbaijani suffix ("excelde", "excel-i").
    const re = new RegExp(w.length >= 5 ? `(^| )${esc}` : `(^| )${esc}( |$)`, 'g');
    n += (foldedText.match(re) ?? []).length;
  }
  return n;
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
