#!/usr/bin/env node
// Keeps the Postgres enums and packages/shared/src/taxonomy.ts in lock-step.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export function sqlEnums(dir = join(here, '..', 'db', 'migrations')) {
  const out = new Map();
  for (const f of readdirSync(dir)
    .filter((x) => x.endsWith('.up.sql'))
    .sort()) {
    const sql = readFileSync(join(dir, f), 'utf8');
    for (const m of sql.matchAll(/CREATE TYPE (\w+)\s+AS ENUM \(([^)]*)\)/g)) {
      out.set(
        m[1],
        [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]),
      );
    }
  }
  return out;
}

export function tsConsts(file = join(here, '..', 'packages', 'shared', 'src', 'taxonomy.ts')) {
  const src = readFileSync(file, 'utf8');
  const out = new Map();
  for (const m of src.matchAll(/export const (\w+) = \[([^\]]*)\] as const/g)) {
    out.set(
      m[1],
      [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]),
    );
  }
  return out;
}

export const PAIRS = [
  ['requirement_class', 'REQUIREMENT_CLASSES'],
  ['confidence_level', 'CONFIDENCE_LEVELS'],
  ['screening_profile', 'SCREENING_PROFILES'],
  ['actor_kind', 'ACTOR_KINDS'],
  ['app_role', 'ROLES'],
  ['req_status', 'REQ_STATUSES'],
  ['parse_status', 'PARSE_STATUSES'],
  ['screening_state', 'SCREENING_STATES'],
  ['decision_outcome', 'DECISION_OUTCOMES'],
];

export function checkParity() {
  const sql = sqlEnums();
  const ts = tsConsts();
  return PAIRS.flatMap(([pg, name]) => {
    const a = sql.get(pg);
    const b = ts.get(name);
    if (!a) return [`SQL enum ${pg} not found`];
    if (!b) return [`TS const ${name} not found`];
    return JSON.stringify(a) === JSON.stringify(b)
      ? []
      : [`${pg} ${JSON.stringify(a)} != ${name} ${JSON.stringify(b)}`];
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = checkParity();
  if (problems.length) {
    problems.forEach((p) => console.error(`FAIL  ${p}`));
    process.exit(1);
  }
  console.log('taxonomy parity OK');
}
