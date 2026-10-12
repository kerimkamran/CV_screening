/**
 * Reading a question (SenAI plan section 4): rules first. A question, the screen the person is on
 * and the previous question become one typed query. A short message such as "ingilis dili" after an
 * Excel search is a follow-up: same scope, another skill. When the rules cannot tell what is meant,
 * confidence is low and the model gets a try (understand-model.ts); the result is checked the same way.
 */
import { fold, skillsInTokens, stem, tokens, type Skill } from '@cv/shared';
import {
  BANDS,
  MARKS,
  blankQuery,
  type Band,
  type FollowUp,
  type Query,
  type Ref,
  type SkillTerm,
} from './query';
import type { Mark } from '@cv/shared';

// ----------------------------------------------------------------------------- lexicons

/** A word list written in any language; a trailing * means "starts with"; a space means a phrase. */
interface Lex {
  words: Set<string>;
  stems: string[];
  phrases: string[][];
}
function lex(...raw: string[]): Lex {
  const l: Lex = { words: new Set(), stems: [], phrases: [] };
  for (const r of raw) {
    const star = r.endsWith('*');
    const f = fold(star ? r.slice(0, -1) : r);
    if (!f) continue;
    if (f.includes(' ')) {
      const w = f.split(' ');
      if (star) w[w.length - 1] += '*';
      l.phrases.push(w);
    } else if (star) l.stems.push(f);
    else l.words.add(f);
  }
  return l;
}

/** Token indexes that a lexicon matches (a phrase counts all of its tokens). */
function hits(toks: string[], l: Lex): number[] {
  const at: number[] = [];
  toks.forEach((t, i) => {
    if (
      l.words.has(t) ||
      (t.length >= 6 && l.words.has(stem(t))) ||
      l.stems.some((s) => t.startsWith(s))
    )
      at.push(i);
  });
  for (const p of l.phrases)
    for (let i = 0; i + p.length <= toks.length; i++)
      if (
        p.every((w, k) =>
          w.endsWith('*') ? toks[i + k]!.startsWith(w.slice(0, -1)) : toks[i + k] === w,
        )
      )
        p.forEach((_, k) => at.push(i + k));
  return [...new Set(at)].sort((a, b) => a - b);
}

