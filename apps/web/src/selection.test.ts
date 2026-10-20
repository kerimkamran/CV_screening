import { beforeEach, describe, expect, it } from 'vitest';
import { downloadNotice, filterKey, loadSelection, saveSelection, sizeText } from './selection';

beforeEach(() => sessionStorage.clear());

describe('selection (S2-FE6)', () => {
  it('keeps the selection when only the order changes', () => {
    expect(filterKey('vacancy=V&sort=match&order=desc')).toBe(
      filterKey('order=asc&vacancy=V&sort=candidate'),
    );
    expect(filterKey('vacancy=V&q=bgp')).not.toBe(filterKey('vacancy=V'));
  });

  it('comes back for the same filter only, and ignores anything malformed', () => {
    const sel = new Map<string, string | null>([
      ['D1', 'M1'],
      ['D2', null],
    ]);
    saveSelection('cv-pool:all', 'vacancy=V', sel);
    expect(loadSelection('cv-pool:all', 'vacancy=V')).toEqual(sel);
    expect(loadSelection('cv-pool:all', 'vacancy=W').size).toBe(0);
    sessionStorage.setItem('cv-pool-selection:x', '{"filter":"f","items":[[1,2],["D",null]]}');
    expect([...loadSelection('x', 'f')]).toEqual([['D', null]]);
    saveSelection('cv-pool:all', 'vacancy=V', new Map());
    expect(loadSelection('cv-pool:all', 'vacancy=V').size).toBe(0);
  });

  it('says what is downloaded and what was left out', () => {
    expect(sizeText(300)).toBe('1 KB');
    expect(sizeText(96 * 1024 * 1024)).toBe('96 MB');
    expect(downloadNotice({ url: '', archiveName: '', files: 1, bytes: 5000, excluded: [] })).toBe(
      'Downloading 1 CV (5 KB) as one ZIP.',
    );
    const many = Array.from({ length: 7 }, (_, i) => ({
      documentId: `D${i}`,
      label: i === 0 ? null : `Candidate 0${i}`,
      reason: (i === 0 ? 'not_found' : 'erased') as 'erased' | 'not_found',
    }));
    expect(
      downloadNotice({
        url: '',
        archiveName: '',
        files: 3,
        bytes: 3 * 1024 * 1024,
        excluded: many,
      }),
    ).toBe(
      'Downloading 3 CVs (3.0 MB) as one ZIP. 7 left out: a CV (not found or not yours to see), Candidate 01 (the CV was erased), Candidate 02 (the CV was erased), Candidate 03 (the CV was erased), Candidate 04 (the CV was erased) and 2 more.',
    );
  });
});
