import { afterEach, describe, expect, it } from 'vitest';
import {
  applyCustomSkills,
  skillById,
  skillsInTokens,
  tokens,
  mentionsOf,
  foldMapped,
  skillRegex,
} from './index';

afterEach(() => applyCustomSkills([]));

describe('approved extra skills', () => {
  it('adds a new skill that is read in questions and found in resumes', () => {
    expect(skillsInTokens(tokens('who knows zorblax suite'))).toEqual([]);
    applyCustomSkills([
      {
        id: 'zorblax',
        label: 'Zorblax',
        kind: 'domain',
        aliases: ['zorblax suite', 'zorblax'],
        extends: null,
      },
    ]);
    expect(skillsInTokens(tokens('who knows zorblax suite')).map((h) => h.skill.id)).toEqual([
      'zorblax',
    ]);
    const raw = 'Built Zorblax labs for operators.';
    const m = mentionsOf(foldMapped(raw), skillRegex(skillById('zorblax')!), raw);
    expect(m).toHaveLength(1);
  });

  it('adds ways to write a built-in skill and never removes one', () => {
    applyCustomSkills([
      { id: 'x', label: 'Excel', kind: 'tool', aliases: ['tabular wizardry'], extends: 'excel' },
    ]);
    expect(skillsInTokens(tokens('tabular wizardry')).map((h) => h.skill.id)).toEqual(['excel']);
    expect(skillById('excel')).toBeTruthy();
    applyCustomSkills([]);
    expect(skillsInTokens(tokens('tabular wizardry'))).toEqual([]);
    expect(skillsInTokens(tokens('excel')).map((h) => h.skill.id)).toEqual(['excel']);
  });

  it('ignores an entry that clashes with a built-in id', () => {
    applyCustomSkills([
      { id: 'excel', label: 'Hijack', kind: 'tool', aliases: ['zzz'], extends: null },
    ]);
    expect(skillById('excel')!.label).toBe('Excel');
  });
});
