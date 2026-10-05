/**
 * Closed vocabularies from the Programme Plan v1.0. These mirror the Postgres enums in
 * db/migrations; a test asserts the two stay in sync.
 */

/** JOB-04: exactly one classification per criterion. `disqualifier` never carries a weight. */
export const REQUIREMENT_CLASSES = [
  'mandatory',
  'preferred',
  'informational',
  'disqualifier',
] as const;
export type RequirementClass = (typeof REQUIREMENT_CLASSES)[number];

/** MATCH-02: six-state status. `not_found` is first-class and never coerced to `not_met` (MATCH-04). */
export const REQ_STATUSES = [
  'met',
  'partially_met',
  'not_met',
  'not_found',
  'ambiguous',
  'not_applicable',
] as const;
export type ReqStatus = (typeof REQ_STATUSES)[number];

/** MATCH-05 */
export const CONFIDENCE_LEVELS = ['high', 'medium', 'low', 'unknown'] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

/** D6: one engine, two screening profiles. */
export const SCREENING_PROFILES = ['volume', 'depth'] as const;
export type ScreeningProfile = (typeof SCREENING_PROFILES)[number];

/** DOC-05 pipeline states. */
export const DOCUMENT_STATES = [
  'queued',
  'processing',
  'parsed',
  'evaluated',
  'completed',
  'failed',
  'needs_review',
] as const;
export type DocumentState = (typeof DOCUMENT_STATES)[number];

const FORWARD: Record<DocumentState, readonly DocumentState[]> = {
  queued: ['processing'],
  processing: ['parsed'],
  parsed: ['evaluated'],
  evaluated: ['completed'],
  completed: [],
  failed: [],
  needs_review: [],
};

/**
 * DOC-05: permitted transitions are Queued → Processing → Parsed → Evaluated → Completed,
 * or into Failed / Needs Review from any non-terminal state. Anything else is illegal.
 */
export function canTransition(from: DocumentState, to: DocumentState): boolean {
  if (from === to) return false;
  if (from === 'completed' || from === 'failed' || from === 'needs_review') return false;
  if (to === 'failed' || to === 'needs_review') return true;
  return FORWARD[from].includes(to);
}

/** AUD: principal kinds recorded on every audit event (IAM-05). */
export const ACTOR_KINDS = ['human', 'service'] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

/** IAM-03 role set. Mirrors the Postgres `app_role` enum. Roles come from database grants, never from IdP claims. */
export const ROLES = ['TA_PARTNER', 'TA_LEAD', 'GOVERNANCE', 'ADMIN', 'SERVICE'] as const;
export type Role = (typeof ROLES)[number];

/** MVP screening pipeline. Mirror the Postgres enums of the same names (parity-checked in CI). */
export const PARSE_STATUSES = ['parsed', 'empty', 'failed'] as const;
export type ParseStatus = (typeof PARSE_STATUSES)[number];

export const SCREENING_STATES = ['queued', 'processing', 'completed', 'failed', 'manual'] as const;
export type ScreeningState = (typeof SCREENING_STATES)[number];

/** A human outcome. The AI never produces one of these (WORK-13). */
export const DECISION_OUTCOMES = ['shortlist', 'hold', 'reject'] as const;
export type DecisionOutcome = (typeof DECISION_OUTCOMES)[number];
