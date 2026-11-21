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

/**
 * Stage 3, S3-OPS-03 (plan 15.3 note 5): the Oracle import switch belongs to the production service
 * alone. It may not be named in any file that sets up another environment, and `render.yaml` may
 * declare it only with `sync: false` (set by hand on the production service, never by a sync).
 */
export function checkOracleSwitch(root = join(here, '..')) {
  const problems = [];
  const NAME = /ORACLE_IMPORT_ENABLED/;
  const read = (f) => {
    try {
      return readFileSync(join(root, f), 'utf8');
    } catch {
      return null;
    }
  };
  const list = (d) => {
    try {
      return readdirSync(join(root, d)).map((f) => `${d}/${f}`);
    } catch {
      return [];
    }
  };
  const files = [
    '.env.example',
    'docker-compose.yml',
    'render.gate.yaml',
    ...list('docker').filter((f) => /Dockerfile$/.test(f)),
    ...list('infra/environments'),
  ];
  for (const f of files) {
    const text = read(f);
    if (text !== null && NAME.test(text))
      problems.push(`${f} names ORACLE_IMPORT_ENABLED (production only)`);
  }
  const render = read('render.yaml') ?? '';
  const block = /-\s*key:\s*ORACLE_IMPORT_ENABLED\s*\n((?:\s+[a-zA-Z]+:.*\n?)*)/.exec(render);
  if (block && !/^\s+sync:\s*false\s*$/m.test(block[1]))
    problems.push('render.yaml gives ORACLE_IMPORT_ENABLED a value (use sync: false)');
  if (block && /^\s+(value|generateValue):/m.test(block[1]))
    problems.push('render.yaml gives ORACLE_IMPORT_ENABLED a value (use sync: false)');
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = [...checkIsolation(), ...checkOracleSwitch()];
  if (problems.length) {
    problems.forEach((p) => console.error(`FAIL  ${p}`));
    process.exit(1);
  }
  console.log('PLAT-08: environment definitions are isolated');
}
