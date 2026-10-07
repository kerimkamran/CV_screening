import {
  detectLanguage,
  fairnessReport,
  K_MIN,
  MIN_SCORED,
  summarise,
  type FairRow,
} from './fairness';
import { analyse, TEMPLATES, VARIANTS, type Cell } from './paired';

const row = (over: Partial<FairRow> = {}): FairRow => ({
  language: 'en',
  format: 'pdf',
  length: 'medium',
  scored: true,
  unread: false,
  score: 80,
  band: 'strong_match',
  ...over,
});
const many = (n: number, over: Partial<FairRow> = {}) => Array.from({ length: n }, () => row(over));

describe('detectLanguage', () => {
  it('tells Azerbaijani, Russian and English CVs apart', () => {
    expect(
      detectLanguage('Senior Network Engineer. Designed BGP routing for the carrier core.'),
    ).toBe('en');
    expect(
      detectLanguage(
        'Əli Həsənov. Şəbəkə mühəndisi, təcrübə: 6 il. Təhsil: Bakı Dövlət Universiteti.',
      ),
    ).toBe('az');
    expect(
      detectLanguage('Иван Петров. Сетевой инженер, опыт работы 6 лет. Образование: МГУ.'),
    ).toBe('ru');
    expect(detectLanguage('')).toBe('en');
  });
});

describe('fairness monitor', () => {
  it('flags a group served less than four fifths as often as the best, only with enough data', () => {
    const rows = [
      ...many(MIN_SCORED, { language: 'en', score: 85 }), // 100% favourable
      ...many(MIN_SCORED, { language: 'az', score: 85 }).slice(0, 14),
      ...many(6, { language: 'az', score: 40, band: 'limited_match' }), // 70% favourable
    ];
    const d = summarise(rows, 'language', 'Language');
    const en = d.groups.find((g) => g.group === 'en')!;
    const az = d.groups.find((g) => g.group === 'az')!;
    expect(en.impactRatio).toBe(1);
    expect(az.favourableRate).toBe(0.7);
    expect(az.impactRatio).toBe(0.7);
    expect(az.flag).toBe('review');
    expect(en.flag).toBe('ok');
  });

  it('does not compute ratios for small groups, and hides tiny ones entirely', () => {
    const rows = [
      ...many(MIN_SCORED),
      ...many(MIN_SCORED - 1, { language: 'ru', score: 10 }),
      ...many(K_MIN - 1, { language: 'az' }),
    ];
    const d = summarise(rows, 'language', 'Language');
    expect(d.groups.map((g) => g.group)).toEqual(['en', 'ru']);
    expect(d.suppressed).toBe(K_MIN - 1);
    expect(d.groups.find((g) => g.group === 'ru')).toMatchObject({
      flag: 'not_enough_data',
      impactRatio: null,
    });
  });

  it('counts a needs-a-look CV as not favourable, and reports unread files by format', () => {
    const rows = [
      ...many(MIN_SCORED, { format: 'pdf' }),
      ...many(MIN_SCORED, { format: 'docx', band: 'needs_review', score: 90 }),
      ...many(5, { format: 'docx', scored: false, unread: true, score: null, band: null }),
    ];
    const f = summarise(rows, 'format', 'Format');
    const docx = f.groups.find((g) => g.group === 'docx')!;
    expect(docx.favourableRate).toBe(0);
    expect(docx.needsLookRate).toBe(1);
    expect(docx.unreadRate).toBeCloseTo(5 / 25, 2);
    expect(docx.flag).toBe('review');
  });

  it('never reports an individual or a protected attribute', () => {
    const r = fairnessReport(many(30));
    expect(JSON.stringify(r)).not.toMatch(/"(gender|ethnicity|religion)"/);
    expect(r.dimensions.map((d) => d.key)).toEqual(['language', 'format', 'length']);
    expect(r.method.privacy).toContain('No protected attribute is collected or inferred');
  });
});

describe('paired-CV analysis', () => {
  const cells = (shift: (variant: string, template: string) => number, noise = 0): Cell[] =>
    TEMPLATES.flatMap((t) =>
      VARIANTS.map((v) => ({
        template: t.key,
        variant: v.key,
        arm: 'masked' as const,
        score: 60 + shift(v.key, t.key) + (v.key === 'repeat' ? noise : 0),
        statuses: ['met'],
      })),
    );

  it('is consistent when only the name changes and scores match', () => {
    const [s] = analyse(
      cells(() => 0),
      ['masked'],
    );
    expect(s).toMatchObject({ verdict: 'consistent', differing: 0, maxAbsDelta: 0, pairs: 18 });
  });
  it('tolerates a few points and the model’s own noise', () => {
    expect(
      analyse(
        cells((v) => (v === 'az_f' ? 4 : 0)),
        ['masked'],
      )[0]!.verdict,
    ).toBe('consistent');
    expect(
      analyse(
        cells((v) => (v === 'az_f' ? 9 : 0), 6),
        ['masked'],
      )[0]!.verdict,
    ).toBe('consistent');
  });
  it('flags a name that moves the score, and names the worst case', () => {
    const [s] = analyse(
      cells((v, t) => (v === 'ru_m' && t === 'strong' ? -20 : 0)),
      ['masked'],
    );
    expect(s!.verdict).toBe('review');
    expect(s!.differing).toBe(1);
    expect(s!.worst).toEqual({ template: 'strong', variant: 'ru_m', delta: -20 });
  });
  it('is incomplete when a call failed', () => {
    const c = cells(() => 0);
    c[3] = { ...c[3]!, score: null };
    expect(analyse(c, ['masked'])[0]!.verdict).toBe('incomplete');
  });
});
