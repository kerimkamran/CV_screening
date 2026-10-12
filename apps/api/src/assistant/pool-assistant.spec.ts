import { detectLanguage, looksEnglish, resolveVacancy, say, tierOf } from './pool-assistant';

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

describe('looksEnglish: a bare "ingilis dili" is not English, so the conversation keeps its language', () => {
  it('tells apart', () => {
    expect(looksEnglish('who knows Excel')).toBe(true);
    expect(looksEnglish('ingilis dili')).toBe(false);
    expect(looksEnglish('həm də SQL')).toBe(false);
  });
});
