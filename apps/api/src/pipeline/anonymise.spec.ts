import { anonymise, toAnon } from './anonymise';
import { ANON_FIXTURES } from './fixtures/anon-resumes';

describe('anonymise (10-resume fixture pack, zero misses)', () => {
  for (const f of ANON_FIXTURES) {
    it(`${f.id}: hides everything personal, keeps everything professional`, () => {
      const a = anonymise(f.text, f.names);
      const low = a.text.toLowerCase();
      const missed = f.hidden.filter((h) => low.includes(h.toLowerCase()));
      expect(missed).toEqual([]);
      const lost = f.kept.filter((k) => !a.text.includes(k));
      expect(lost).toEqual([]);
    });
  }

  it('maps an original position to the anonymised text and snaps out of a hidden block', () => {
    const text = 'Ali Veli works at Azercell as engineer';
    const a = anonymise(text, ['Ali Veli']);
    const at = text.indexOf('Azercell');
    const s = toAnon(a.regions, at, 'start');
    expect(a.text.slice(s, s + 8)).toBe('Azercell');
    expect(toAnon(a.regions, 3, 'start')).toBe(0);
  });

  it('hides a surname even when it is also a skill word (hidden on screen beats readable)', () => {
    const a = anonymise('Anar Routing\nWorked on routing and switching.', ['Anar Routing']);
    expect(a.text.toLowerCase()).not.toContain('routing');
    expect(a.text).toContain('switching');
  });
});
