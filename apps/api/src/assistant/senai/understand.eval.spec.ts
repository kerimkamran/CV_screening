/**
 * The understanding evaluation set (SenAI plan 12.1, 12.2): messy questions in Azerbaijani (with and
 * without special letters), English and Russian, each with the typed query a person would expect.
 * The rules must read at least the share below correctly. A release does not go out below it; a
 * failure prints the question so the lexicon can be fixed, not the expectation weakened.
 */
import { blankQuery, type Intent, type Query } from './query';
import { understand, type Context } from './understand';

const GATE_ALL = 0.95;
const GATE_EACH = 0.9;

const ctx = (over: Partial<Context> = {}): Context => ({
  last: null,
  shown: 0,
  titleWords: new Set(['network', 'engineer', 'sales', 'manager', 'developer', 'sebeke']),
  namesVacancy: false,
  now: new Date('2026-10-12T10:00:00Z'),
  ...over,
});

interface Case {
  q: string;
  intent: Intent;
  skills?: string[];
  mode?: 'all' | 'any';
  bands?: string[];
  followUp?: Query['followUp'];
  c?: Partial<Context>;
}

const cases: Case[] = [];

// ---------------------------------------------------------------- skills, three languages
const SKILL_FORMS: [string, string[]][] = [
  ['excel', ['Excel', 'Эксель', 'exsel', 'EXCEL']],
  ['python', ['Python', 'питон', 'pyhton']],
  ['sql', ['SQL', 'sql']],
  ['kubernetes', ['Kubernetes', 'кубернетес']],
  ['bgp', ['BGP', 'bgp']],
  ['docker', ['Docker', 'докер']],
  ['linux', ['Linux', 'линукс']],
  ['powerbi', ['Power BI', 'PowerBI']],
  ['sap', ['SAP', 'sap']],
  ['jira', ['Jira', 'jira']],
];
const SKILL_TEMPLATES = [
  (s: string) => `who knows ${s}?`,
  (s: string) => `candidates with ${s}`,
  (s: string) => `anyone with ${s} experience?`,
  (s: string) => `show me people who have worked with ${s}`,
  (s: string) => `${s} bilən namizədləri çıxart`,
  (s: string) => `${s} bilen namizedleri cixart`,
  (s: string) => `mənə ${s} bilənləri göstər`,
  (s: string) => `${s} biləni var?`,
  (s: string) => `найди кандидатов, знающих ${s}`,
  (s: string) => `кто знает ${s}?`,
];
for (const [id, forms] of SKILL_FORMS)
  for (const f of forms)
    for (const t of SKILL_TEMPLATES) cases.push({ q: t(f), intent: 'skills', skills: [id] });

for (const [q, skills] of [
  ['ingilis dili bilənlər', ['english']],
  ['ingilis dili bilen namizedler', ['english']],
  ['rus dili və ingilis dili bilən namizədlər', ['russian', 'english']],
  ['кто знает английский?', ['english']],
  ['who speaks English?', ['english']],
  ['azərbaycan və türk dili bilənlər', ['azerbaijani', 'turkish']],
] as [string, string[]][])
  cases.push({ q, intent: 'skills', skills });

cases.push(
  {
    q: 'SQL və ya Python bilən namizədlər',
    intent: 'skills',
    skills: ['sql', 'python'],
    mode: 'any',
  },
  { q: 'who knows SQL or Python', intent: 'skills', skills: ['sql', 'python'], mode: 'any' },
  { q: 'кто знает SQL или Python', intent: 'skills', skills: ['sql', 'python'], mode: 'any' },
  { q: 'who knows SQL and Python', intent: 'skills', skills: ['sql', 'python'], mode: 'all' },
);

// ---------------------------------------------------------------- vacancy questions
const V = { namesVacancy: true };
for (const [q, intent] of [
  ['How many candidates for Network Engineer?', 'count'],
  ['Network Engineer üçün neçə namizəd var?', 'count'],
  ['Network Engineer ucun nece namized var', 'count'],
  ['Сколько кандидатов на Network Engineer?', 'count'],
  ['Show the Shortlist for Network Engineer', 'shortlist'],
  ['Network Engineer üçün qısa siyahını göstər', 'shortlist'],
  ['Network Engineer qisa siyahi', 'shortlist'],
  ['Покажи короткий список для Network Engineer', 'shortlist'],
  ['Find the right candidate for Network Engineer', 'find'],
  ['Network Engineer üçün uyğun namizədi tap', 'find'],
  ['Network Engineer ucun uygun namizedi tap', 'find'],
  ['Найди подходящего кандидата для Network Engineer', 'find'],
  ['top 3 for Network Engineer', 'find'],
  ['best candidates Network Engineer', 'find'],
] as [string, Intent][])
  cases.push({ q, intent, c: V });

