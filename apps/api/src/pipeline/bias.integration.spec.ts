import { describeDb } from '../testing/pg-harness';
import { boot, type Harness } from '../testing/app-harness';
import { bandFor, computeScore, type ScoreInput } from './score';

/**
 * Bias review, mechanical part (docs/bias-review.md). These tests prove that nothing in OUR code
 * lets a name, a family detail, an age signal or a nationality change a score, a band or a rank.
 * They cannot prove the same of an AI model; that needs the labelled evaluation in the review.
 */
describe('the score formula uses job evidence only', () => {
  const items: ScoreInput[] = [
    { requirementId: '0000000000000000000000RQ01', text: 'BGP', classification: 'mandatory', weight: 10, status: 'met' },
    { requirementId: '0000000000000000000000RQ02', text: 'Kubernetes', classification: 'mandatory', weight: 10, status: 'not_found' },
    { requirementId: '0000000000000000000000RQ03', text: 'Python', classification: 'preferred', weight: 5, status: 'partially_met' },
  ];
  it('takes no personal field, and the same evidence always gives the same score and band', () => {
    expect(Object.keys(items[0]!).sort()).toEqual(['classification', 'requirementId', 'status', 'text', 'weight']);
    const a = computeScore(items);
    const b = computeScore(JSON.parse(JSON.stringify(items)));
    expect(a).toEqual(b);
    expect(a.score).toBe(50);
    expect(bandFor(a.score, false)).toBe('possible_match');
    // There is no "reject" band to fall into.
    expect(['strong_match', 'possible_match', 'weak_match', 'needs_review']).toContain(bandFor(0, false));
  });
});

describeDb('names and personal details do not move scores, bands or ranks', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await boot('bias');
  });
  afterAll(async () => h?.close());

  const job = ['BGP routing.', 'Kubernetes.', 'Python scripting.'];
  const people: { name: string; extra: string[] }[] = [
    { name: 'Aysel Məmmədova', extra: ['Female, born 1991, married with two children'] },
    { name: 'Rəşad Əliyev', extra: ['Male, born 1968, single'] },
    { name: 'John Smith', extra: ['Age 29. Nationality: British'] },
    { name: 'Maria Garcia', extra: ['Pregnant, maternity leave planned'] },
    { name: 'Иван Петров', extra: ['Гражданство: РФ, женат'] },
    { name: 'Elchin Hasanov oglu', extra: ['Muslim. Photo attached.'] },
  ];

  it('six different people with identical job evidence get identical scores and bands', async () => {
    const ayla = await h.recruiter('ayla-bias@azerconnect.test');
    const vid = await h.scenario(
      ayla.api,
      people.map((p) => ({ name: p.name, lines: [...job, ...p.extra] })),
    );
    const rows = (await ayla.api.get(`/vacancies/${vid}/candidates`)).json().candidates as {
      score: { value: number } | null;
      band: string;
      candidateName: string;
      ordinal: number;
    }[];
    expect(rows).toHaveLength(6);
    expect(new Set(rows.map((r) => r.score?.value)).size).toBe(1);
    expect(new Set(rows.map((r) => r.band)).size).toBe(1);
    // Pseudonyms follow upload order only, whatever the name.
    expect(rows.map((r) => r.ordinal).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('upload order, not the name, breaks a tie; reversing the names does not reverse the result', async () => {
    const ayla = await h.recruiter('ayla-bias2@azerconnect.test');
    const mk = async (names: string[]) => {
      const vid = await h.scenario(ayla.api, names.map((name) => ({ name, lines: job })));
      const rows = (await ayla.api.get(`/vacancies/${vid}/candidates`)).json().candidates as {
        candidateName: string;
        ordinal: number;
        score: { value: number };
      }[];
      return rows.map((r) => r.ordinal);
    };
    const names = people.map((p) => p.name);
    expect(await mk(names)).toEqual(await mk([...names].reverse()));
  });

  it('a protected detail in a CV does not change which requirements are met', async () => {
    const ayla = await h.recruiter('ayla-bias3@azerconnect.test');
    const vid = await h.scenario(ayla.api, [
      { name: 'Plain Person', lines: job },
      { name: 'Detailed Person', lines: [...job, 'Female, born 1991, married, two children, Muslim'] },
    ]);
    const rows = (await ayla.api.get(`/vacancies/${vid}/candidates`)).json().candidates as {
      score: { value: number; breakdown: { items: { status: string }[] } };
    }[];
    expect(rows[0]!.score.breakdown.items.map((i) => i.status)).toEqual(
      rows[1]!.score.breakdown.items.map((i) => i.status),
    );
    expect(rows[0]!.score.value).toBe(rows[1]!.score.value);
  });
});