const COUNT = lex(
  'how many',
  'number of',
  'count',
  'neçə',
  'sayı',
  'сколько',
  'количество',
  'how much',
);
const SHORT = lex(
  'shortlist',
  'short list',
  'qısa siyahı',
  'короткий список',
  'шортлист',
  'избранн*',
);
const FIND = lex(
  'find',
  'best',
  'top',
  'right',
  'fit',
  'fits',
  'fitting',
  'suit*',
  'match*',
  'show',
  'list',
  'give',
  'get',
  'extract',
  'pull',
  'tap',
  'tapın',
  'göstər',
  'goster*',
  'çıxar',
  'cixar*',
  'çıxart',
  'ver',
  'verin',
  'uyğun',
  'ən yaxşı',
  'лучш*',
  'подходящ*',
  'найди',
  'найти',
  'покажи',
  'выведи',
  'дай',
  'who',
  'кто',
  'kim',
  'kimlər',
  'hansı',
  'which',
  'search',
  'axtar',
  'axtarın',
  'ищи',
);
const COMPARE = lex(
  'compare',
  'vs',
  'versus',
  'comparison',
  'müqayisə*',
  'сравни*',
  'сравнен*',
  'fərq',
  'difference between',
);
const DOCTOR = lex(
  'why so few',
  'why only',
  'why are there so few',
  'why is nobody',
  'niyə az',
  'niyə heç kim',
  'почему мало',
  'почему нет',
  'missing most',
  'most missing',
  'çatışmayan',
  'hansı tələb',
  'which requirement',
  'which must',
  'bottleneck',
  'rarest',
  'how rare',
  'nadir',
  'редк*',
  'что чаще всего не',
);
const CHANGES = lex(
  'what changed',
  'what is new',
  'whats new',
  'new since',
  'nə dəyişdi',
  'dəyişiklik*',
  'nə yeni',
  'что изменилось',
  'что нового',
  'изменени*',
  'since',
  'bəri',
  'dən bəri',
  'with changes',
);
const WHATIF = lex('what if', 'əgər', 'если', 'what happens if', 'nə olar', 'if');
const NICE = lex(
  'nice to have',
  'nice',
  'bonus',
  'arzuolunan',
  'arzu olunan',
  'желательн*',
  'плюс',
);
const MUST = lex('must have', 'must', 'mandatory', 'required', 'vacib', 'mütləq', 'обязательн*');
const OPEN = lex('open', 'aç', 'açın', 'открой', 'открыть', 'go to', 'keç');
const INTERVIEW = lex('interview', 'müsahibə*', 'интервью', 'собеседовани*');
const RECALL = lex(
  'what did we conclude',
  'we concluded',
  'conclude*',
  'earlier chat',
  'previous chat',
  'last time',
  'əvvəlki söhbət',
  'keçən dəfə',
  'nə qərara gəldik',
  'что мы решили',
  'в прошлый раз',
  'прошлый раз',
);
const ABOUT = lex(
  'what can you see',
  'what do you see',
  'how did you get',
  'how i got this',
  'why did you say',
  'what can you do',
  'who are you',
  'nə görürsən',
  'nə edə bilərsən',
  'sən kimsən',
  'necə tapdın',
  'что ты видишь',
  'что ты умеешь',
  'кто ты',
  'как ты нашел',
);
const HELP = lex(
  'what does',
  'what is',
  'what means',
  'means',
  'mean',
  'nə deməkdir',
  'nedir',
  'how do i',
  'how to',
  'necə edim',
  'что значит',
  'что такое',
  'help',
  'kömək',
  'как мне',
  'как сделать',
);
const WIDE = lex(
  'all vacancies',
  'every vacancy',
  'across vacancies',
  'bütün vakansiyalar*',
  'bütün vakansiyada',
  'hamısında',
  'hər vakansiyada',
  'во всех вакансиях',
  'по всем вакансиям',
  'все вакансии',
  'всех вакансиях',
  'everywhere',
  'hər yerdə',
);
const ALL = lex(
  'all',
  'every',
  'hamısı',
  'hamısını',
  'bütün',
  'все',
  'всех',
  'whole',
  'everyone',
  'hər kəs',
);
const MORE = lex('more', 'daha çox', 'ещё', 'еще', 'əlavə', 'next', 'növbəti');
const ADD = lex(
  'also',
  'too',
  'həm də',
  'və də',
  'plus',
  'as well',
  'and also',
  'əlavə olaraq',
  'еще и',
  'а также',
  'тоже',
  'также',
);
const NARROW = lex(
  'only',
  'just',
  'among them',
  'of them',
  'yalnız',
  'onlardan',
  'bunlardan',
  'из них',
  'только',
  'amongst them',
  'those who',
  'olanlar arasında',
);
const OR = lex('or', 'və ya', 'veya', 'ya da', 'yaxud', 'или', 'либо');
const TRIGGER = lex(
  'know',
  'knows',
  'knowing',
  'knowledge',
  'skill*',
  'experience*',
  'proficient',
  'familiar',
  'using',
  'with',
  'bilən',
  'bilir',
  'bilənlər',
  'bilənləri',
  'bilənlərin',
  'malik',
  'sahib*',
  'təcrübə*',
  'bacarıq*',
  'ilə',
  'знает',
  'знают',
  'знающ*',
  'владеет',
  'владеют',
  'владеющ*',
  'опыт*',
  'навык*',
  'умеет',
  'умеют',
  'mentioned',
  'mention*',
  'qeyd',
  'işləyən*',
  'işləyib',
);
const BAND_WORDS: [Band, Lex][] = [
  ['strong', lex('strong', 'güclü', 'сильн*', 'сильное')],
  ['good', lex('good band', 'yaxşı band', 'хорош*')],
  ['partial', lex('partial', 'partly', 'qismən', 'частичн*')],
  ['limited', lex('limited', 'məhdud', 'слаб*', 'ограничен*')],
];
const MARK_WORDS: [Mark, Lex][] = [
  ['shortlist', SHORT],
  ['maybe', lex('maybe', 'bəlkə', 'возможно')],
  ['not_now', lex('not now', 'indi yox', 'не сейчас')],
  [
    'new',
    lex(
      'no decision',
      'undecided',
      'without a decision',
      'qərarı olmayan*',
      'qərarsız',
      'без решения',
    ),
  ],
];
const CANDIDATES = lex(
  'candidate*',
  'applicant*',
  'resume*',
  'cvs',
  'namizəd*',
  'kandidat*',
  'кандидат*',
  'резюме',
);
const NOUNS = lex(
  'candidate*',
  'person',
  'people',
  'applicant*',
  'resume*',
  'cv',
  'cvs',
  'namizəd*',
  'şəxs',
  'kandidat*',
  'кандидат*',
  'резюме',
  'человек',
  'люди',
  'vakansiya*',
  'vacancy',
  'vacancies',
  'ваканси*',
  'role',
  'job',
);
// Polite and spoken words that carry no request.
const SPOKEN = lex(
  'please',
  'can',
  'you',
  'could',
  'would',
  'me',
  'my',
  'the',
  'a',
  'an',
  'of',
  'for',
  'in',
  'on',
  'at',
  'from',
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
  'both',
  'that',
  'have',
  'has',
  'having',
  'had',
  'what',
  'which',
  'need',
  'want',
  'looking',
  'someone',
  'anyone',
  'much',
  'any',
  'and',
  'with',
  'name',
  'names',
  'mənə',
  'mene',
  'bizə',
  'sən',
  'siz',
  'xahiş',
  'zəhmət',
  'olmasa',
  'üçün',
  'üzrə',
  'haqqında',
  'bu',
  'o',
  'bir',
  'var',
  'yox',
  'olan',
  'olanlar',
  'olanları',
  'lazım',
  'lazımdır',
  'edir',
  'edin',
  'et',
  'ede',
  'deyirəm',
  'deyirik',
  'yazıram',
  'istəyirəm',
  'barədə',
  'barede',
  'da',
  'də',
  'daha',
  'çox',
  'az',
  'hazırda',
  'indi',
  'yenə',
  'yene',
  'sonra',
  'həm',
  'və',
  'ancaq',
  'amma',
  'ki',
  'isə',
  'ise',
  'мне',
  'нам',
  'пожалуйста',
  'по',
  'в',
  'на',
  'из',
  'для',
  'и',
  'у',
  'которых',
  'которые',
  'есть',
  'все',
  'это',
  'эти',
  'ni',
  'nə',
  'necə',
  'hansılar',
);

