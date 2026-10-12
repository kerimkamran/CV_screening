import { blankQuery, type Query } from './query';
import { understand, sinceOf, type Context } from './understand';
import { tokens } from '@cv/shared';

const ctx = (over: Partial<Context> = {}): Context => ({
  last: null,
  shown: 0,
  titleWords: new Set([
    'network',
    'engineer',
    'sales',
    'manager',
    'developer',
    'sebeke',
    'muhendisi',
  ]),
  namesVacancy: false,
  now: new Date('2026-10-12T10:00:00Z'), // a Monday in Baku
  ...over,
});
const ids = (q: Query) => q.skills.map((s) => s.id ?? s.phrase);

describe('understand: one question, one typed query', () => {
  it('the recruiters example: "mənə excel bilən namizədləri çıxart"', () => {
    const q = understand('mənə excel bilən namizədləri çıxart', ctx());
    expect(q.intent).toBe('skills');
    expect(ids(q)).toEqual(['excel']);
    expect(q.confidence).toBe('high');
  });

  it('skills in three languages, with typos, and and/or', () => {
    expect(ids(understand('Who knows Excel?', ctx()))).toEqual(['excel']);
    expect(ids(understand('Найди кандидатов, знающих Эксель', ctx()))).toEqual(['excel']);
    expect(ids(understand('exsel və pyhton bilənləri tap', ctx()))).toEqual(['excel', 'python']);
    const either = understand('SQL və ya Python bilən namizədlər', ctx());
    expect(either.mode).toBe('any');
    expect(ids(either)).toEqual(['sql', 'python']);
    expect(ids(understand('ingilis dili bilənlər', ctx()))).toEqual(['english']);
    expect(ids(understand('rus dili və ingilis dili bilən namizədlər', ctx()))).toEqual([
      'russian',
      'english',
    ]);
  });

  it('an unknown skill after "who knows", but not a word of a vacancy title', () => {
    const q = understand('mənə zorbaflux bilən namizədləri tap', ctx());
    expect(q.skills).toMatchObject([{ id: null, phrase: 'zorbaflux' }]);
    const t = understand('network engineer candidates who know BGP', ctx({ namesVacancy: true }));
    expect(ids(t)).toEqual(['bgp']);
  });

  it('counts, shortlist, best matches and numbers', () => {
    expect(
      understand('How many candidates for Network Engineer?', ctx({ namesVacancy: true })).intent,
    ).toBe('count');
    expect(
      understand('Show the Shortlist for Network Engineer', ctx({ namesVacancy: true })).intent,
    ).toBe('shortlist');
    expect(
      understand('Find the right candidate for Network Engineer', ctx({ namesVacancy: true }))
        .intent,
    ).toBe('find');
    expect(understand('top 3 for Network Engineer', ctx({ namesVacancy: true })).top).toBe(3);
    expect(
      understand('Network Engineer üçün uyğun namizədi tap', ctx({ namesVacancy: true })).intent,
    ).toBe('find');
    expect(understand('Сколько кандидатов на вакансию', ctx()).intent).toBe('count');
    const n = understand('how many know Excel', ctx());
    expect(n.intent).toBe('skills');
    expect(n.countOnly).toBe(true);
  });

  it('a domain word that is in a vacancy title is not a skill unless "who knows" is said', () => {
    expect(understand('candidates for Sales Manager', ctx({ namesVacancy: true })).intent).toBe(
      'find',
    );
    expect(ids(understand('who knows sales', ctx()))).toEqual(['sales']);
  });

  it('follow-ups: another skill, an added skill, a narrowed list, "only Strong", "top 3"', () => {
    const first = understand('mənə excel bilən namizədləri çıxart', ctx());
    const c = ctx({ last: first, shown: 5 });
    const second = understand('ingilis dili', c);
    expect(second.intent).toBe('skills');
    expect(second.followUp).toBe('replace');
    expect(ids(second)).toEqual(['english']);

    const added = understand('həm də ingilis dili', c);
    expect(added.followUp).toBe('add');
    expect(ids(added)).toEqual(['excel', 'english']);

    const narrowed = understand('onlardan yalnız ingilis dili bilənlər', c);
    expect(narrowed.followUp).toBe('narrow');
    expect(ids(narrowed)).toEqual(['excel', 'english']);

    const strong = understand('only strong ones', c);
    expect(strong.followUp).toBe('refine');
    expect(strong.intent).toBe('skills');
    expect(ids(strong)).toEqual(['excel']);
    expect(strong.bands).toEqual(['strong']);

    const top = understand('top 3', c);
    expect(top.followUp).toBe('refine');
    expect(top.top).toBe(3);
    expect(understand('show all', c).showAll).toBe(true);
  });

  it('references: ordinals, labels, "those"', () => {
    const c = ctx({ last: { ...blankQuery(), intent: 'find' }, shown: 5 });
    expect(understand('open the second one', c)).toMatchObject({
      intent: 'open',
      refs: [{ kind: 'ordinal', n: 2 }],
    });
    expect(understand('ikincisini aç', c)).toMatchObject({
      intent: 'open',
      refs: [{ kind: 'ordinal', n: 2 }],
    });
    expect(understand('07 aç', ctx())).toMatchObject({
      intent: 'open',
      refs: [{ kind: 'label', n: 7 }],
    });
    expect(understand('compare 07 and 31 and 12', ctx()).intent).toBe('compare');
    expect(understand('compare those three', c)).toMatchObject({
      intent: 'compare',
      refs: [{ kind: 'shown' }],
    });
    expect(understand('first 5 candidates', c).refs).toEqual([]);
  });

  it('the other intents', () => {
    expect(understand('why so few Strong?', ctx()).intent).toBe('doctor');
    expect(understand('niyə az güclü namizəd var?', ctx()).intent).toBe('doctor');
    expect(understand('what changed since Monday?', ctx()).intent).toBe('changes');
    expect(understand('bu həftə nə dəyişdi?', ctx()).intent).toBe('changes');
    const w = understand('what if Networking were nice-to-have?', ctx());
    expect(w.intent).toBe('what_if');
    expect(w.whatIf).toMatchObject({ to: 'nice' });
    expect(understand('interview questions for 07', ctx()).intent).toBe('interview');
    expect(understand('what did we conclude on 07 last time', ctx()).intent).toBe('recall');
    expect(understand('what can you see?', ctx()).intent).toBe('about');
    const h = understand('Out of date nə deməkdir?', ctx());
    expect(h).toMatchObject({ intent: 'help', topic: 'out_of_date' });
  });

  it('"all vacancies" widens the scope, and is not "show all"', () => {
    const q = understand('who knows Excel in all vacancies', ctx());
    expect(q.everywhere).toBe(true);
    expect(q.showAll).toBe(false);
    expect(understand('bütün vakansiyalarda excel bilənlər', ctx()).everywhere).toBe(true);
  });

  it('something it cannot read has low confidence, so a model gets a try', () => {
    expect(understand('hmm blorf zxqv', ctx()).confidence).toBe('low');
    expect(understand('salam', ctx()).intent).toBe('unknown');
  });
});

describe('sinceOf (Asia/Baku, today is Monday 12 Oct 2026)', () => {
  const now = new Date('2026-10-12T10:00:00Z');
  it('weekdays, this week, last week, yesterday, today', () => {
    expect(sinceOf(tokens('since monday'), now)).toBe('2026-10-12');
    expect(sinceOf(tokens('since friday'), now)).toBe('2026-10-09');
    expect(sinceOf(tokens('bazar ertəsindən'), now)).toBe('2026-10-12');
    expect(sinceOf(tokens('keçən həftə'), now)).toBe('2026-10-05');
    expect(sinceOf(tokens('bu həftə'), now)).toBe('2026-10-12');
    expect(sinceOf(tokens('вчера'), now)).toBe('2026-10-11');
    expect(sinceOf(tokens('no date here'), now)).toBeNull();
  });
});