// ---------------------------------------------------------------- tools
for (const [q, intent] of [
  ['why so few Strong?', 'doctor'],
  ['niyə az güclü namizəd var?', 'doctor'],
  ['почему мало сильных?', 'doctor'],
  ['which requirement is the rarest', 'doctor'],
  ['what changed since Monday', 'changes'],
  ['dünən nə dəyişdi', 'changes'],
  ['что изменилось со вчера', 'changes'],
  ['what if Kubernetes were nice to have', 'what_if'],
  ['əgər Kubernetes arzuolunan olsaydı', 'what_if'],
  ['а если Kubernetes был бы желательным', 'what_if'],
  ['compare the first and the second', 'compare'],
  ['birinci ilə ikincini müqayisə et', 'compare'],
  ['сравни первого и второго', 'compare'],
  ['open the second', 'open'],
  ['ikincisini aç', 'open'],
  ['открой второго', 'open'],
  ['07 aç', 'open'],
  ['new vacancy', 'open'],
  ['yeni vakansiya', 'open'],
  ['interview questions for the first', 'interview'],
  ['birinci üçün müsahibə sualları', 'interview'],
  ['вопросы для собеседования для первого', 'interview'],
  ['what did we conclude last time', 'recall'],
  ['keçən dəfə nə qərara gəldik', 'recall'],
  ['что мы решили в прошлый раз', 'recall'],
  ['what can you see?', 'about'],
  ['nə görürsən?', 'about'],
  ['что ты видишь?', 'about'],
  ['what does out of date mean?', 'help'],
  ['out of date nə deməkdir?', 'help'],
  ['что значит устарело?', 'help'],
  ['always top 10', 'prefs'],
  ['həmişə 10 göstər', 'prefs'],
  ['всегда 10', 'prefs'],
  ['check the JD', 'jd'],
  ['check my decisions', 'consistency'],
  ['qərarlarımı yoxla', 'consistency'],
  ['проверь мои решения', 'consistency'],
  ['data quality', 'quality'],
  ['any duplicates?', 'quality'],
  ['are there duplicates', 'quality'],
  ['similar vacancies', 'similar'],
  ['oxşar vakansiyalar', 'similar'],
  ['похожие вакансии', 'similar'],
  ['rediscover candidates from other vacancies', 'rediscover'],
  ['из других вакансий кто подходит', 'rediscover'],
] as [string, Intent][])
  cases.push({ q, intent, c: { shown: 3 } });

// ---------------------------------------------------------------- follow-ups
const excelLast: Query = {
  ...blankQuery(),
  intent: 'skills',
  skills: [{ id: 'excel', label: 'Excel', phrase: null, words: ['excel'] }],
  confidence: 'high',
};
for (const [q, skills, followUp] of [
  ['ingilis dili', ['english'], 'replace'],
  ['english', ['english'], 'replace'],
  ['английский', ['english'], 'replace'],
  ['həm də ingilis dili', ['excel', 'english'], 'add'],
  ['and English', ['excel', 'english'], 'add'],
  ['и английский', ['excel', 'english'], 'add'],
] as [string, string[], Query['followUp']][])
  cases.push({ q, intent: 'skills', skills, followUp, c: { last: excelLast, shown: 4 } });
cases.push(
  {
    q: 'only Strong',
    intent: 'skills',
    skills: ['excel'],
    bands: ['strong'],
    c: { last: excelLast, shown: 4 },
  },
  {
    q: 'yalnız güclülər',
    intent: 'skills',
    skills: ['excel'],
    bands: ['strong'],
    c: { last: excelLast, shown: 4 },
  },
);

describe('Understanding evaluation set (plan 12.1 and 12.2)', () => {
  const failures: string[] = [];
  const byIntent = new Map<string, { ok: number; n: number }>();
  for (const c of cases) {
    const q = understand(c.q, ctx(c.c));
    const ids = q.skills.map((s) => s.id ?? s.phrase);
    const good =
      q.intent === c.intent &&
      (!c.skills || JSON.stringify([...ids].sort()) === JSON.stringify([...c.skills].sort())) &&
      (!c.mode || q.mode === c.mode) &&
      (!c.bands || JSON.stringify(q.bands) === JSON.stringify(c.bands)) &&
      (!c.followUp || q.followUp === c.followUp);
    const e = byIntent.get(c.intent) ?? { ok: 0, n: 0 };
    e.n += 1;
    if (good) e.ok += 1;
    else
      failures.push(`${c.q} -> ${q.intent} [${ids.join(',')}] ${q.followUp} (wanted ${c.intent})`);
    byIntent.set(c.intent, e);
  }

  it('does not invent skills from look-alike words or ordinary words', () => {
    for (const q of [
      'candidates with excellent results',
      'who is the best candidate overall',
      'show me the top 5',
      'ən yaxşı namizədlər',
      'покажи лучших',
      'how many are there',
      'sapphire jewellery sales',
      'javascripture',
    ]) {
      const r = understand(q, ctx());
      const ids = r.skills.map((x) => x.id);
      expect([
        q,
        ids.filter((i) => ['excel', 'sap', 'python', 'javascript', 'java'].includes(i ?? '')),
      ]).toEqual([q, []]);
    }
  });

  it('has a broad set', () => {
    expect(cases.length).toBeGreaterThanOrEqual(300);
  });

  it(`reads at least ${GATE_ALL * 100}% of the set correctly`, () => {
    const ok = cases.length - failures.length;
    if (failures.length)
      console.log(`Not read as expected (${failures.length}):\n${failures.join('\n')}`);
    expect(ok / cases.length).toBeGreaterThanOrEqual(GATE_ALL);
  });

  it(`reads at least ${GATE_EACH * 100}% of each kind of question correctly`, () => {
    for (const [intent, e] of byIntent)
      expect({ intent, ok: e.ok / e.n >= GATE_EACH }).toEqual({ intent, ok: true });
  });
});
