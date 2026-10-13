/**
 * Messy messages: how people really type (SenAI plan 4.2). Typos, missing letters, broken grammar,
 * text-message style, words of two languages in one sentence. With the model off, the rules alone
 * must still read most of them; with the model on, it reads the rest (checked in the integration
 * tests). A failure prints the message so the lexicon can be fixed, not the expectation weakened.
 */
import type { Intent, Query } from './query';
import { understand, type Context } from './understand';

const GATE = 0.95;

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
  followUp?: Query['followUp'];
  c?: Partial<Context>;
}

const listed: Partial<Context> = { shown: 5 };

const cases: Case[] = [
  // English with mistakes and chat style
  { q: 'can u show me peple who knw excell pls', intent: 'skills', skills: ['excel'] },
  { q: 'who have experiance with python', intent: 'skills', skills: ['python'] },
  { q: 'any one who work with kubernets before?', intent: 'skills', skills: ['kubernetes'] },
  {
    q: 'i need peoples that knows sql and also pyton',
    intent: 'skills',
    skills: ['sql', 'python'],
  },
  { q: 'show candidates which speak english good', intent: 'skills', skills: ['english'] },
  { q: 'do we have somebody with docker skill', intent: 'skills', skills: ['docker'] },
  { q: 'hey, who is knowing linux here', intent: 'skills', skills: ['linux'] },
  { q: 'find me guys with bgp', intent: 'skills', skills: ['bgp'] },
  { q: 'sql or excell, whoever', intent: 'skills', skills: ['sql', 'excel'], mode: 'any' },
  { q: 'wich candidates has jira exp', intent: 'skills', skills: ['jira'] },
  { q: 'how many people we have for this job', intent: 'count' },
  { q: 'how much candidate applyed', intent: 'count' },
  { q: 'whos the best one for network engineer', intent: 'find', c: { namesVacancy: true } },
  { q: 'give me best 3 for network enginer', intent: 'find', c: { namesVacancy: true } },
  { q: 'show shortlisted pls', intent: 'shortlist' },
  { q: 'why there is no strong candidates', intent: 'doctor' },
  { q: 'why so few strongs?', intent: 'doctor' },
  { q: 'compare 1st and 2nd one', intent: 'compare', c: listed },
  { q: 'compare first n second', intent: 'compare', c: listed },
  { q: 'open 2nd', intent: 'open', c: listed },
  { q: 'what u can see about me', intent: 'about' },
  { q: 'what happend since yesterday', intent: 'changes' },
  { q: 'make interview questions for 1st one', intent: 'interview', c: listed },
  // Azerbaijani with and without letters, broken grammar
  { q: 'excel bilen adam var?', intent: 'skills', skills: ['excel'] },
  { q: 'kim python bilir', intent: 'skills', skills: ['python'] },
  { q: 'pyton bilenler', intent: 'skills', skills: ['python'] },
  { q: 'mene sql bilenleri goster zehmet olmasa', intent: 'skills', skills: ['sql'] },
  { q: 'ingilis dili yaxsi bilen varmi', intent: 'skills', skills: ['english'] },
  { q: 'excel ve ya sql bilenler', intent: 'skills', skills: ['excel', 'sql'], mode: 'any' },
  { q: 'kubernetes ile ishleyen olub?', intent: 'skills', skills: ['kubernetes'] },
  { q: 'docker biliri olan namizedler', intent: 'skills', skills: ['docker'] },
  { q: 'linux bilen namizəd varmı bəlkə', intent: 'skills', skills: ['linux'] },
  { q: 'nece namized var bu vakansiyaya', intent: 'count' },
  { q: 'neçə nəfər müraciət edib', intent: 'count' },
  { q: 'en yaxsi namizedleri goster', intent: 'find', c: { namesVacancy: true } },
  { q: 'qisa siyahini goster', intent: 'shortlist' },
  { q: 'niye guclu namized yoxdur', intent: 'doctor' },
  { q: 'birinci ve ikinci muqayise et', intent: 'compare', c: listed },
  { q: 'ikincini ac', intent: 'open', c: listed },
  { q: 'birinci ucun musahibe suallari ver', intent: 'interview', c: listed },
  // Russian, informal
  { q: 'кто тут знает эксель', intent: 'skills', skills: ['excel'] },
  { q: 'покажи кто с питоном работал', intent: 'skills', skills: ['python'] },
  { q: 'сколько вообще кандидатов', intent: 'count' },
  // follow-ups, short and sloppy
  { q: 'ingilis dili', intent: 'skills', skills: ['english'], followUp: 'replace' },
  { q: 'and also english', intent: 'skills', skills: ['excel', 'english'], followUp: 'add', c: {} },
  { q: 'only strong ones', intent: 'skills', followUp: 'refine' },
  { q: 'həm də ingilis', intent: 'skills', skills: ['excel', 'english'], followUp: 'add', c: {} },
  // more shapes: texting, missing words, mixed languages
  { q: 'excel?', intent: 'skills', skills: ['excel'] },
  { q: 'python n sql', intent: 'skills', skills: ['python', 'sql'] },
  { q: 'who got docker + kubernetes', intent: 'skills', skills: ['docker', 'kubernetes'] },
  { q: 'ppl with excel exp', intent: 'skills', skills: ['excel'] },
  {
    q: 'need someone fluent in english and russian',
    intent: 'skills',
    skills: ['english', 'russian'],
  },
  { q: 'kim excel ve sql bilir', intent: 'skills', skills: ['excel', 'sql'] },
  { q: 'bgp biliri olan var bəs', intent: 'skills', skills: ['bgp'] },
  { q: 'mənə python bilən 3 nəfər tap', intent: 'skills', skills: ['python'] },
  { q: 'ingilisce bilen varmi', intent: 'skills', skills: ['english'] },
  { q: 'кто работал с докером', intent: 'skills', skills: ['docker'] },
  { q: 'нужны люди со знанием sql', intent: 'skills', skills: ['sql'] },
  { q: 'how many know excel', intent: 'skills', skills: ['excel'] },
  { q: 'whats the count', intent: 'count' },
  { q: 'give me top 5 pls', intent: 'find', c: { namesVacancy: true } },
  { q: 'who is best?', intent: 'find', c: { namesVacancy: true } },
  { q: 'show me shortlist', intent: 'shortlist' },
  { q: 'whats new from monday', intent: 'changes' },
  { q: 'always show 10', intent: 'prefs' },
  { q: 'nə deməkdi out of date', intent: 'help' },
  { q: 'what does partial mean', intent: 'help' },
];

