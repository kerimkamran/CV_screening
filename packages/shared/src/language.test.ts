import { describe, expect, it } from 'vitest';
import {
  clean,
  closest,
  editDistance,
  fold,
  foldMapped,
  mentionsOf,
  phraseRegex,
  skillById,
  skillOfWord,
  skillRegex,
  skillsInTokens,
  stem,
  tokens,
  translit,
  windowAround,
} from './index.js';

describe('fold: one folded form for Azerbaijani, Russian and English', () => {
  it('folds Azerbaijani letters and the dotted i', () => {
    expect(fold('İSTEHSAL')).toBe('istehsal');
    expect(fold('PIPELINE')).toBe('pipeline');
    expect(fold('Şəbəkə Mühəndisi')).toBe('sebeke muhendisi');
    expect(fold('Bakıdakı')).toBe('bakidaki');
  });
  it('writes Cyrillic in Latin letters, for Russian and Azerbaijani typed in Cyrillic', () => {
    expect(translit('Кубернетес')).toBe('kubernetes');
    expect(fold('питон')).toBe('piton');
    expect(fold('шәбәкә')).toBe('sebeke');
  });
  it('drops zero-width characters and fixes look-alike letters inside a Latin word', () => {
    expect(clean('Ex​cel')).toBe('Excel');
    expect(fold('Exсel')).toBe('excel'); // Cyrillic "с" inside a Latin word
  });
  it('light endings and typos', () => {
    expect(stem('namizedlerin')).toBe('namized');
    expect(editDistance('exsel', 'excel')).toBe(1);
    expect(editDistance('pyhton', 'python')).toBe(1);
    expect(closest('kubernetis', ['kubernetes', 'docker'])).toBe('kubernetes');
    expect(closest('abc', ['abd'])).toBeNull();
    expect(tokens('Kubernetes-lə işləyənlər')).toEqual(['kubernetes', 'le', 'isleyenler']);
  });
});

describe('the skills dictionary', () => {
  const ids = (q: string) => skillsInTokens(tokens(q)).map((h) => h.skill.id);
  it('reads skills in three languages and with typos', () => {
    expect(ids('mənə excel bilən namizədləri çıxart')).toEqual(['excel']);
    expect(ids('Найди кандидатов, знающих Эксель и питон')).toEqual(['excel', 'python']);
    expect(ids('exsel və pyhton')).toEqual(['excel', 'python']);
    expect(ids('ingilis dili bilənlər')).toEqual(['english']);
    expect(ids('rus dili və ingilis dili')).toEqual(['russian', 'english']);
    expect(ids('Kubernetes-lə işləyənlər')).toEqual(['kubernetes']);
    expect(ids('кто знает английский')).toEqual(['english']);
    expect(ids('power bi')).toEqual(['powerbi']);
  });
  it('does not read ordinary words as skills', () => {
    expect(ids('excellent candidates for the role')).toEqual([]);
    expect(skillOfWord('excellent')).toBeNull();
    expect(skillOfWord('exceller')?.id).toBe('excel');
    expect(skillOfWord('excelde')?.id).toBe('excel');
    expect(ids('who set this up')).toEqual([]);
    expect(ids('javascript developers')).toEqual(['javascript']);
  });
  it('finds a skill in a resume, in the original text, with offsets', () => {
    const raw =
      'Skills\nMS Excel (pivot, VLOOKUP), Word.\nİngilis dili: C1\nEksel-də hesabatlar\nSapphire ring, SAP ERP';
    const f = foldMapped(raw);
    const excel = mentionsOf(f, skillRegex(skillById('excel')!), raw).map((m) =>
      raw.slice(m.start, m.end),
    );
    expect(excel).toEqual(['MS Excel', 'pivot', 'VLOOKUP', 'Eksel']);
    const en = mentionsOf(f, skillRegex(skillById('english')!), raw);
    expect(en).toHaveLength(1);
    const sap = mentionsOf(f, skillRegex(skillById('sap')!), raw).map((m) =>
      raw.slice(m.start, m.end),
    );
    expect(sap).toEqual(['SAP']);
    const w = windowAround(raw, en[0]!);
    expect(raw.slice(w.start, w.end)).toBe('İngilis dili: C1');
  });
  it('keeps C#, C++ and .NET apart, and searches an unknown word as written', () => {
    const raw = 'C# and ASP.NET, not C++. Terraformda işləyib.';
    const f = foldMapped(raw);
    expect(mentionsOf(f, skillRegex(skillById('csharp')!), raw)).toHaveLength(1);
    expect(mentionsOf(f, skillRegex(skillById('cpp')!), raw)).toHaveLength(1);
    expect(mentionsOf(f, skillRegex(skillById('dotnet')!), raw)).toHaveLength(1);
    expect(mentionsOf(f, phraseRegex('terraform'), raw)).toHaveLength(1);
  });
});
