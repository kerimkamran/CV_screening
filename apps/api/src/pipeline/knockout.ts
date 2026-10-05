/**
 * KNOCK-01/05. Deterministic knockout: plain string matching, no model call, no network.
 * A triggered rule routes the candidate to human review; it never rejects anyone.
 */
export type KnockoutRule =
  { type: 'must_contain_any'; terms: string[] } | { type: 'must_not_contain_any'; terms: string[] };

export interface KnockoutOutcome {
  requirementId: string;
  text: string;
  rule: KnockoutRule;
  triggered: boolean;
  matchedTerms: string[];
}

const fold = (s: string) =>
  s
    .normalize('NFKC')
    .replace(/İ/g, 'i')
    .replace(/I/g, 'i') // Azerbaijani/Turkish dotted/dotless i: treat both as i for matching
    .replace(/ı/g, 'i')
    .toLowerCase();

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole-term match that works for Latin, Cyrillic and Azerbaijani letters (not ASCII-only \b). */
export function containsTerm(haystack: string, term: string): boolean {
  const t = fold(term).trim();
  if (!t) return false;
  const re = new RegExp(
    `(?<![\\p{L}\\p{N}])${esc(t).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`,
    'u',
  );
  return re.test(fold(haystack));
}

export function evaluateKnockout(
  requirement: { id: string; text: string; rule: KnockoutRule },
  cvText: string,
): KnockoutOutcome {
  const matchedTerms = requirement.rule.terms.filter((t) => containsTerm(cvText, t));
  const triggered =
    requirement.rule.type === 'must_contain_any'
      ? matchedTerms.length === 0
      : matchedTerms.length > 0;
  return {
    requirementId: requirement.id,
    text: requirement.text,
    rule: requirement.rule,
    triggered,
    matchedTerms,
  };
}
