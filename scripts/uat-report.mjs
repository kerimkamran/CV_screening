#!/usr/bin/env node
// UAT report: reads every Playwright JSON result under e2e/test-results/uat/, keeps the latest
// outcome per case and project, and writes it into docs/uat/e2e-test-cases.csv (columns Status,
// Run date, Evidence, Bug ID, Notes) plus docs/uat/e2e-results-summary.md.
//
//   node scripts/uat-report.mjs            write the CSV and the summary
//   node scripts/uat-report.mjs --check    print the totals only, change nothing
//
// A case is 'Pass' when every project that ran it passed (a pass on a retry counts and is noted),
// 'Fail' when the latest run of any project failed, 'Not run' when no result exists, and
// 'Blocked' for the real-AI cases (layer L3), which need the owner's own provider key.
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ANSI colour escapes that Playwright puts into error messages (built from the code point so the
// pattern holds no literal control character).
const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const resultsDir = join(root, 'e2e/test-results/uat');
const csvPath = join(root, 'docs/uat/e2e-test-cases.csv');
const summaryPath = join(root, 'docs/uat/e2e-results-summary.md');
const checkOnly = process.argv.includes('--check');

// --- CSV (RFC 4180, quoted fields with embedded commas, quotes and newlines) -------------------
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
const esc = (v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

// --- results -----------------------------------------------------------------------------------
const idRe = /^([A-Z][A-Z0-9]{1,3}-\d{2})\b/;
/** @type {Map<string, {status:string, at:string, file:string, retried:boolean, error:string}>} */
const latest = new Map();

function walk(suite, file) {
  for (const spec of suite.specs ?? []) {
    const m = idRe.exec(spec.title);
    if (!m) continue;
    for (const t of spec.tests ?? []) {
      const runs = (t.results ?? []).filter((r) => r.status !== 'skipped');
      if (!runs.length) continue;
      const last = runs[runs.length - 1];
      const status =
        t.status === 'flaky' ? 'passed' : last.status === 'passed' ? 'passed' : 'failed';
      // One case can have several tests (a second scenario): each title is judged on its own.
      // Older runs named the projects 'D-en', newer ones 'D-EN': one project, so the newest run wins.
      const project = t.projectName.replace(/-(en|az)$/i, (x) => x.toUpperCase());
      const key = `${m[1]}|${project}|${spec.title}`;
      const at = last.startTime ?? '';
      const prev = latest.get(key);
      if (prev && prev.at > at) continue;
      const msg = (last.error?.message ?? '').replace(ANSI, '').split('\n')[0];
      latest.set(key, {
        status,
        at,
        file,
        retried: runs.length > 1 && status === 'passed',
        error: status === 'failed' ? msg.slice(0, 160) : '',
      });
    }
  }
  for (const child of suite.suites ?? []) walk(child, file);
}

for (const name of readdirSync(resultsDir)) {
  if (!name.endsWith('.json') || name === 'accounts.json') continue;
  const path = join(resultsDir, name);
  if (!statSync(path).isFile()) continue;
  let data;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    continue;
  }
  if (!Array.isArray(data.suites)) continue;
  for (const s of data.suites) walk(s, name);
}

// --- merge into the case list ------------------------------------------------------------------
const rows = parseCsv(readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, ''));
const header = rows[0];
const col = Object.fromEntries(header.map((h, i) => [h, i]));
const body = rows.slice(1).filter((r) => r.length > 1 && r[col.ID]);

const bugs = existsSync(join(resultsDir, 'bugs.json'))
  ? JSON.parse(readFileSync(join(resultsDir, 'bugs.json'), 'utf8'))
  : {};

const tally = { Pass: 0, Fail: 0, 'Not run': 0, Blocked: 0 };
const byArea = new Map();
const byPriority = new Map();
const failing = [];
const notRun = [];

