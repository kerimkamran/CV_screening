/**
 * MATCH-07. A quote the model supplies counts as evidence only if it appears verbatim in the
 * source document (whitespace-insensitive). Offsets are recomputed from the document, never trusted.
 */
export interface EvidenceSpan {
  start: number;
  end: number;
  quote: string;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function locateQuote(text: string, quote: string): EvidenceSpan | null {
  const words = quote.trim().split(/\s+/).filter(Boolean);
  // Too short to be meaningful evidence ("a", "of") — would match anywhere.
  if (words.join(' ').length < 3) return null;
  const re = new RegExp(words.map(esc).join('\\s+'), 'u');
  const m = re.exec(text);
  if (!m) return null;
  return { start: m.index, end: m.index + m[0].length, quote: m[0] };
}

export function verifyEvidence(text: string, quotes: string[]) {
  const spans: EvidenceSpan[] = [];
  let dropped = 0;
  for (const q of quotes.slice(0, 5)) {
    const s = locateQuote(text, q);
    if (s && !spans.some((x) => x.start === s.start && x.end === s.end)) spans.push(s);
    else if (!s) dropped++;
  }
  return { spans, dropped };
}
