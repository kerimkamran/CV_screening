import { describe, expect, it } from 'vitest';
import { quoteBoxes, squash } from './pdf-marks';

// A page 600 x 800 at scale 1; pdf.js puts the origin bottom-left, the viewport flips it.
const vp = { transform: [1, 0, 0, -1, 0, 800], width: 600, height: 800 };
const bit = (str: string, x: number, y: number, width: number, size = 10) => ({
  str,
  transform: [size, 0, 0, size, x, y],
  width,
});

describe('marks on a PDF page', () => {
  const items = [
    bit('Redesigned the IP core with BGP route', 100, 700, 200),
    bit('reflectors and OSPF areas.', 100, 686, 130),
    bit('Education: ADA University', 100, 600, 120),
  ];

  it('marks a quote that runs over a line break, cut to the letters it covers', () => {
    const boxes = quoteBoxes(items, vp, ['BGP route reflectors']);
    expect(boxes).toHaveLength(2);
    const [a, b] = boxes;
    // The first line: from "BGP" to the end of the piece.
    expect(a!.x * 600).toBeGreaterThan(100 + 200 * 0.6);
    expect((a!.x + a!.w) * 600).toBeCloseTo(300, 0);
    // Top-down: the box sits just above the baseline (800 - 700 = 100 from the top).
    expect(a!.y * 800).toBeCloseTo(100 - 9.5, 1);
    // The second line: only "reflectors".
    expect(b!.x * 600).toBeCloseTo(100, 0);
    expect(b!.w * 600).toBeLessThan(130 * 0.6);
  });

  it('ignores case, spaces and punctuation, and finds nothing for a quote that is not there', () => {
    expect(quoteBoxes(items, vp, ['education — ada university'])).toHaveLength(1);
    expect(quoteBoxes(items, vp, ['CCIE certification'])).toEqual([]);
    expect(quoteBoxes(items, vp, ['ab'])).toEqual([]); // too short to mean anything
  });

  it('falls back to the start of a long quote the model reworded at the end', () => {
    const boxes = quoteBoxes(items, vp, [
      'Redesigned the IP core with BGP route reflectors, communities and RPKI',
    ]);
    expect(boxes.length).toBeGreaterThan(0);
  });

  it('keeps Azerbaijani and Russian letters when it compares', () => {
    expect(squash('Məmmədova, Bakı — Русский')).toBe('məmmədovabakıрусский');
  });
});

describe('evidence map spots', () => {
  it('places each found quote as a share of the whole CV', async () => {
    const { spotsOnPage } = await import('./pdf-marks');
    const vp = { transform: [1, 0, 0, -1, 0, 800], width: 600, height: 800 };
    const items = [
      {
        str: 'Redesigned the IP core with BGP route',
        transform: [10, 0, 0, 10, 100, 400],
        width: 200,
      },
    ];
    const spots = spotsOnPage(
      items,
      vp,
      [
        { id: 'R1', quotes: ['BGP route'] },
        { id: 'R2', quotes: ['CCIE'] },
      ],
      2,
      4,
    );
    expect(spots).toHaveLength(1);
    expect(spots[0]!.id).toBe('R1');
    expect(spots[0]!.page).toBe(2);
    // Page 2 of 4, about half-way down the page.
    expect(spots[0]!.at).toBeGreaterThan(0.36);
    expect(spots[0]!.at).toBeLessThan(0.39);
  });
});