for (const r of body) {
  const id = r[col.ID];
  const keys = [...latest.keys()].filter((k) => k.startsWith(`${id}|`));
  const projects = [...new Set(keys.map((k) => k.split('|')[1]))];
  let status;
  let notes = '';
  let evidence = '';
  let runDate = '';
  if (r[col.Layer] === 'L3') {
    status = 'Blocked';
    notes = 'Real-AI case: needs the owner provider key; not run by Claude.';
  } else if (!projects.length) {
    status = 'Not run';
  } else {
    const res = keys.map((k) => ({ project: k.split('|')[1], ...latest.get(k) }));
    const bad = res.filter((x) => x.status === 'failed');
    status = bad.length ? 'Fail' : 'Pass';
    runDate =
      res
        .map((x) => x.at.slice(0, 10))
        .sort()
        .pop() ?? '';
    evidence = [...new Set(res.map((x) => x.file))].slice(0, 3).join('; ');
    const list = [...new Set(res.map((x) => x.project))].sort().join(' ');
    notes = `Projects run: ${list}.`;
    const retried = res.filter((x) => x.retried).map((x) => x.project);
    if (retried.length) notes += ` Passed on retry: ${retried.join(' ')}.`;
    if (bad.length) notes += ` Failing: ${bad.map((x) => `${x.project}: ${x.error}`).join(' | ')}`;
  }
  r[col.Status] = status;
  r[col['Run date']] = runDate;
  r[col.Evidence] = evidence;
  r[col['Bug ID']] = bugs[id] ?? r[col['Bug ID']] ?? '';
  r[col.Notes] = notes;
  tally[status]++;
  const area = r[col.Area];
  const a = byArea.get(area) ?? { Pass: 0, Fail: 0, 'Not run': 0, Blocked: 0 };
  a[status]++;
  byArea.set(area, a);
  const p = byPriority.get(r[col.Priority]) ?? { Pass: 0, Fail: 0, 'Not run': 0, Blocked: 0 };
  p[status]++;
  byPriority.set(r[col.Priority], p);
  if (status === 'Fail') failing.push(r);
  if (status === 'Not run') notRun.push(r);
}

const total = body.length;
console.log(
  `cases ${total}  pass ${tally.Pass}  fail ${tally.Fail}  not run ${tally['Not run']}  blocked ${tally.Blocked}`,
);
if (checkOnly) {
  console.log('failing:', failing.map((r) => r[col.ID]).join(' '));
  console.log('not run:', notRun.map((r) => r[col.ID]).join(' '));
  process.exit(0);
}

writeFileSync(
  csvPath,
  '﻿' + [header, ...body].map((r) => r.map((v) => esc(v ?? '')).join(',')).join('\r\n') + '\r\n',
);

const table = (map) =>
  ['| | Pass | Fail | Not run | Blocked |', '| --- | --- | --- | --- | --- |']
    .concat(
      [...map.entries()]
        .sort(([x], [y]) => x.localeCompare(y))
        .map(([k, v]) => `| ${k} | ${v.Pass} | ${v.Fail} | ${v['Not run']} | ${v.Blocked} |`),
    )
    .join('\n');

const today = new Date().toISOString().slice(0, 10);
const md = [
  '# UAT results summary',
  '',
  `Generated ${today} by \`node scripts/uat-report.mjs\` from \`e2e/test-results/uat/*.json\`. Case-by-case status is in \`e2e-test-cases.csv\` (columns Status, Run date, Evidence, Notes).`,
  '',
  `**${total} cases:** ${tally.Pass} pass, ${tally.Fail} fail, ${tally['Not run']} not run, ${tally.Blocked} blocked (real AI, owner key).`,
  '',
  '## By priority',
  '',
  table(byPriority),
  '',
  '## By area',
  '',
  table(byArea),
  '',
  '## Failing cases',
  '',
  failing.length
    ? failing
        .map((r) => `- **${r[col.ID]}** ${r[col.Title]} (${r[col.Priority]}): ${r[col.Notes]}`)
        .join('\n')
    : 'None.',
  '',
  '## Not run',
  '',
  notRun.length
    ? notRun
        .map((r) => `- ${r[col.ID]} ${r[col.Title]} (${r[col.Priority]}, ${r[col.Layer]})`)
        .join('\n')
    : 'None.',
  '',
].join('\n');
writeFileSync(summaryPath, md);
console.log(`wrote ${csvPath} and ${summaryPath}`);