describe('Messy messages, rules alone', () => {
  it('reads most of them without a model', () => {
    const { blankQuery } = jest.requireActual('./query') as typeof import('./query');
    const lastExcel = blankQuery();
    lastExcel.intent = 'skills';
    lastExcel.skills = [{ id: 'excel', label: 'Excel', phrase: null, words: [] }];
    lastExcel.confidence = 'high';
    const failures: string[] = [];
    for (const c of cases) {
      const follow = c.followUp !== undefined;
      const q = understand(c.q, ctx({ ...(follow ? { last: lastExcel, shown: 4 } : {}), ...c.c }));
      const ids = q.skills.map((s) => s.id ?? s.phrase);
      const good =
        q.intent === c.intent &&
        (!c.skills || JSON.stringify([...ids].sort()) === JSON.stringify([...c.skills].sort())) &&
        (!c.mode || q.mode === c.mode) &&
        (!c.followUp || q.followUp === c.followUp);
      if (!good)
        failures.push(
          `${c.q} -> ${q.intent} [${ids.join(',')}] ${q.followUp} (wanted ${c.intent} ${c.skills ?? ''})`,
        );
    }
    if (failures.length)
      console.log(`Messy, not read (${failures.length}/${cases.length}):\n${failures.join('\n')}`);
    expect((cases.length - failures.length) / cases.length).toBeGreaterThanOrEqual(GATE);
  });
});
