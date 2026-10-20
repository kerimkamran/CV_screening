import { readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mayMove, navDirection, transition } from './motion';
import { ScoreDial } from './ScoreDial';

const media = (noPreference: boolean) =>
  vi.stubGlobal(
    'matchMedia',
    vi.fn((q: string) => ({
      matches: q.includes('no-preference') ? noPreference : !noPreference,
      media: q,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })),
  );

afterEach(() => {
  vi.unstubAllGlobals();
  delete (document as { startViewTransition?: unknown }).startViewTransition;
  delete document.documentElement.dataset.nav;
});

describe('parallax motion', () => {
  it('stays still when the browser cannot say, or when the person asked for reduced motion', () => {
    expect(mayMove()).toBe(false); // the test browser has no matchMedia
    media(false);
    expect(mayMove()).toBe(false);
    media(true);
    expect(mayMove()).toBe(true);
  });

  it('changes the screen at once without View Transitions or with reduced motion', () => {
    const start = vi.fn();
    (document as { startViewTransition?: unknown }).startViewTransition = start;
    media(false);
    const apply = vi.fn();
    transition(apply);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
  });

  it('slides to the next CV inside a View Transition when motion is allowed', async () => {
    media(true);
    let done!: () => void;
    const finished = new Promise<void>((r) => (done = r));
    const start = vi.fn((cb: () => void) => {
      cb();
      return { finished };
    });
    (document as { startViewTransition?: unknown }).startViewTransition = start;
    const apply = vi.fn();
    navDirection('next');
    transition(apply);
    expect(start).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(document.documentElement.dataset.nav).toBe('next');
    done();
    await finished;
    await Promise.resolve();
    expect(document.documentElement.dataset.nav).toBeUndefined();
    // The direction is used once: the next change is a plain fade.
    transition(apply);
    expect(document.documentElement.dataset.nav).toBeUndefined();
  });

  it('shows the score dial with its final value and one label for screen readers', () => {
    render(<ScoreDial score={87.6} label="Match 88%" />);
    const dial = screen.getByRole('img', { name: 'Match 88%' });
    expect(dial).toHaveTextContent('88%');
    expect(dial.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('animates only inside "no-preference": with reduced motion nothing in motion.css moves', () => {
    const css = readFileSync('src/motion.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    // Walk the braces and remember which at-rules each declaration sits in.
    const stack: string[] = [];
    let head = '';
    const offending: string[] = [];
    for (const ch of css) {
      if (ch === '{') {
        stack.push(head.trim());
        head = '';
      } else if (ch === '}') {
        stack.pop();
        head = '';
      } else if (ch === ';') {
        const decl = head.trim();
        head = '';
        if (!/^animation(-name)?\s*:/.test(decl) || /:\s*none/.test(decl)) continue;
        const inKeyframes = stack.some((s) => s.startsWith('@keyframes'));
        const allowed = stack.some((s) => s.includes('prefers-reduced-motion: no-preference'));
        if (!inKeyframes && !allowed) offending.push(`${stack.join(' > ')} :: ${decl}`);
      } else head += ch;
    }
    expect(offending).toEqual([]);
  });
});