/** Words that mean something to the reader: a leftover word that is none of these is a skill word. */
const KNOWN = [
  COUNT,
  SHORT,
  FIND,
  COMPARE,
  DOCTOR,
  CHANGES,
  WHATIF,
  NICE,
  MUST,
  OPEN,
  INTERVIEW,
  RECALL,
  ABOUT,
  HELP,
  WIDE,
  ALL,
  MORE,
  ADD,
  NARROW,
  OR,
  TRIGGER,
  NOUNS,
  SPOKEN,
  ...BAND_WORDS.map((b) => b[1]),
  ...MARK_WORDS.map((m) => m[1]),
];

const ORDINALS: [number, Lex][] = [
  [1, lex('first', 'birinci*', 'первый', 'первого', 'первому', 'перв*')],
  [2, lex('second', 'ikinci*', 'второй', 'втор*')],
  [3, lex('third', 'üçüncü*', 'третий', 'трет*')],
  [4, lex('fourth', 'dördüncü*', 'четвертый', 'четверт*')],
  [5, lex('fifth', 'beşinci*', 'пятый', 'пят*')],
];
const LAST = lex('last', 'sonuncu*', 'последний', 'последн*', 'latest one');
const DEMONSTRATIVE = lex('those', 'these', 'bunlar', 'onlar', 'bu üçü', 'эти', 'те', 'them');
const NUMWORD: Record<string, number> = {
  two: 2,
  three: 3,
  iki: 2,
  uc: 3,
  два: 2,
  три: 3,
  двух: 2,
  трех: 3,
};

const GLOSSARY: [string, Lex][] = [
  ['out_of_date', lex('out of date', 'köhnəlib', 'устарел*')],
  ['needs_look', lex('needs a look', 'needs review', 'needs review', 'human look', 'baxış tələb')],
  ['must_have', lex('must have', 'must-have', 'mandatory', 'vacib tələb*')],
  ['nice_to_have', lex('nice to have', 'arzuolunan*', 'желательн*')],
  [
    'bands',
    lex('band', 'bands', 'strong', 'güclü', 'сильн*', 'partial', 'limited', 'qismən', 'məhdud'),
  ],
  ['shortlist', SHORT],
  ['star_map', lex('star map', 'ulduz xəritəsi', 'звёздная карта')],
  ['reanalyze', lex('re analyze', 'reanalyze', 'yenidən təhlil', 'повторн*')],
  ['score', lex('score', 'ball', 'балл', 'percent', 'faiz')],
];

