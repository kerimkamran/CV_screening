import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Login } from '../pages/Login';
import { applyLang, getLang, tr } from './index';
import { CV_STATUS_LABEL, UPLOAD_CODE_MESSAGE } from '@cv/shared';
import { AZ } from './az';
import { AZ_ASSISTANT } from './az.assistant';
import { AZ_HOME } from './az.home';
import { AZ_MONITORING } from './az.monitoring';
import { AZ_POOL } from './az.pool';
import { AZ_REPORT } from './az.report';
import { AZ_RESULTS } from './az.results';
import { AZ_SHELL } from './az.shell';
import { AZ_STAGE2 } from './az.stage2';

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

  it('also covers the sentences passed to plural()', () => {
    const PLURAL =
      /\bplural\(\s*[^'"`]*?,\s*(['"])((?:\\.|(?!\1).)*)\1\s*,\s*(['"])((?:\\.|(?!\3).)*)\3/gs;
    const missing: string[] = [];
    for (const f of files(SRC)) {
      for (const m of readFileSync(f, 'utf8').matchAll(PLURAL)) {
        for (const en of [unescape(m[2]!), unescape(m[4]!)]) {
          if (!(en in AZ)) missing.push(`${f.replace(SRC, '')}: ${en}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('says "CV", never "resume", in every sentence on screen (Stage 2, S2-FE1)', () => {
    const left: string[] = [];
    for (const f of files(SRC)) {
      for (const m of readFileSync(f, 'utf8').matchAll(CALL)) {
        if (/\bresumes?\b/i.test(m[2]!)) left.push(`${f.replace(SRC, '')}: ${m[2]}`);
      }
    }
    for (const [en, az] of Object.entries(AZ))
      if (/\bresumes?\b/i.test(en) || /rez[yü]u?me/i.test(az)) left.push(`az: ${en} = ${az}`);
    expect(left).toEqual([]);
  });

  it('never gives one sentence two different Azerbaijani texts in two files', () => {
    const seen = new Map<string, { az: string; file: string }>();
    const conflicts: string[] = [];
    const parts: [string, Record<string, string>][] = [
      ['pool', AZ_POOL],
      ['shell', AZ_SHELL],
      ['home', AZ_HOME],
      ['results', AZ_RESULTS],
      ['report', AZ_REPORT],
      ['assistant', AZ_ASSISTANT],
      ['monitoring', AZ_MONITORING],
      ['stage2', AZ_STAGE2],
    ];
    for (const [file, dict] of parts) {
      for (const [en, az] of Object.entries(dict)) {
        const prev = seen.get(en);
        if (prev && prev.az !== az)
          conflicts.push(`${en}: ${prev.file}="${prev.az}" vs ${file}="${az}"`);
        else seen.set(en, { az, file });
      }
    }
    expect(conflicts).toEqual([]);
  });

  it('has an Azerbaijani text for every CV status label and upload message', () => {
    const missing = [
      ...Object.values(CV_STATUS_LABEL),
      ...Object.values(UPLOAD_CODE_MESSAGE),
    ].filter((en) => !(en in AZ));
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
