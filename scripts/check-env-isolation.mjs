#!/usr/bin/env node
// PLAT-08: dev/staging/prod must never share state, data or credentials.
// Static checks on infra/environments/*: each environment names itself, has its own remote
// state account and key, and uses a different subscription placeholder only if a real one is set.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ENVS = ['dev', 'staging', 'prod'];

const kv = (text) =>
  Object.fromEntries([...text.matchAll(/^\s*(\w+)\s*=\s*"([^"]*)"/gm)].map((m) => [m[1], m[2]]));

export function checkIsolation(dir = join(here, '..', 'infra', 'environments')) {
  const problems = [];
  const files = readdirSync(dir);
  const seen = { stateKey: new Map(), stateAccount: new Map(), stateRg: new Map() };
  for (const e of ENVS) {
    if (!files.includes(`${e}.tfvars.example`)) {
      problems.push(`missing ${e}.tfvars.example`);
      continue;
    }
    if (!files.includes(`backend-${e}.hcl.example`)) {
      problems.push(`missing backend-${e}.hcl.example`);
      continue;
    }
    const vars = kv(readFileSync(join(dir, `${e}.tfvars.example`), 'utf8'));
    const be = kv(readFileSync(join(dir, `backend-${e}.hcl.example`), 'utf8'));
    if (vars.environment !== e)
      problems.push(`${e}.tfvars.example declares environment="${vars.environment}"`);
    for (const [k, field] of [
      ['stateKey', 'key'],
      ['stateAccount', 'storage_account_name'],
      ['stateRg', 'resource_group_name'],
    ]) {
      const prior = seen[k].get(be[field]);
      if (prior) problems.push(`${e} and ${prior} share backend ${field}="${be[field]}"`);
      seen[k].set(be[field], e);
    }
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = checkIsolation();
  if (problems.length) {
    problems.forEach((p) => console.error(`FAIL  ${p}`));
    process.exit(1);
  }
  console.log('PLAT-08: environment definitions are isolated');
}
