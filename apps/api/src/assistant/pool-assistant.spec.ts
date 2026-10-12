import {
  detectLanguage,
  mentions,
  parseQuestion,
  resolveVacancy,
  say,
  skillFold,
  skillQuery,
  tierOf,
} from './pool-assistant';

const V = (id: string, title: string) => ({ id, title, status: 'open' });

describe('detectLanguage', () => {
  it('reads the language of the question', () => {
    expect(detectLanguage('Find the right candidate for Network Engineer')).toBe('en');
    expect(detectLanguage('Şəbəkə mühəndisi üçün uyğun namizədi tap')).toBe('az');
    expect(detectLanguage('sebeke muhendisi ucun namized tap')).toBe('az');
    expect(detectLanguage('Найди подходящего кандидата')).toBe('ru');
    expect(detectLanguage('5')).toBeNull();
  });
});

describe('resolveVacancy: three tiers, synonyms, Azerbaijani folding', () => {
  const vs = [
    V('1', 'Senior Network Engineer'),
    V('2', 'Network Engineer'),
    V('3', 'Software Developer'),
    V('4', 'Şəbəkə Mühəndisi'),
  ];
  it('exact: the whole title is in the question, and the longer title wins', () => {
    const r = resolveVacancy('Find the right candidate for Senior Network Engineer', vs);
    expect(r.tier).toBe('exact');
    expect(r.matches.map((m) => m.id)).toEqual(['1']);
  });
  it('exact on the shorter title when the longer one is not named', () => {
    const r = resolveVacancy('best candidates for network engineer', vs);
    expect(r.tier).toBe('exact');
    expect(r.matches.map((m) => m.id)).toEqual(['2']);
  });
  it('close: every word is there, in another order or form', () => {
    expect(tierOf('engineer, network: who fits?', 'Network Engineer')).toBe('close');
    expect(tierOf('Şəbəkə mühəndisi üçün namizəd', 'Network Engineer')).toBe('close');
  });
  it('folds Azerbaijani letters and treats suffixes as the same word', () => {
    const r = resolveVacancy('sebeke muhendisi ucun en yaxsi namized', vs);
    expect(r.matches.map((m) => m.id)).toContain('4');
  });
  it('partial: only some words, so the person is asked', () => {
    const r = resolveVacancy('who fits the engineer role', [V('1', 'Senior Network Engineer')]);
    expect(r.tier).toBe('partial');
  });
  it('a level word alone never matches', () => {
    expect(tierOf('senior people', 'Senior Network Engineer')).toBe('none');
  });
  it('none when nothing is named', () => {
    expect(resolveVacancy('who is good at cooking', vs).tier).toBe('none');
  });
  it('several vacancies in the same tier are all returned, so the person can pick', () => {
    const r = resolveVacancy('developer', [
      V('1', 'Frontend Developer'),
      V('2', 'Backend Developer'),
    ]);
    expect(r.matches).toHaveLength(2);
  });
  it('knows the Russian synonyms', () => {
    expect(tierOf('кандидаты на сетевой инженер', 'Network Engineer')).toBe('close');
  });
});

describe('parseQuestion', () => {
  it('finds what is asked and how many', () => {
    expect(parseQuestion('Find the right candidate for X')).toMatchObject({
      ask: 'find',
      top: 5,
      all: false,
    });
    expect(parseQuestion('How many candidates for X?').ask).toBe('count');
    expect(parseQuestion('Show the shortlist for X').ask).toBe('shortlist');
    expect(parseQuestion('top 3 for X')).toMatchObject({ ask: 'find', top: 3 });
    expect(parseQuestion('show all candidates for X').all).toBe(true);
    expect(parseQuestion('neçə namizəd var').ask).toBe('count');
    expect(parseQuestion('hello').ask).toBe('unknown');
  });
});

describe('say', () => {
  it('fills the wording in the three languages', () => {
    expect(
      say('en', 'found', { n: 3, title: 'X', strong: 1, good: 1, partial: 1, limited: 0 }),
    ).toContain('Found 3 for X');
    expect(
      say('az', 'found', { n: 3, title: 'X', strong: 1, good: 1, partial: 1, limited: 0 }),
    ).toContain('3 namizəd');
  });
});

describe('skillQuery: a skill in the question, read by rules', () => {
  it('the example from the recruiters: "mənə excel bilən namizədləri çıxart"', () => {
    const q = skillQuery('mənə excel bilən namizədləri çıxart');
    expect(q?.labels).toEqual(['Excel']);
    expect(q?.any).toBe(false);
  });
  it('English and Russian', () => {
    expect(skillQuery('Who knows Excel?')?.labels).toEqual(['Excel']);
    expect(skillQuery('Show candidates with SQL and Python')?.labels).toEqual(['SQL', 'Python']);
    expect(skillQuery('Найди кандидатов, знающих Excel')?.labels).toEqual(['Excel']);
    expect(skillQuery('кто владеет английским')?.labels).toEqual(['English']);
  });
  it('"or" means any of them', () => {
    const q = skillQuery('SQL və ya Python bilən namizədlər');
    expect(q?.any).toBe(true);
    expect(q?.labels).toEqual(['SQL', 'Python']);
  });
  it('an unknown skill is searched as the words written', () => {
    const q = skillQuery('mənə terraform bilən namizədləri tap');
    expect(q?.labels).toEqual(['Terraform']);
    expect(q?.groups).toEqual([['terraform']]);
  });
  it('is not a skill question when no skill is asked for', () => {
    expect(skillQuery('Find the right candidate for Network Engineer')).toBeNull();
    expect(skillQuery('How many candidates for Network Engineer?')).toBeNull();
    expect(skillQuery('Show the Shortlist for Network Engineer')).toBeNull();
    expect(skillQuery('şəbəkə mühəndisi üçün uyğun namizədi tap')).toBeNull();
  });
  it('words of the vacancy title are not skills', () => {
    const q = skillQuery('Network Engineer candidates who know BGP', 'Network Engineer');
    expect(q?.labels).toEqual(['BGP']);
  });
});

describe('mentions: whole words, with Azerbaijani suffixes', () => {
  const g = ['sap'];
  it('counts a skill in resume text', () => {
    const t = skillFold('Skills: MS Excel (pivot, VLOOKUP), Word. Excel-də hesabatlar.');
    expect(mentions(t, ['excel', 'vlookup', 'pivot'])).toBeGreaterThanOrEqual(3);
  });
  it('short words stand alone', () => {
    expect(mentions(skillFold('Worked with SAP and Oracle'), g)).toBe(1);
    expect(mentions(skillFold('A sapphire ring'), g)).toBe(0);
    expect(mentions(skillFold('JavaScript developer'), ['java'])).toBe(0);
  });
  it('keeps C#, C++ and .NET apart', () => {
    expect(mentions(skillFold('C# and .NET, no C++'), ['csharp'])).toBe(1);
    expect(mentions(skillFold('C# and .NET'), ['cpp'])).toBe(0);
    expect(mentions(skillFold('ASP.NET'), ['dotnet'])).toBe(1);
  });
});
