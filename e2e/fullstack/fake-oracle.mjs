// Stage 3 (plan 18.2): loads THE fake Oracle (apps/api/src/testing/fake-oracle.ts) for the browser
// test stack and the gate launcher. src/testing is left out of dist, so the one source file is
// compiled here in memory with the `typescript` package: there is no second copy to drift, and no
// test code in dist, the production image or the web bundle.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(join(root, 'package.json'));

export function loadFakeOracle() {
  const ts = require('typescript');
  const file = join(root, 'apps/api/src/testing/fake-oracle.ts');
  const out = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  }).outputText;
  const mod = { exports: {} };
  const local = createRequire(file);
  new Function('exports', 'require', 'module', '__filename', '__dirname', out)(
    mod.exports,
    local,
    mod,
    file,
    dirname(file),
  );
  return mod.exports;
}
