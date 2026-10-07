import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Accessibility audit (design spec 7.1): every text and control colour pair, on each of the four
 * page backgrounds, is measured from the real stylesheet. Text needs 4.5:1; focus rings and
 * control edges need 3:1 (WCAG 2.1 AA).
 */
const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

function block(selector: string): Record<string, string> {
  const i = css.indexOf(`${selector} {`);
  if (i < 0) throw new Error(`no block ${selector}`);
  const body = css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i));
  return Object.fromEntries(
    [...body.matchAll(/--c-([\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]),
  );
}
const base = block(':root');
const THEMES: Record<string, Record<string, string>> = {
  white: { ...base, ...block(":root[data-bg='white']") },
  grey: { ...base, ...block(":root[data-bg='grey']") },
  sky: { ...base, ...block(":root[data-bg='sky']") },
  dark: { ...base, ...block(":root[data-bg='dark']") },
};

type RGB = [number, number, number];
function parse(v: string, under: RGB): RGB {
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1]!.slice(i, i + 2), 16)) as RGB;
  const rgba = /^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)$/.exec(v);
  if (rgba) {
    const a = Number(rgba[4]);
    return [1, 2, 3].map((i, k) => Math.round(Number(rgba[i]) * a + under[k]! * (1 - a))) as RGB;
  }
  throw new Error(`cannot read ${v}`);
}
const lum = ([r, g, b]: RGB) => {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a: RGB, b: RGB) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

const TEXT_ON_SURFACE: [string, string[]][] = [
  ['ink', ['bg', 'card', 'sel', 'hover']],
  ['ink-2', ['bg', 'card', 'sel', 'hover']],
  ['ink-3', ['bg', 'card', 'sel', 'hover']],
  ['link', ['bg', 'card', 'sel']],
  ['ok-text', ['bg', 'card']],
  ['warn-text', ['bg', 'card']],
];
const PAIRS: [string, string][] = [
  ['on-accent', 'accent'],
  ['on-accent', 'accent-hover'],
  ['on-accent', 'danger'],
  ['on-accent', 'danger-hover'],
  ['tag-ink', 'tag'],
  ['info-ink', 'info'],
  ['ok-ink', 'ok'],
  ['warn-ink', 'warn'],
  ['err-ink', 'err'],
];

describe.each(Object.entries(THEMES))('contrast on the %s background', (_name, t) => {
  const bg = parse(t.bg!, [255, 255, 255]);
  const colour = (k: string, under: RGB = bg) => parse(t[k]!, under);

  it.each(TEXT_ON_SURFACE.flatMap(([fg, on]) => on.map((s) => [fg, s] as const)))(
    'text %s on %s is at least 4.5:1',
    (fg, surface) => {
      const s = colour(surface);
      expect(ratio(colour(fg, s), s)).toBeGreaterThanOrEqual(4.5);
    },
  );
  it.each(PAIRS)('%s on %s is at least 4.5:1', (fg, surface) => {
    expect(ratio(colour(fg, colour(surface)), colour(surface))).toBeGreaterThanOrEqual(4.5);
  });
  it.each(['bg', 'card'])('keyboard focus ring is at least 3:1 against %s', (surface) => {
    expect(ratio(colour('focus'), colour(surface))).toBeGreaterThanOrEqual(3);
  });
  it.each(['bg', 'card'])('control edge is at least 3:1 against %s', (surface) => {
    const s = colour(surface);
    expect(ratio(colour('edge', s), s)).toBeGreaterThanOrEqual(3);
  });
});
