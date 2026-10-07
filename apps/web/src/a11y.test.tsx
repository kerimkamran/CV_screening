import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { session } from './api';
import { nextStar } from './results-logic';
import { Results } from './pages/Results';
import { AssistantPanel } from './pages/AssistantPanel';
import { rememberUser, setAssistantOpen } from './assistant';

describe('star map keys (spec 7.1)', () => {
  it('arrows follow the ranking and stop at the ends; Home and End jump', () => {
    expect(nextStar('ArrowRight', 0, 4)).toBe(1);
    expect(nextStar('ArrowDown', 3, 4)).toBe(3);
    expect(nextStar('ArrowLeft', 2, 4)).toBe(1);
    expect(nextStar('ArrowUp', 0, 4)).toBe(0);
    expect(nextStar('Home', 2, 4)).toBe(0);
    expect(nextStar('End', 0, 4)).toBe(3);
    expect(nextStar('a', 0, 4)).toBeNull();
    expect(nextStar('ArrowRight', 0, 0)).toBeNull();
  });
});

const cand = (n: number, score: number) => ({
  screeningId: `S${n}`,
  documentId: `D${n}`,
  filename: `cv${n}.pdf`,
  uploadedAt: `2026-10-01T10:00:0${n}Z`,
  parseStatus: 'parsed',
  erased: false,
  state: 'completed',
  candidateName: `Real Name ${n}`,
  band: 'possible_match',
  score: {
    value: score,
    breakdown: {
      formula: 'f',
      earned: 1,
      possible: 2,
      mandatoryGaps: 0,
      items: [
        {
          requirementId: 'R1',
          text: 'Routing',
          classification: 'mandatory',
          weight: 10,
          status: 'met',
          points: 1,
          earned: 1,
        },
      ],
    },
  },
  knockoutTriggered: false,
  injectionSuspected: false,
  error: null,
  decision: null,
});

beforeEach(() => {
  session.set('t');
  localStorage.clear();
  rememberUser('U1');
  setAssistantOpen(false);
});
afterEach(() => vi.unstubAllGlobals());

function stubApi(extra: (url: string) => unknown = () => undefined) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const x = extra(url);
      const body =
        x !== undefined
          ? x
          : url.endsWith('/vacancies/V/candidates')
            ? {
                counts: { total: 3, queued: 0, failed: 0, manual: 0, undecided: 3 },
                aiActive: true,
                candidates: [cand(1, 82), cand(2, 74), cand(3, 66)],
              }
            : url.includes('/screenings/')
              ? { summary: null, assessments: [] }
              : url.includes('/revealed')
                ? { screeningIds: [] }
                : {};
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}

describe('star map in the browser', () => {
  it('has 44px targets, a spoken summary, and arrow keys that move focus along the ranking', async () => {
    stubApi();
    render(<Results vacancyId="V" onTable={() => undefined} />);
    const section = await screen.findByRole('region', { name: 'Star map' });
    const stars = within(section).getAllByRole('button', { name: /Candidate 0\d, / });
    expect(stars).toHaveLength(3);
    for (const s of stars) expect(s.className).toContain('h-11 w-11');
    const summary = document.getElementById('star-summary')!;
    expect(summary).toHaveTextContent('3 stars, best first');
    expect(summary).toHaveTextContent('Use the arrow keys');
    expect(section).toHaveAttribute('aria-describedby', 'star-summary');
    stars[0]!.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(stars[1]).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(stars[2]).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}{Home}');
    expect(stars[0]).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(stars[0]).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('assistant panel accessibility', () => {
  it('is a labelled landmark with a labelled input, reachable by keyboard, and closes with Escape', async () => {
    stubApi(() => ({ thread: null }));
    setAssistantOpen(false);
    render(
      <AssistantPanel
        config={{
          enabled: true,
          name: 'Elon',
          features: { challenge: true, compare: true, interview: true, challengeRecruiter: true },
          unavailableMessage: 'x',
        }}
        target={{ screeningId: '0000000000000000000000SC01', label: 'Candidate 07', band: 'good' }}
        others={[]}
        onEditRequirement={() => undefined}
      />,
    );
    const rail = screen.getByRole('button', { name: 'Ask Elon' });
    rail.focus();
    await userEvent.keyboard('{Enter}');
    const panel = await screen.findByRole('complementary', { name: 'Assistant' });
    expect(
      within(panel).getByRole('textbox', { name: /Ask Elon about Candidate 07/ }),
    ).toBeInTheDocument();
    // Every control in the panel has an accessible name.
    for (const b of within(panel).getAllByRole('button'))
      expect((b.textContent ?? '').trim() || b.getAttribute('aria-label')).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('complementary', { name: 'Assistant' })).toBeNull();
  });
});

describe('document language', () => {
  it('declares the page language so screen readers pick the right voice', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    expect(html).toMatch(/<html lang="en"/);
    expect(html).toMatch(/name="viewport"/);
    expect(html).not.toMatch(/user-scalable=no|maximum-scale=1\b/);
  });
});