// ----------------------------------------------------------------------------- time

const WEEKDAYS: Lex[] = [
  lex('sunday', 'bazar', 'воскресенье'),
  lex('monday', 'bazar ertəsi*', 'понедельник'),
  lex('tuesday', 'çərşənbə axşamı*', 'вторник'),
  lex('wednesday', 'çərşənbə*', 'среда', 'среду'),
  lex('thursday', 'cümə axşamı*', 'четверг'),
  lex('friday', 'cümə*', 'пятница', 'пятницу'),
  lex('saturday', 'şənbə*', 'суббота', 'субботу'),
];
const TODAY = lex('today', 'bu gün', 'bugün', 'сегодня');
const YESTERDAY = lex('yesterday', 'dünən', 'вчера');
const THIS_WEEK = lex('this week', 'bu həftə', 'на этой неделе', 'эту неделю');
const LAST_WEEK = lex('last week', 'keçən həftə', 'на прошлой неделе', 'прошлую неделю');
const THIS_MONTH = lex('this month', 'bu ay', 'в этом месяце');

const bakuDay = (d: Date): { y: number; m: number; d: number; dow: number } => {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Baku',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(d);
  const get = (t: string) => f.find((p) => p.type === t)!.value;
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { y: +get('year'), m: +get('month'), d: +get('day'), dow };
};
const iso = (y: number, m: number, d: number) =>
  new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const shift = (day: { y: number; m: number; d: number }, by: number) => {
  const t = new Date(Date.UTC(day.y, day.m - 1, day.d + by));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};

/** "Since Monday", "this week", "yesterday": a date in Asia/Baku, or null. */
export function sinceOf(toks: string[], now: Date): string | null {
  const today = bakuDay(now);
  if (hits(toks, TODAY).length) return iso(today.y, today.m, today.d);
  if (hits(toks, YESTERDAY).length) {
    const t = shift(today, -1);
    return iso(t.y, t.m, t.d);
  }
  if (hits(toks, LAST_WEEK).length) {
    const t = shift(today, -((today.dow + 6) % 7) - 7);
    return iso(t.y, t.m, t.d);
  }
  if (hits(toks, THIS_WEEK).length) {
    const t = shift(today, -((today.dow + 6) % 7));
    return iso(t.y, t.m, t.d);
  }
  if (hits(toks, THIS_MONTH).length) return iso(today.y, today.m, 1);
  // Longer weekday phrases first so that "bazar ertəsi" is not read as "bazar".
  const order = [1, 2, 4, 3, 5, 6, 0];
  for (const wd of order) {
    if (hits(toks, WEEKDAYS[wd]!).length) {
      const back = (today.dow - wd + 7) % 7;
      const t = shift(today, -back);
      return iso(t.y, t.m, t.d);
    }
  }
  return null;
}

// ----------------------------------------------------------------------------- the reader

export interface Context {
  /** The previous query in this conversation, if any. */
  last: Query | null;
  /** How many candidates the previous answer listed. */
  shown: number;
  /** Folded words of every vacancy title the person may see. */
  titleWords: ReadonlySet<string>;
  /** The question names a vacancy (decided by the vacancy resolver). */
  namesVacancy: boolean;
  now: Date;
}

const isNumber = (t: string) => /^\d+$/.test(t);

function skillTerm(s: Skill, words: string[]): SkillTerm {
  return { id: s.id, label: s.label, phrase: null, words };
}

