import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';
import { AZ } from './az';
import { applyLang } from './index';
import { SERVER_TEMPLATES, trServer } from './server';

/**
 * I18-05: every sentence the service can send to a person has an Azerbaijani text. The test reads
 * the service's own source (apps/api/src), finds each message thrown to the caller, and checks it
 * is either in the dictionary or covered by a template in server.ts.
 */
const API = join(process.cwd(), '..', 'api', 'src');
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory()
      ? files(p)
      : /\.ts$/.test(f) && !/\.(spec|test)\.ts$/.test(f)
        ? [p]
        : [];
  });

const HOLE = '{}';
const skeleton = (s: string) => s.replace(/\{\w+\}/g, HOLE);

/** Which properties of the service's source are sentences a person reads (see `collect`). */
function SENT_AS_DATA(rel: string, key: string, owner?: ts.ObjectLiteralExpression): boolean {
  const has = (k: string) => owner?.properties.some((p) => p.name?.getText() === k) ?? false;
  if (rel === 'ai/catalog.ts')
    return (
      ['keyHelp', 'dataNote', 'hint', 'note'].includes(key) ||
      (key === 'label' && (has('value') || has('required')))
    );
  if (rel === 'monitoring/paired.ts') return key === 'label' || key === 'change';
  if (rel === 'pipeline/document-review.controller.ts') return key === 'reason';
  if (rel === 'pipeline/intake.service.ts') return key === 'parseError';
  if (rel === 'ai/ai-admin.controller.ts') return key === 'error';
  if (rel === 'assistant/assistant-admin.controller.ts') return key === 'detail';
  // Stage 3: the Oracle refusals are one table of { status, message } (refuse() passes them on).
  if (rel === 'integrations/oracle/oracle-refusals.ts') return key === 'message';
  return false;
}

type Found = { text: string; dynamic: boolean; file: string };

/** The text of a message expression: a literal, a template, a constant of the same file, either branch of a `?:`. */
function texts(
  n: ts.Node | undefined,
  consts: Map<string, ts.Expression>,
  seen = new Set<string>(),
): { text: string; dynamic: boolean }[] | null {
  if (!n) return null;
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n))
    return [{ text: n.text, dynamic: false }];
  if (ts.isTemplateExpression(n)) {
    const parts = [n.head.text, ...n.templateSpans.map((s) => HOLE + s.literal.text)];
    return [{ text: parts.join(''), dynamic: true }];
  }
  if (ts.isParenthesizedExpression(n)) return texts(n.expression, consts, seen);
  if (ts.isConditionalExpression(n)) {
    const a = texts(n.whenTrue, consts, seen);
    const b = texts(n.whenFalse, consts, seen);
    return a && b ? [...a, ...b] : null;
  }
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const a = texts(n.left, consts, seen);
    const b = texts(n.right, consts, seen);
    if (a?.length === 1 && b?.length === 1)
      return [{ text: a[0]!.text + b[0]!.text, dynamic: a[0]!.dynamic || b[0]!.dynamic }];
    // Something we cannot read, then a sentence: `${message}` + '. Showing the documented models'.
    if (!a && b?.length === 1 && !b[0]!.dynamic)
      return [{ text: HOLE + b[0]!.text, dynamic: true }];
    return null;
  }
  if (ts.isIdentifier(n) && consts.has(n.text) && !seen.has(n.text))
    return texts(consts.get(n.text), consts, new Set(seen).add(n.text));
  return null;
}

