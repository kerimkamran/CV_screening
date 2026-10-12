#!/usr/bin/env node
// UAT environment and test data (Development Plan WP 0.1).
//
//   node scripts/uat-seed.mjs accounts   Makes the test accounts and prints one setup link for each.
//   node scripts/uat-seed.mjs data       Signs in as the UAT recruiter and loads the vacancy and the
//                                        ten fixture resumes, then starts the analysis.
//
// Settings come from the environment, never the command line:
//   UAT_BASE_URL         the site, for example https://cv-screening-rcov.onrender.com
//   UAT_ADMIN_EMAIL      an existing administrator       (accounts)
//   UAT_ADMIN_PASSWORD   that administrator's password   (accounts)
//   UAT_RECRUITER_EMAIL  default uat.recruiter@azerconnect.test
//   UAT_PASSWORD         the recruiter's password, chosen on the setup link (data)
//
// Run it only against the UAT site. The ten resumes are invented people (docs/uat/resumes).
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const UAT = join(here, '..', 'docs', 'uat');
const base = (process.env.UAT_BASE_URL ?? '').replace(/\/$/, '');
const recruiterEmail = process.env.UAT_RECRUITER_EMAIL ?? 'uat.recruiter@azerconnect.test';

const ACCOUNTS = [
  { email: recruiterEmail, displayName: 'UAT Recruiter', role: 'TA_PARTNER' },
  { email: 'uat.lead@azerconnect.test', displayName: 'UAT Team Lead', role: 'TA_LEAD' },
  { email: 'uat.compliance@azerconnect.test', displayName: 'UAT Compliance', role: 'GOVERNANCE' },
  { email: 'uat.viewer@azerconnect.test', displayName: 'UAT Report Viewer', role: 'NONE' },
];

function need(name) {
  if (!process.env[name]) {
    console.error(`Set ${name} first.`);
    process.exit(2);
  }
  return process.env[name];
}

async function call(method, path, token, body, form) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
  return json;
}
const login = async (email, password) =>
  (await call('POST', '/auth/login', null, { email, password })).token;

async function accounts() {
  const token = await login(need('UAT_ADMIN_EMAIL'), need('UAT_ADMIN_PASSWORD'));
  for (const a of ACCOUNTS) {
    try {
      const r = await call('POST', '/admin/users', token, a);
      console.log(
        `${a.role.padEnd(10)} ${a.email}  setup link: ${r.setupLink ?? `${base}/#/set-password?token=${r.setupToken}`}`,
      );
    } catch (e) {
      if (String(e.message).includes('409'))
        console.log(`${a.role.padEnd(10)} ${a.email}  already exists`);
      else throw e;
    }
  }
  console.log(
    '\nOpen each link once to choose a password. Share passwords by hand, never in the log.',
  );
}

async function data() {
  const token = await login(recruiterEmail, need('UAT_PASSWORD'));
  const jd = readFileSync(join(UAT, 'vacancy-en.txt'), 'utf8');
  const title = `UAT Senior Network Engineer ${new Date().toISOString().slice(0, 10)}`;
  const v = await call('POST', '/vacancies', token, { title, jdText: jd });
  console.log(`Vacancy: ${title} (${v.id})`);
  await call('POST', `/vacancies/${v.id}/criteria/extract`, token);
  const form = new FormData();
  for (const f of readdirSync(join(UAT, 'resumes'))
    .filter((x) => x.endsWith('.txt'))
    .sort())
    form.append(
      'files',
      new Blob([readFileSync(join(UAT, 'resumes', f))], { type: 'text/plain' }),
      f,
    );
  const up = await call('POST', `/vacancies/${v.id}/documents`, token, undefined, form);
  console.log(`Uploaded: ${JSON.stringify(up).slice(0, 160)}`);
  await call('POST', `/vacancies/${v.id}/start`, token, { confirmNotice: true });
  console.log(`Started. Open ${base}/#/vacancies/${v.id}`);
}

const cmd = process.argv[2];
if (!base) {
  console.error('Set UAT_BASE_URL first.');
  process.exit(2);
}
if (cmd === 'accounts') await accounts();
else if (cmd === 'data') await data();
else {
  console.error('Usage: node scripts/uat-seed.mjs accounts | data');
  process.exit(2);
}