export function understand(text: string, ctx: Context): Query {
  const toks = tokens(text);
  const q = blankQuery();
  const used = new Set<number>();
  const mark = (ix: number[]) => ix.forEach((i) => used.add(i));

  const has = (l: Lex) => {
    const h = hits(toks, l);
    mark(h);
    return h;
  };

  // The words that decide what is asked.
  const hRecall = has(RECALL);
  const hAbout = has(ABOUT);
  const hHelp = has(HELP);
  const hWhatIf = has(WHATIF);
  const hNice = has(NICE);
  const hMust = has(MUST);
  const hDoctor = has(DOCTOR);
  const hChanges = has(CHANGES);
  const hInterview = has(INTERVIEW);
  const hCompare = has(COMPARE);
  const hOpen = has(OPEN);
  const hShort = has(SHORT);
  const hCount = has(COUNT);
  const hFind = has(FIND);
  const hWide = has(WIDE);
  const hAll = hits(toks, ALL).filter((i) => !hWide.includes(i));
  const hTrigger = hits(toks, TRIGGER);
  const trigger = hTrigger.length > 0;
  const known = new Set<number>();
  for (const l of KNOWN) for (const i of hits(toks, l)) known.add(i);

  q.trigger = trigger;
  q.everywhere = hWide.length > 0;
  q.showAll = hAll.length > 0 || hits(toks, MORE).length > 0;
  q.since = sinceOf(toks, ctx.now);

  // Number of candidates asked for: "top 3", "ilk 5", "5 best".
  const f = fold(text);
  const top = /(?:top|ilk|first|lucs\w*)\s*(\d{1,2})\b|\b(\d{1,2})\s*(?:best|top|en yaxsi)\b/.exec(
    f,
  );
  const n = top ? parseInt(top[1] ?? top[2]!, 10) : NaN;
  if (Number.isFinite(n)) q.top = Math.min(Math.max(n, 1), 50);

  // Bands and marks.
  for (const [b, l] of BAND_WORDS) if (hits(toks, l).length) q.bands.push(b);
  for (const [m, l] of MARK_WORDS) if (hits(toks, l).length) q.decisions.push(m);
  q.bands = BANDS.filter((b) => q.bands.includes(b));
  q.decisions = MARKS.filter((m) => q.decisions.includes(m));

  // Skills: the dictionary, then words the dictionary does not know (only after "who knows ...").
  let skillHits = skillsInTokens(toks);
  skillHits = skillHits.filter(
    (h) => h.skill.kind !== 'domain' || trigger || !h.at.every((i) => ctx.titleWords.has(toks[i]!)),
  );
  for (const h of skillHits) {
    mark(h.at);
    if (!q.skills.some((s) => s.id === h.skill.id))
      q.skills.push(
        skillTerm(
          h.skill,
          h.at.map((i) => toks[i]!),
        ),
      );
  }
  if (trigger) {
    let buf: string[] = [];
    const flush = () => {
      if (buf.length) {
        const phrase = buf.join(' ');
        q.skills.push({
          id: null,
          label: phrase[0]!.toUpperCase() + phrase.slice(1),
          phrase,
          words: [...buf],
        });
        buf = [];
      }
    };
    toks.forEach((t, i) => {
      const skip =
        used.has(i) || known.has(i) || isNumber(t) || t.length < 2 || ctx.titleWords.has(t);
      if (skip) flush();
      else buf.push(t);
    });
    flush();
  }
  if (q.skills.length > 5) q.skills = q.skills.slice(0, 5);
  q.mode = hits(toks, OR).length ? 'any' : 'all';

  // Candidates mentioned: "Candidate 07", "the second one", "those three".
  const refs: Ref[] = [];
  toks.forEach((t, i) => {
    if (
      /^\d{2,3}$/.test(t) &&
      (t.startsWith('0') ||
        NOUNS.words.has(toks[i - 1] ?? '') ||
        hits([toks[i - 1] ?? ''], NOUNS).length)
    ) {
      if (!(q.top === Number(t) && /(top|ilk|first)/.test(toks[i - 1] ?? '')))
        refs.push({ kind: 'label', n: Number(t) });
    }
  });
  for (const [k, l] of ORDINALS) if (hits(toks, l).length) refs.push({ kind: 'ordinal', n: k });
  if (hits(toks, LAST).length) refs.push({ kind: 'last' });
  if (!refs.length && hits(toks, DEMONSTRATIVE).length && ctx.shown > 0)
    refs.push({ kind: 'shown' });
  if (
    !refs.length &&
    toks.some((t) => NUMWORD[t]) &&
    hits(toks, DEMONSTRATIVE).length &&
    ctx.shown > 0
  )
    refs.push({ kind: 'shown' });
  // "first 5" is a number of candidates, not "the first one".
  const firstN = q.top !== null && toks.some((t) => t === 'first' || t === 'ilk');
  q.refs = (firstN ? refs.filter((r) => !(r.kind === 'ordinal' && r.n === 1)) : refs).slice(0, 3);

  // What is asked, in order of how specific it is.
  const content = toks.filter((_, i) => !used.has(i) && !known.has(i));
  let intent = q.intent;
  const glossary = GLOSSARY.find(([, l]) => hits(toks, l).length > 0);
  if (hRecall.length) intent = 'recall';
  else if (hAbout.length) intent = 'about';
  else if (hHelp.length && glossary && !q.skills.length && !q.refs.length) {
    intent = 'help';
    q.topic = glossary[0];
  } else if (hWhatIf.length && (hNice.length || hMust.length)) {
    intent = 'what_if';
    const subject = toks
      .filter((t, i) => !known.has(i) && !isNumber(t))
      .join(' ')
      .trim();
    q.whatIf = { text: subject, to: hNice.length ? 'nice' : 'must' };
  } else if (hDoctor.length) intent = 'doctor';
  else if (hChanges.length && q.since) intent = 'changes';
  else if (hChanges.length && !q.skills.length && !hFind.length) intent = 'changes';
  else if (hInterview.length) intent = 'interview';
  else if (hCompare.length || (q.refs.length >= 2 && !hOpen.length)) intent = 'compare';
  else if (hOpen.length && (q.refs.length || ctx.namesVacancy || !q.skills.length)) intent = 'open';
  else if (q.skills.length) intent = 'skills';
  else if (hShort.length) intent = 'shortlist';
  else if (hCount.length) intent = 'count';
  else if (hFind.length || ctx.namesVacancy || hits(toks, CANDIDATES).length) intent = 'find';
  q.countOnly =
    hCount.length > 0 && (intent === 'skills' || intent === 'shortlist' || intent === 'count');
  if (intent === 'skills' && hShort.length && !q.decisions.includes('shortlist'))
    q.decisions.push('shortlist');
  q.intent = intent;
  q.confidence = intent === 'unknown' ? 'low' : 'high';
  if (intent === 'find' && !hFind.length && !ctx.namesVacancy) q.confidence = 'low';

  // A short message after another question is a follow-up to it.
  const last = ctx.last;
  const elliptical =
    !!last &&
    !ctx.namesVacancy &&
    !hRecall.length &&
    !hAbout.length &&
    !hHelp.length &&
    content.length <= 3 &&
    toks.length <= 8;
  if (elliptical && last) {
    const modifier: FollowUp = hits(toks, ADD).length
      ? 'add'
      : hits(toks, NARROW).length
        ? 'narrow'
        : 'replace';
    if (
      q.skills.length &&
      (intent === 'skills' || intent === 'find' || intent === 'unknown' || intent === 'count')
    ) {
      q.intent = 'skills';
      q.followUp = last.intent === 'skills' ? modifier : 'replace';
      const prev = last.skills;
      if (q.followUp === 'add' || q.followUp === 'narrow') {
        const merged = [...prev];
        for (const s of q.skills)
          if (!merged.some((m) => (m.id ?? m.phrase) === (s.id ?? s.phrase))) merged.push(s);
        q.skills = merged.slice(0, 5);
        q.mode = q.followUp === 'add' && hits(toks, OR).length ? 'any' : 'all';
      }
      if (!q.bands.length) q.bands = [...last.bands];
      if (!q.decisions.length) q.decisions = [...last.decisions];
      q.everywhere = q.everywhere || last.everywhere;
      q.confidence = 'high';
    } else if (
      !q.skills.length &&
      (intent === 'unknown' || intent === 'find' || intent === 'shortlist' || intent === 'count') &&
      (q.bands.length || q.decisions.length || q.top || q.showAll || hits(toks, MORE).length)
    ) {
      // "only Strong", "top 3", "show all": the same question, narrowed or widened.
      q.intent = last.intent === 'unknown' ? 'find' : last.intent;
      q.followUp = 'refine';
      q.skills = last.skills;
      q.mode = last.mode;
      q.countOnly = false;
      q.everywhere = q.everywhere || last.everywhere;
      if (!q.bands.length) q.bands = [...last.bands];
      if (!q.decisions.length) q.decisions = [...last.decisions];
      if (!q.top && !q.showAll) q.top = last.top;
      q.confidence = 'high';
    } else if (q.refs.length && (intent === 'unknown' || intent === 'find')) {
      q.intent = 'open';
      q.confidence = 'high';
    } else if (intent === 'unknown' && ctx.shown > 0) {
      q.confidence = 'low';
    }
  }
  return q;
}
