/**
 * The typed query: what a question means, as data (SenAI plan 6.2 steps 4 and 5). Rules or the
 * model write one; the server checks it and runs it. Nothing in it is free text that reaches a
 * resume: skills are dictionary ids or words that appear in the question.
 */
import { z } from 'zod';
import type { Mark, MatchBand } from '@cv/shared';

export const INTENTS = [
  'find', // the best matches for a vacancy
  'count', // how many
  'shortlist', // the Shortlist
  'skills', // who knows X (searched in the resumes)
  'compare', // 2-3 candidates side by side
  'doctor', // why so few Strong; which requirement is rare
  'changes', // what changed since a date
  'what_if', // what if a requirement were nice-to-have
  'open', // open a candidate or a vacancy
  'interview', // interview kit for a candidate
  'recall', // what did we conclude
  'about', // what can you see, how did you get this
  'help', // how do I use the tool, what does a word mean
  'prefs', // always show the top 10
  'jd', // check the job description
  'consistency', // look at my own decisions for contradictions
  'quality', // duplicates, thin or unreadable resumes
  'similar', // vacancies that share requirements
  'rediscover', // candidates of other vacancies who may fit this one (switch)
  'challenge', // "but he does know Kubernetes": check the resume for what the recruiter says
  'unknown',
] as const;
export type Intent = (typeof INTENTS)[number];

export type Band = Exclude<MatchBand, 'human'>;
export const BANDS: Band[] = ['strong', 'good', 'partial', 'limited'];
export const MARKS: Mark[] = ['new', 'shortlist', 'maybe', 'not_now'];

/** A skill asked for: a dictionary id, or the words as written when the dictionary has none. */
export interface SkillTerm {
  id: string | null;
  label: string;
  /** Folded words, only when id is null. */
  phrase: string | null;
  /** The folded words of the question the skill was read from. */
  words: string[];
}

export type Ref =
  | { kind: 'ordinal'; n: number } // "the second one"
  | { kind: 'last' } // "the last one"
  | { kind: 'label'; n: number } // "Candidate 07"
  | { kind: 'shown' }; // "those", "these three"

export type FollowUp = 'new' | 'replace' | 'add' | 'narrow' | 'refine';

export interface Query {
  intent: Intent;
  followUp: FollowUp;
  skills: SkillTerm[];
  /** "Excel and SQL": every skill. "Excel or SQL": any of them. */
  mode: 'all' | 'any';
  bands: Band[];
  decisions: Mark[];
  top: number | null;
  showAll: boolean;
  /** "How many know Excel": only the number. */
  countOnly: boolean;
  refs: Ref[];
  /** YYYY-MM-DD in Asia/Baku, for "since Monday". */
  since: string | null;
  whatIf: { text: string; to: 'nice' | 'must' } | null;
  /** "all vacancies" was said. */
  everywhere: boolean;
  /** A word or screen the person asks about (help). */
  topic: string | null;
  /** The question says "who knows ...": a word after it is a skill even if the dictionary lacks it. */
  trigger: boolean;
  confidence: 'high' | 'low';
  source: 'rules' | 'model';
}

export const blankQuery = (): Query => ({
  intent: 'unknown',
  followUp: 'new',
  skills: [],
  mode: 'all',
  bands: [],
  decisions: [],
  top: null,
  showAll: false,
  countOnly: false,
  refs: [],
  since: null,
  whatIf: null,
  everywhere: false,
  topic: null,
  trigger: false,
  confidence: 'low',
  source: 'rules',
});

/** What the model is allowed to return. Every field is checked again by `validate`. */
export const modelQuerySchema = z.object({
  intent: z.enum(INTENTS),
  followUp: z.enum(['new', 'replace', 'add', 'narrow', 'refine']).default('new'),
  skills: z
    .array(z.object({ id: z.string().max(40).nullable().default(null), text: z.string().max(60) }))
    .max(5)
    .default([]),
  mode: z.enum(['all', 'any']).default('all'),
  bands: z
    .array(z.enum(['strong', 'good', 'partial', 'limited']))
    .max(4)
    .default([]),
  decisions: z
    .array(z.enum(['new', 'shortlist', 'maybe', 'not_now']))
    .max(4)
    .default([]),
  top: z.number().int().min(1).max(50).nullable().default(null),
  showAll: z.boolean().default(false),
  countOnly: z.boolean().default(false),
  refs: z
    .array(
      z.object({
        kind: z.enum(['ordinal', 'last', 'label', 'shown']),
        n: z.number().int().min(1).max(999).optional(),
      }),
    )
    .max(3)
    .default([]),
  sinceDays: z.number().int().min(0).max(365).nullable().default(null),
  whatIf: z
    .object({ text: z.string().max(80), to: z.enum(['nice', 'must']) })
    .nullable()
    .default(null),
  everywhere: z.boolean().default(false),
  topic: z.string().max(60).nullable().default(null),
  /** The vacancy the message is about, copied from the list of titles it was given (checked by the server). */
  vacancy: z.string().max(120).nullable().default(null),
});
export type ModelQuery = z.infer<typeof modelQuerySchema>;

/** A short English description of a query, for the model (a follow-up reads the previous one) and for "How I got this". */
export function describe(q: Query): string {
  const parts: string[] = [q.intent];
  if (q.skills.length)
    parts.push(`skills: ${q.skills.map((s) => s.label).join(q.mode === 'any' ? ' or ' : ' and ')}`);
  if (q.bands.length) parts.push(`bands: ${q.bands.join(', ')}`);
  if (q.decisions.length) parts.push(`marks: ${q.decisions.join(', ')}`);
  if (q.top) parts.push(`top ${q.top}`);
  if (q.everywhere) parts.push('all vacancies');
  return parts.join('; ');
}
