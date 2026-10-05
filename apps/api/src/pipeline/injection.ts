/** AISEC-02. Heuristic flag for CV text that tries to instruct the screening model. A hit routes to human review. */
const PATTERNS: RegExp[] = [
  /ignore (all |any |the )?(previous|prior|above|earlier) (instructions|prompts?|rules)/i,
  /disregard (all |any |the )?(previous|prior|above|earlier|your) (instructions|prompts?|rules|criteria)/i,
  /(system|developer) prompt/i,
  /you are (now )?(an?|the) (ai|assistant|language model|llm)/i,
  /(rate|score|mark|assess) (this|the) (candidate|cv|resume|applicant)/i,
  /(mark|rate|score) (all|every|each) (requirement|criteri)/i,
  /\bas an ai\b/i,
];

export const looksLikeInjection = (text: string): boolean => PATTERNS.some((p) => p.test(text));
