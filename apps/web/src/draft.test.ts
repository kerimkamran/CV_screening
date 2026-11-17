import { describe, expect, it } from 'vitest';
import { mergeDraftOnto } from './draft';

const base = { title: 'Engineer', notes: 'old', location: 'Bakı', reqs: [{ text: 'BGP' }] };

describe('mergeDraftOnto (SD-54)', () => {
  it("takes only the fields the person changed, so a colleague's edit survives", () => {
    const typed = { ...base, location: 'Gəncə' };
    const theirs = { ...base, notes: 'from A' };
    const merged = mergeDraftOnto({ form: typed, base, at: 'now' }, theirs);
    expect(merged).toEqual({ ...base, notes: 'from A', location: 'Gəncə' });
  });

  it('takes a changed list of skills whole', () => {
    const typed = { ...base, reqs: [{ text: 'BGP' }, { text: 'MPLS' }] };
    const merged = mergeDraftOnto({ form: typed, base, at: 'now' }, { ...base, notes: 'x' });
    expect(merged.reqs).toHaveLength(2);
    expect(merged.notes).toBe('x');
  });

  it('an older draft without a base replaces everything', () => {
    const typed = { ...base, location: 'Gəncə' };
    expect(mergeDraftOnto({ form: typed, at: 'then' }, { ...base, notes: 'from A' })).toEqual(
      typed,
    );
  });
});
