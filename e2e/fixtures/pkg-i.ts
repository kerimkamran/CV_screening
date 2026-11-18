import { AZ } from '../../apps/web/src/i18n/az';

/**
 * Helpers of the last UAT pass (cases that had been left unbuilt). Every person and file here is
 * invented.
 */

/** The app's own lookup: English sentence → Azerbaijani, with {vars}. */
export function T(lang: 'en' | 'az') {
  return (en: string, vars?: Record<string, string | number>) => {
    const s = lang === 'az' ? (AZ[en] ?? en) : en;
    return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
  };
}

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A RegExp whose numbered captures follow the English order of the placeholders, in any language. */
class OrderedRegExp extends RegExp {
  constructor(
    source: string,
    private readonly order: string[],
  ) {
    super(source);
  }
  override exec(text: string): RegExpExecArray | null {
    const m = super.exec(text);
    if (!m) return m;
    const g = m.groups ?? {};
    const out = [m[0], ...this.order.map((n) => g[n])] as unknown as RegExpExecArray;
    out.index = m.index;
    out.input = m.input;
    out.groups = g;
    return out;
  }
}

/**
 * A regex for a sentence with {placeholders}: every placeholder matches digits, the rest is literal
 * (in the run's language). The captures are numbered in the order the placeholders appear in the
 * English sentence, so m[1] is the same value in both languages even when the Azerbaijani wording
 * puts the placeholders in another order (for example '{b} CV-dən {a}-i oxunub').
 */
export function rx(lang: 'en' | 'az', en: string, vars: Record<string, string | RegExp> = {}) {
  const s = lang === 'az' ? (AZ[en] ?? en) : en;
  const order = [...new Set([...en.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!))].filter(
    (n) => typeof vars[n] !== 'string',
  );
  const seen = new Set<string>();
  const src = s
    .split(/(\{\w+\})/)
    .map((p) => {
      const m = /^\{(\w+)\}$/.exec(p);
      if (!m) return escRe(p);
      const name = m[1]!;
      const v = vars[name];
      if (typeof v === 'string') return escRe(v);
      const body = v === undefined ? '\\d+' : v.source;
      // A placeholder used twice captures once; the repeat only has to match.
      if (seen.has(name)) return `(?:${body})`;
      seen.add(name);
      return `(?<${name}>${body})`;
    })
    .join('');
  return new OrderedRegExp(src, order);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
