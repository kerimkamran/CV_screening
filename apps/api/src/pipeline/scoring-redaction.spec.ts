import { locateQuote, verifyEvidence } from './evidence';
import { extractIdentity, maskForScoring, toOriginal } from './scoring-redaction';

const CV = `Aysel Mammadova
aysel.m@example.com | +994 50 123 45 67
linkedin.com/in/aysel-m

Date of birth: 12.03.1991
Marital status: married, 2 children
Nationality: Azerbaijani
Gender: female

Experience
Senior Network Engineer, 2018-2024. Ran BGP routing for the carrier core and Kubernetes clusters.
Aysel led a team of 6 engineers. 34 years old.
`;

describe('extractIdentity', () => {
  it('reads name and e-mail by code', () => {
    expect(extractIdentity(CV)).toEqual({ name: 'Aysel Mammadova', email: 'aysel.m@example.com' });
  });
  it('prefers a labelled name', () => {
    expect(extractIdentity('Name: Bob Routing\nCV\nBGP').name).toBe('Bob Routing');
  });
  it('does not take a heading for a name', () => {
    expect(
      extractIdentity('Curriculum Vitae\nWork Experience\nBGP routing for 5 years').name,
    ).toBeNull();
  });
  it('handles Azerbaijani and Cyrillic names', () => {
    expect(extractIdentity('Əli Həsənov\nBGP').name).toBe('Əli Həsənov');
    expect(extractIdentity('Иван Петров\nBGP').name).toBe('Иван Петров');
  });
});

describe('maskForScoring', () => {
  const id = extractIdentity(CV);
  const m = maskForScoring(CV, id.name);

  it('removes identity, contact, links and personal fields', () => {
    for (const bad of [
      'Aysel',
      'Mammadova',
      'aysel.m@example.com',
      '994 50',
      'linkedin.com',
      '12.03.1991',
      'married',
      'Azerbaijani',
      'female',
      '34 years old',
    ]) {
      expect(m.text).not.toContain(bad);
    }
  });
  it('keeps the professional content exactly', () => {
    expect(m.text).toContain('Ran BGP routing for the carrier core and Kubernetes clusters.');
    expect(m.text).toContain('Senior Network Engineer, 2018-2024');
    expect(m.text).toContain('led a team of 6 engineers');
  });
  it('counts what it masked without recording values', () => {
    expect(m.counts.email).toBe(1);
    expect(m.counts.personal).toBe(4);
    expect(JSON.stringify(m.counts)).not.toContain('@');
  });
  it('maps a quote back to the same words in the original CV', () => {
    const f = verifyEvidence(m.text, ['Ran BGP routing for the carrier core']);
    expect(f.spans).toHaveLength(1);
    const o = toOriginal(m, f.spans[0]!.start, f.spans[0]!.end)!;
    expect(CV.slice(o.start, o.end)).toBe('Ran BGP routing for the carrier core');
  });
  it('refuses a quote that touches a masked place', () => {
    const s = locateQuote(m.text, '[name] led a team of 6 engineers')!;
    expect(s).not.toBeNull();
    expect(toOriginal(m, s.start, s.end)).toBeNull();
  });
  it('does nothing to a CV without personal data', () => {
    const plain = 'Built BGP automation in Python.';
    const r = maskForScoring(plain, null);
    expect(r.text).toBe(plain);
    expect(r.regions).toHaveLength(0);
  });
  it('masks Azerbaijani and Russian labelled fields', () => {
    const t = 'Doğum tarixi: 01.01.1990\nAilə vəziyyəti: evli\nДата рождения: 1990\nSemantic BGP';
    const r = maskForScoring(t, null);
    expect(r.text).not.toMatch(/1990|evli/);
    expect(r.text).toContain('Semantic BGP');
  });
});
