import { CONFIDENCE_LEVELS, REQ_STATUSES, REQUIREMENT_CLASSES } from '@cv/shared';
import { z } from 'zod';

const terms = z.array(z.string().trim().min(2).max(80)).min(1).max(12);
export const ruleSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('must_contain_any'), terms }),
  z.object({ type: z.literal('must_not_contain_any'), terms }),
]);

/** One criterion as edited by the recruiter. */
export const requirementInput = z
  .object({
    text: z.string().trim().min(3).max(500),
    classification: z.enum(REQUIREMENT_CLASSES),
    weight: z.number().min(1).max(100).nullish(),
    rule: ruleSchema.nullish(),
    confidence: z.enum(CONFIDENCE_LEVELS).nullish(),
  })
  .superRefine((r, ctx) => {
    if (r.classification === 'disqualifier') {
      if (!r.rule)
        ctx.addIssue({ code: 'custom', path: ['rule'], message: 'disqualifier needs a rule' });
      if (r.weight != null)
        ctx.addIssue({
          code: 'custom',
          path: ['weight'],
          message: 'disqualifiers carry no weight',
        });
    } else if (r.rule) {
      ctx.addIssue({ code: 'custom', path: ['rule'], message: 'only disqualifiers carry a rule' });
    }
    if (r.classification === 'informational' && r.weight != null) {
      ctx.addIssue({
        code: 'custom',
        path: ['weight'],
        message: 'informational criteria are not scored',
      });
    }
  });
export const requirementsInput = z.array(requirementInput).min(1).max(40);

/** What we accept back from the model when extracting criteria from a JD. Validated, never trusted. */
export const extractionOutput = z.object({
  requirements: z.array(
    z.object({
      text: z.string(),
      classification: z.enum(REQUIREMENT_CLASSES),
      weight: z.number().nullish(),
      confidence: z.enum(CONFIDENCE_LEVELS).nullish(),
      rule: ruleSchema.nullish(),
    }),
  ),
});

/** What we accept back from the model when assessing a CV. */
export const assessmentOutput = z.object({
  candidate: z.object({ name: z.string().nullish(), email: z.string().nullish() }).nullish(),
  summary: z.string().nullish(),
  assessments: z.array(
    z.object({
      id: z.string(),
      status: z.enum(REQ_STATUSES),
      confidence: z.enum(CONFIDENCE_LEVELS).nullish(),
      evidence: z.array(z.string()).nullish(),
      rationale: z.string().nullish(),
    }),
  ),
});

/** Models sometimes wrap JSON in prose or fences; take the outermost object. */
export function parseJsonLoose(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in model output');
  return JSON.parse(text.slice(start, end + 1));
}
