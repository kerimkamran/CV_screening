import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { looksLikeInjection } from '../pipeline/injection';
import { buildPackage, payloadShape, systemPrompt, userPrompt } from './assistant-rules';

/**
 * The redaction fixture pack (Development Plan WP 0.1 and 4.2): ten invented resumes in English,
 * Azerbaijani and Russian that carry names, contact details, birth dates, marital status, gender,
 * patronymics, nationality, religion, a photo line, links and one hidden instruction. For each one,
 * nothing listed in the manifest may reach the model.
 */
const DIR = join(__dirname, '../../../../docs/uat/resumes');
const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as {
  resumes: { file: string; candidateName: string; mustNotLeak: string[]; injection: boolean }[];
};

const ID = (n: number) => `00000000000000000000RQ${String(n).padStart(4, '0')}`;

describe('redaction fixture pack', () => {
  it('has ten resumes', () => expect(manifest.resumes).toHaveLength(10));

  it.each(manifest.resumes)('$file: nothing from the manifest reaches the model', (r) => {
    const text = readFileSync(join(DIR, r.file), 'utf8');
    const lines = text.split('\n').filter((l) => l.trim());
    const items = lines.map((l, i) => ({
      requirementId: ID(i + 1),
      text: `Requirement ${i + 1}`,
      classification: 'mandatory',
      status: 'met',
    }));
    const evidence = new Map(lines.map((l, i) => [ID(i + 1), [l]]));
    const injected = looksLikeInjection(text);
    expect(injected).toBe(r.injection);
    const built = buildPackage({
      label: 'Candidate 01',
      band: 'good',
      items,
      evidence,
      reason: `${r.candidateName} has a solid background. ${lines[2] ?? ''}`,
      candidateName: r.candidateName,
      injectionSuspected: injected,
    });
    const system = systemPrompt('SenAI', 'why', 'en', false);
    const user = userPrompt([built.pkg], 'Why this band?', []);
    const shape = payloadShape([built.pkg], system, user);
    expect(shape.violations).toEqual([]);
    for (const secret of r.mustNotLeak) {
      expect({ secret, leaked: user.toLowerCase().includes(secret.toLowerCase()) }).toEqual({
        secret,
        leaked: false,
      });
    }
    if (r.injection) expect(built.pkg.passages).toEqual([]);
  });
});
