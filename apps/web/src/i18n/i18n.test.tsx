import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Login } from '../pages/Login';
import { applyLang, getLang, tr } from './index';
import { AZ } from './az';

const SRC = join(process.cwd(), 'src');
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory()
      ? files(p)
      : /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) && !p.includes('/i18n/')
        ? [p]
        : [];
  });

const CALL = /\b(?:t|tr)\(\s*(['"])((?:\\.|(?!\1).)*)\1/gs;
const unescape = (s: string) => s.replace(/\\(['"\\])/g, '$1').replace(/\\n/g, '\n');
const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

afterEach(() => applyLang('en'));

describe('Azerbaijani interface', () => {
  it('has an entry for every sentence the pages translate', () => {
    const missing: string[] = [];
    for (const f of files(SRC)) {
      for (const m of readFileSync(f, 'utf8').matchAll(CALL)) {
        const en = unescape(m[2]!);
        if (!(en in AZ)) missing.push(`${f.replace(SRC, '')}: ${en}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('keeps every {placeholder} and never leaves a translation empty', () => {
    for (const [en, az] of Object.entries(AZ)) {
      expect(az.trim(), en).not.toBe('');
      expect(holes(az), en).toEqual(holes(en));
    }
  });

  it('shows English by default and Azerbaijani when chosen, and falls back to English', () => {
    expect(getLang()).toBe('en');
    expect(tr('Sign in')).toBe('Sign in');
    applyLang('az');
    expect(tr('Sign in')).toBe('Daxil olun');
    expect(tr('{name}, xoş', { name: 'x' })).toBe('{name}, xoş'.replace('{name}', 'x'));
    expect(tr('A sentence nobody translated')).toBe('A sentence nobody translated');
    expect(document.documentElement.lang).toBe('az');
  });

  it('re-renders a screen when the language changes', () => {
    render(<Login onSignedIn={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    act(() => applyLang('az'));
    expect(screen.getByRole('button', { name: 'Daxil olun' })).toBeInTheDocument();
    expect(screen.getByText('E-poçt')).toBeInTheDocument();
  });
});
