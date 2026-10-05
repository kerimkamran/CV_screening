#!/usr/bin/env node
// AISEC-01 / AC-13: CI scans the built browser bundle for model-provider key patterns and direct
// provider endpoints. Any match fails the build. The browser must only ever talk to our BFF.
//   node scripts/check-bundle-keys.mjs apps/web/dist
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORBIDDEN = [
  { name: 'Google API key', re: /AIza[0-9A-Za-z_-]{35}/ },
  { name: 'OpenAI-style secret key', re: /\bsk-(?:proj-|live-)?[A-Za-z0-9_-]{20,}/ },
  { name: 'Anthropic secret key', re: /\bsk-ant-[A-Za-z0-9_-]{10,}/ },
  {
    name: 'Azure OpenAI/AI Services key assignment',
    re: /(?:api[-_]?key|ocp-apim-subscription-key)["']?\s*[:=]\s*["'][0-9a-f]{32}["']/i,
  },
  {
    name: 'Gemini/provider key variable',
    re: /\b(?:GEMINI|OPENAI|ANTHROPIC|AZURE_OPENAI)_API_KEY\b/,
  },
  { name: 'Google GenAI SDK', re: /@google\/genai|generativelanguage\.googleapis\.com/ },
  {
    name: 'Direct provider endpoint',
    re: /api\.openai\.com|api\.anthropic\.com|\.openai\.azure\.com|\.cognitiveservices\.azure\.com|aiplatform\.googleapis\.com/,
  },
];

const TEXT_EXT = /\.(js|mjs|cjs|css|html|json|map|txt|svg)$/i;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else if (TEXT_EXT.test(entry)) yield p;
  }
}

export function scanDirectory(dir) {
  const findings = [];
  for (const file of walk(dir)) {
    const text = readFileSync(file, 'utf8');
    for (const { name, re } of FORBIDDEN) {
      const m = re.exec(text);
      // Report the rule and file only; never print the matched secret into CI logs.
      if (m) findings.push({ file, rule: name });
    }
  }
  return findings;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: check-bundle-keys.mjs <dist-dir>');
    process.exit(2);
  }
  let findings;
  try {
    findings = scanDirectory(dir);
  } catch (err) {
    console.error(`cannot scan ${dir}: ${err.message}`);
    process.exit(2);
  } // missing bundle = failure, not a pass
  if (findings.length) {
    for (const f of findings) console.error(`FAIL  ${f.rule}  in  ${f.file}`);
    console.error(
      `\nAISEC-01: ${findings.length} provider key/endpoint match(es) in the browser bundle.`,
    );
    process.exit(1);
  }
  console.log(`AISEC-01: bundle clean (${dir})`);
}
