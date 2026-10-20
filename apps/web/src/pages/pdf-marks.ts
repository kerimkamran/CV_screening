/**
 * Finding a requirement's quotes on a PDF page (Stage 2, review screen). Pure functions, so they are
 * tested without pdf.js.
 */

/** Lower case, letters and digits only: a quote still matches across line breaks and hyphens. */
export const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** A box on a page, as fractions of the page's width and height (so it follows the zoom). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface TextBit {
  str: string;
  transform: number[];
  width: number;
}
const mul = (m: number[], n: number[]) => [
  m[0]! * n[0]! + m[2]! * n[1]!,
  m[1]! * n[0]! + m[3]! * n[1]!,
  m[0]! * n[2]! + m[2]! * n[3]!,
  m[1]! * n[2]! + m[3]! * n[3]!,
  m[0]! * n[4]! + m[2]! * n[5]! + m[4]!,
  m[1]! * n[4]! + m[3]! * n[5]! + m[5]!,
];

/**
 * Where the quotes sit on one page: the text pieces pdf.js reports are joined, a quote is found in
 * them the same way as `findQuotePage` (letters and digits only), and every piece it covers gives a
 * box, cut to the share of its letters inside the quote. A quote that is not found gives nothing.
 */
export function quoteBoxes(
  items: TextBit[],
  vp: { transform: number[]; width: number; height: number },
  quotes: string[],
): Box[] {
  const starts: number[] = [];
  let all = '';
  for (const it of items) {
    starts.push(all.length);
    all += squash(it.str);
  }
  const out: Box[] = [];
  for (const q of quotes) {
    const needle = squash(q);
    if (needle.length < 4) continue;
    let s = all.indexOf(needle);
    let e = s + needle.length;
    if (s < 0) {
      // Long quotes are often reworded towards the end: mark the longest start that is on the page.
      if (needle.length < 12 || !all.includes(needle.slice(0, 12))) continue;
      let lo = 12;
      let hi = needle.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (all.includes(needle.slice(0, mid))) lo = mid;
        else hi = mid - 1;
      }
      s = all.indexOf(needle.slice(0, lo));
      e = s + lo;
    }
    items.forEach((it, i) => {
      const a = starts[i]!;
      const len = squash(it.str).length;
      const b = a + len;
      if (!len || b <= s || a >= e || it.transform.length < 6) return;
      const from = (Math.max(s, a) - a) / len;
      const to = (Math.min(e, b) - a) / len;
      const m = mul(vp.transform, it.transform);
      const size = Math.hypot(m[2]!, m[3]!);
      const scale = Math.hypot(vp.transform[0]!, vp.transform[1]!);
      const w = it.width * scale;
      out.push({
        x: (m[4]! + w * from) / vp.width,
        y: (m[5]! - size * 0.95) / vp.height,
        w: (w * (to - from)) / vp.width,
        h: (size * 1.25) / vp.height,
      });
    });
  }
  return out;
}