function collect(): { found: Found[]; unknown: string[] } {
  const found: Found[] = [];
  const unknown: string[] = [];
  for (const f of files(API)) {
    const rel = f.slice(API.length + 1);
    const sf = ts.createSourceFile(f, readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true);
    const consts = new Map<string, ts.Expression>();
    for (const st of sf.statements)
      if (ts.isVariableStatement(st))
        for (const d of st.declarationList.declarations)
          if (ts.isIdentifier(d.name) && d.initializer) consts.set(d.name.text, d.initializer);
    const visit = (n: ts.Node) => {
      // Sentences sent as data, not thrown: option labels and notes of the AI companies, the
      // paired-test variants, why a CV needs a person, why a file could not be read, test results.
      let key: string | undefined;
      let init: ts.Node | undefined;
      let owner: ts.ObjectLiteralExpression | undefined;
      if (ts.isPropertyAssignment(n) && ts.isObjectLiteralExpression(n.parent)) {
        key = n.name.getText();
        init = n.initializer;
        owner = n.parent;
      } else if (
        ts.isBinaryExpression(n) &&
        n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(n.left)
      ) {
        key = n.left.text;
        init = n.right;
      }
      if (key && init && SENT_AS_DATA(rel, key, owner)) {
        const t = texts(init as ts.Expression, consts);
        if (t) for (const x of t) found.push({ ...x, file: rel });
      }
      // A subclass of an Exception that writes its own sentence: `super({ message: ..., code })`.
      if (
        ts.isCallExpression(n) &&
        n.expression.kind === ts.SyntaxKind.SuperKeyword &&
        ts
          .findAncestor(n, ts.isClassDeclaration)
          ?.heritageClauses?.some((h) => /Exception/.test(h.getText()))
      ) {
        const arg = n.arguments[0];
        let expr: ts.Node | undefined = arg;
        if (arg && ts.isObjectLiteralExpression(arg)) {
          const p = arg.properties.find((x) => x.name?.getText() === 'message');
          expr = p && ts.isPropertyAssignment(p) ? p.initializer : undefined;
        }
        const t = texts(expr as ts.Expression | undefined, consts);
        if (t) for (const x of t) found.push({ ...x, file: rel });
        else if (arg) unknown.push(`${rel}: ${arg.getText().slice(0, 60)}`);
      }
      if (ts.isNewExpression(n)) {
        const cls = n.expression.getText();
        const args = n.arguments ?? [];
        let arg: ts.Node | undefined;
        if (/Exception$/.test(cls) || cls === 'VacancyFileProblem' || cls === 'ProviderError')
          arg = args[0];
        else if (cls === 'LinkProblem' && args[0]?.getText() === "'invalid'") arg = args[1];
        else if (cls === 'Error' && rel === 'ai/catalog.ts') arg = args[0];
        if (arg) {
          let expr: ts.Node | undefined = arg;
          if (ts.isObjectLiteralExpression(arg)) {
            const p = arg.properties.find((x) => x.name?.getText() === 'message');
            expr = p && ts.isPropertyAssignment(p) ? p.initializer : undefined;
          }
          const t = texts(expr as ts.Expression | undefined, consts);
          if (t) for (const x of t) found.push({ ...x, file: rel });
          else unknown.push(`${rel}: ${arg.getText().slice(0, 60)}`);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return { found, unknown };
}

/** Rules `passwordProblem` can return; the service says "New password <rule>". */
const passwordRules = () =>
  [...readFileSync(join(API, 'auth', 'password.ts'), 'utf8').matchAll(/return '([^']+)';/g)].map(
    (m) => m[1]!,
  );

/** Not shown to a person: the load balancer's health probe. */
// The fake Oracle (testing/) is test code that never reaches a person: compiled only for specs and
// the browser-test stack, and left out of dist by tsconfig.build.json.
const NOT_SHOWN = ['health/health.controller.ts', 'testing/fake-oracle.ts'];
/** Messages passed on from another call, whose own sources are listed above. */
const PASSED_ON = [
  '(e as Error).message',
  'e.message',
  // refuse(): the sentence comes from the REFUSAL table, read above as data.
  'integrations/oracle/oracle-refusals.ts: { message, code, ...extra }',
];

describe('server messages (I18-05)', () => {
  afterEach(() => applyLang('en'));
  const { found, unknown } = collect();

  it('reads the service source', () => {
    expect(found.length).toBeGreaterThan(100);
  });

  it('has an Azerbaijani text for every fixed message the service sends', () => {
    const missing = [
      ...new Set(
        found
          .filter((m) => !m.dynamic && !NOT_SHOWN.includes(m.file))
          .map((m) => m.text)
          .filter((t) => !(t in AZ)),
      ),
    ];
    expect(missing).toEqual([]);
  });

  it('has a template for every message with a name or number in it', () => {
    const have = new Set(SERVER_TEMPLATES.map((t) => skeleton(t.en)));
    const rules = new Set(passwordRules().map((r) => `New password ${r}`));
    const lacking = [
      ...new Set(
        found
          .filter((m) => m.dynamic)
          .map((m) => m.text)
          .filter((t) => t !== `New password ${HOLE}` && !have.has(t)),
      ),
    ];
    expect(lacking).toEqual([]);
    expect([...rules].filter((r) => !(r in AZ))).toEqual([]);
    expect(found.some((m) => m.text === `New password ${HOLE}`)).toBe(true);
  });

  it('knows where every message it cannot read comes from', () => {
    const odd = unknown.filter(
      (u) => !PASSED_ON.some((p) => u.includes(p)) && !u.startsWith('health/'),
    );
    expect(odd).toEqual([]);
  });

  it('keeps each template and its Azerbaijani text with the same holes', () => {
    for (const t of SERVER_TEMPLATES) {
      expect(t.en in AZ, t.en).toBe(true);
      const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
      expect(holes(AZ[t.en]!), t.en).toEqual(holes(t.en));
    }
  });

  it('fills the holes of a template in either language', () => {
    expect(trServer('Up to 500 CVs per download.')).toBe('Up to 500 CVs per download.');
    applyLang('az');
    expect(trServer('Up to 500 CVs per download.')).toBe(
      AZ['Up to {max} CVs per download.']!.replace('{max}', '500'),
    );
    expect(trServer('Changed by Leyla at 14:05. Reload to see their version.')).toContain('Leyla');
    expect(trServer('Changed by Leyla at 14:05. Reload to see their version.')).toContain('14:05');
    expect(trServer('Google: provider responded 503')).toContain('Google');
    expect(trServer('Google: provider responded 503')).not.toMatch(/provider responded/);
    expect(trServer('Nothing to update')).toBe(AZ['Nothing to update']);
    expect(trServer('A sentence nobody wrote')).toBe('A sentence nobody wrote');
  });
});
