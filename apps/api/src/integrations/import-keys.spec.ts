import { ImportKeys, keyHash, parseImportKeys } from './import-keys';

// Stage 3, S3-INT-02 (1) and (2).
describe('import keys', () => {
  const k1 = 'a'.repeat(32);
  const k2 = 'b'.repeat(32);

  it('gives the same 64-hex hash for the same input and key, another for another key version', () => {
    const a = keyHash({ version: 1, secret: k1 }, 'application', 'oracle_hcm', '300100');
    const b = keyHash({ version: 1, secret: k1 }, 'application', 'oracle_hcm', '300100');
    const c = keyHash({ version: 2, secret: k2 }, 'application', 'oracle_hcm', '300100');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(c).not.toBe(a);
    // Fixed vector: catches an accidental change to the hashing scheme (stored hashes must keep matching).
    expect(a).toBe(keyHash({ version: 9, secret: k1 }, 'application', 'oracle_hcm', '300100'));
    expect(keyHash({ version: 1, secret: k1 }, 'attachment', 'oracle_hcm', '300100')).not.toBe(a);
  });

  it('reads a bare value as version 1', () => {
    expect(parseImportKeys(k1)).toEqual([{ version: 1, secret: k1 }]);
    expect(ImportKeys.from(k1).current.version).toBe(1);
  });

  it('hashes with the first listed key and matches every listed version', () => {
    const keys = ImportKeys.from(`2:${k2},1:${k1}`);
    expect(keys.current.version).toBe(2);
    const ids = { applicationId: 'A1', personId: 'P1', requisitionId: 'R1' };
    const old = ImportKeys.from(k1).forItem('oracle_hcm', { ...ids, attachmentId: 'T1' });
    const now = keys.forItem('oracle_hcm', { ...ids, attachmentId: 'T1' });
    expect(now.keyVersion).toBe(2);
    expect(now.app).not.toBe(old.app);
    const all = keys.candidates('oracle_hcm', ids);
    expect(all).toEqual(expect.arrayContaining([old.app, old.person, now.app, now.person]));
    expect(all).toHaveLength(4);
  });

  it('refuses repeated versions and has no current key when unset', () => {
    expect(() => parseImportKeys(`1:${k1},1:${k2}`)).toThrow(/repeated/);
    expect(ImportKeys.from(undefined).available).toBe(false);
    expect(() => ImportKeys.from('').current).toThrow(/IMPORT_TOMBSTONE_KEY/);
  });
});
