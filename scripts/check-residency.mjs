#!/usr/bin/env node
// PLAT-09: CI asserts data residency — no resource may be declared outside the approved EU regions.
//   node scripts/check-residency.mjs --hcl infra/terraform      static scan of .tf files (no cloud creds needed)
//   node scripts/check-residency.mjs --plan plan.json            scan `terraform show -json` output (deploy pipeline)
// On violation it names the offending resource and its region, and exits non-zero.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const ALLOWLIST = JSON.parse(
  readFileSync(join(here, '..', 'infra', 'residency-allowlist.json'), 'utf8'),
);
const allowed = new Set(ALLOWLIST.allowedRegions.map((r) => r.toLowerCase()));
const exempt = new Set(ALLOWLIST.globalResourceTypes);

const normalize = (v) =>
  String(v)
    .toLowerCase()
    .replace(/[\s_-]/g, '');
const allowedNorm = new Set([...allowed].map(normalize));
export const isAllowed = (region) => allowedNorm.has(normalize(region));

/** Static scan: every literal `location = "..."` in .tf must be allowed; var.location must be validated. */
export function scanHcl(dir) {
  const violations = [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.tf'));
  let locationVarValidated = false;
  for (const f of files) {
    const text = readFileSync(join(dir, f), 'utf8');
    const lines = text.split('\n');
    let current = '';
    lines.forEach((line, i) => {
      const res = /^\s*resource\s+"([^"]+)"\s+"([^"]+)"/.exec(line);
      if (res) current = `${res[1]}.${res[2]}`;
      const lit = /^\s*(?:location|region)\s*=\s*"([^"]+)"/.exec(line);
      if (lit && !isAllowed(lit[1]) && !exempt.has(current.split('.')[0])) {
        violations.push({
          resource: current || '(top level)',
          region: lit[1],
          where: `${f}:${i + 1}`,
        });
      }
    });
    if (/variable\s+"location"[\s\S]*?validation\s*\{/.test(text)) locationVarValidated = true;
  }
  if (files.length && !locationVarValidated) {
    violations.push({ resource: 'variable.location', region: '(unvalidated)', where: dir });
  }
  return violations;
}

/** Plan scan: inspects every planned resource's `location`/`region` after variable resolution. */
export function scanPlan(plan) {
  const violations = [];
  const visit = (mod) => {
    for (const r of mod?.resources ?? []) {
      if (exempt.has(r.type)) continue;
      const region = r.values?.location ?? r.values?.region;
      if (region !== undefined && region !== null && !isAllowed(region)) {
        violations.push({ resource: r.address, region: String(region), where: 'plan' });
      }
    }
    for (const child of mod?.child_modules ?? []) visit(child);
  };
  visit(plan?.planned_values?.root_module);
  return violations;
}

function report(violations) {
  if (!violations.length) {
    console.log(`PLAT-09: residency OK (allowed: ${ALLOWLIST.allowedRegions.join(', ')})`);
    return 0;
  }
  for (const v of violations)
    console.error(`FAIL  ${v.resource}  region="${v.region}"  (${v.where})`);
  console.error(
    `\nPLAT-09: ${violations.length} resource(s) outside approved regions: ${ALLOWLIST.allowedRegions.join(', ')}`,
  );
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, target] = process.argv.slice(2);
  try {
    if (mode === '--hcl') process.exit(report(scanHcl(target)));
    if (mode === '--plan') process.exit(report(scanPlan(JSON.parse(readFileSync(target, 'utf8')))));
    console.error('usage: check-residency.mjs --hcl <dir> | --plan <plan.json>');
    process.exit(2);
  } catch (err) {
    console.error(`cannot run residency check: ${err.message}`);
    process.exit(2);
  }
}
