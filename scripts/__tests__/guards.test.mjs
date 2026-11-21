import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { scanDirectory } from '../check-bundle-keys.mjs';
import { isAllowed, scanHcl, scanPlan } from '../check-residency.mjs';
import { checkIsolation, checkOracleSwitch } from '../check-env-isolation.mjs';
import { checkParity } from '../check-taxonomy-parity.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'cv-guard-'));

test('AISEC-01: clean bundle passes', () => {
  const d = tmp();
  writeFileSync(join(d, 'app.js'), 'fetch("/api/vacancies");const x=1;');
  assert.deepEqual(scanDirectory(d), []);
});

test('AISEC-01: each provider pattern is caught, nested files included', () => {
  const d = tmp();
  mkdirSync(join(d, 'assets'));
  const cases = {
    'a.js': 'const k="AIza' + 'A'.repeat(35) + '";',
    'b.js': 'const k="sk-' + 'x'.repeat(30) + '";',
    'c.js': 'import {GoogleGenAI} from "@google/genai";',
    'd.js': 'fetch("https://api.openai.com/v1/chat")',
    'assets/e.js': 'process.env.GEMINI_API_KEY',
    'f.js': 'fetch("https://contoso.openai.azure.com/openai/deployments/x")',
  };
  for (const [f, body] of Object.entries(cases)) writeFileSync(join(d, f), body);
  const hit = new Set(scanDirectory(d).map((x) => x.file.slice(d.length + 1)));
  assert.deepEqual([...hit].sort(), Object.keys(cases).sort());
});

test('AISEC-01: findings never include the matched secret', () => {
  const d = tmp();
  const secret = 'AIza' + 'B'.repeat(35);
  writeFileSync(join(d, 'a.js'), `x="${secret}"`);
  assert.ok(!JSON.stringify(scanDirectory(d)).includes(secret));
});

test('AISEC-01: a missing bundle directory throws (a missing report is a failure, not a pass)', () => {
  assert.throws(() => scanDirectory(join(tmpdir(), 'does-not-exist-' + Date.now())));
});

test('PLAT-09: EU regions allowed, others rejected, spelling-insensitive', () => {
  assert.ok(isAllowed('westeurope'));
  assert.ok(isAllowed('West Europe'));
  assert.ok(isAllowed('North-Europe'));
  assert.ok(!isAllowed('eastus'));
  assert.ok(!isAllowed('uaenorth'));
});

test('PLAT-09: static scan names the offending resource and region', () => {
  const d = tmp();
  writeFileSync(
    join(d, 'main.tf'),
    `
variable "location" {
  type = string
  validation {
    condition     = contains(["westeurope", "northeurope"], var.location)
    error_message = "EU only"
  }
}
resource "azurerm_resource_group" "ok" {
  location = var.location
}
resource "azurerm_storage_account" "bad" {
  location = "eastus"
}
`,
  );
  const v = scanHcl(d);
  assert.equal(v.length, 1);
  assert.equal(v[0].resource, 'azurerm_storage_account.bad');
  assert.equal(v[0].region, 'eastus');
});

test('PLAT-09: static scan fails if var.location has no validation block', () => {
  const d = tmp();
  writeFileSync(
    join(d, 'main.tf'),
    `variable "location" { type = string }\nresource "azurerm_resource_group" "rg" { location = var.location }\n`,
  );
  assert.equal(scanHcl(d)[0].resource, 'variable.location');
});

test('PLAT-09: plan scan walks child modules and ignores global resource types', () => {
  const plan = {
    planned_values: {
      root_module: {
        resources: [
          {
            address: 'azurerm_resource_group.rg',
            type: 'azurerm_resource_group',
            values: { location: 'westeurope' },
          },
          {
            address: 'azurerm_role_assignment.x',
            type: 'azurerm_role_assignment',
            values: { location: 'global' },
          },
        ],
        child_modules: [
          {
            resources: [
              {
                address: 'module.db.azurerm_postgresql_flexible_server.pg',
                type: 'azurerm_postgresql_flexible_server',
                values: { location: 'eastus2' },
              },
            ],
          },
        ],
      },
    },
  };
  const v = scanPlan(plan);
  assert.equal(v.length, 1);
  assert.equal(v[0].resource, 'module.db.azurerm_postgresql_flexible_server.pg');
});

test('taxonomy: Postgres enums and shared TS constants agree', () => {
  assert.deepEqual(checkParity(), []);
});

test('PLAT-08: committed environments are isolated', () => {
  assert.deepEqual(checkIsolation(), []);
});

test('PLAT-08: shared state or a mislabelled environment is caught', () => {
  const d = tmp();
  for (const e of ['dev', 'staging', 'prod']) {
    writeFileSync(join(d, `${e}.tfvars.example`), `environment = "${e === 'prod' ? 'dev' : e}"\n`);
    writeFileSync(
      join(d, `backend-${e}.hcl.example`),
      `resource_group_name = "rg"\nstorage_account_name = "sa"\nkey = "${e === 'staging' ? 'dev' : e}.tfstate"\n`,
    );
  }
  const problems = checkIsolation(d).join('\n');
  assert.match(problems, /prod.tfvars.example declares environment="dev"/);
  assert.match(problems, /share backend storage_account_name/);
});

// ------------------------------------------------------------------ Stage 3 (S3-OPS-01, S3-OPS-03)

test('S3-OPS-03: each of the five Oracle patterns fails the bundle guard, naming the rule only', () => {
  const d = tmp();
  const cases = {
    'a.js': 'const u="https://pod.fa.em2.oraclecloud.com";',
    'b.js': 'fetch("/hcmRestApi/resources/x")',
    'c.js': 'const r="recruitingJobApplications";',
    'd.js': 'process.env.ORACLE_IMPORT_ENABLED',
    'e.js': 'IMPORT_TOMBSTONE_KEY',
  };
  for (const [f, body] of Object.entries(cases)) writeFileSync(join(d, f), body);
  const found = scanDirectory(d);
  assert.deepEqual(
    [...new Set(found.map((x) => x.file.slice(d.length + 1)))].sort(),
    Object.keys(cases).sort(),
  );
  assert.ok(!JSON.stringify(found).includes('pod.fa.em2'));
  // The word "Oracle" in a label stays allowed.
  const ok = tmp();
  writeFileSync(join(ok, 'a.js'), 'const s="Import CVs from Oracle";');
  assert.deepEqual(scanDirectory(ok), []);
});

test('S3-OPS-03: the Oracle switch may only be declared with sync: false in render.yaml', () => {
  const root = tmp();
  mkdirSync(join(root, 'infra', 'environments'), { recursive: true });
  writeFileSync(
    join(root, 'render.yaml'),
    'envVars:\n      - key: ORACLE_IMPORT_ENABLED\n        sync: false\n',
  );
  assert.deepEqual(checkOracleSwitch(root), []);
  writeFileSync(
    join(root, 'render.yaml'),
    "envVars:\n      - key: ORACLE_IMPORT_ENABLED\n        value: 'true'\n",
  );
  assert.equal(checkOracleSwitch(root).length > 0, true);
  writeFileSync(
    join(root, 'render.yaml'),
    'envVars:\n      - key: ORACLE_IMPORT_ENABLED\n        sync: false\n',
  );
  for (const f of [
    '.env.example',
    'docker-compose.yml',
    'render.gate.yaml',
    'infra/environments/dev.tfvars.example',
  ]) {
    writeFileSync(join(root, f), '# ORACLE_IMPORT_ENABLED\n');
    assert.equal(
      checkOracleSwitch(root).some((p) => p.startsWith(f)),
      true,
      f,
    );
    writeFileSync(join(root, f), '# nothing\n');
  }
  assert.deepEqual(checkOracleSwitch(root), []);
});

test('S3-OPS-03: the real repository passes the switch rule', () => {
  assert.deepEqual(checkOracleSwitch(), []);
});

/**
 * S3-OPS-01 / S3-OPS-03 (plan 8, 17.2): no Oracle schema or product code before ADR 0011 is Accepted.
 * This case fails while a file exists under apps/api/src/integrations/ or as db/migrations/0041_*
 * and line 3 of ADR 0011 does not read "Accepted". It is the entry gate of Phase 2: a branch that
 * carries Phases 2 to 4 cannot be green until the programme owner has accepted the ADR.
 */
test('S3-OPS-01: Oracle code exists only after ADR 0011 is Accepted', () => {
  const root = join(import.meta.dirname, '..', '..');
  const adr =
    readFileSync(join(root, 'docs/adr/0011-oracle-recruiting-import.md'), 'utf8').split('\n')[2] ??
    '';
  const accepted = /^Status:\s*\**Accepted/i.test(adr.trim());
  const oracleCode =
    existsSync(join(root, 'apps/api/src/integrations')) ||
    readdirSync(join(root, 'db/migrations')).some((f) => f.startsWith('0041_'));
  assert.ok(
    accepted || !oracleCode,
    'Oracle import code is on this branch but ADR 0011 is not Accepted (docs/adr/0011-oracle-recruiting-import.md, line 3). The programme owner accepts it first.',
  );
});

test('S3-OPS-04: the gate copy uses the same plans and region as production, and no import switch', () => {
  const root = join(import.meta.dirname, '..', '..');
  const pick = (f) => {
    const t = readFileSync(join(root, f), 'utf8');
    return {
      regions: [...t.matchAll(/^\s+region:\s*(\S+)/gm)].map((m) => m[1]),
      plans: [...t.matchAll(/^\s+plan:\s*(\S+)/gm)].map((m) => m[1]),
      text: t,
    };
  };
  const prod = pick('render.yaml');
  const gate = pick('render.gate.yaml');
  assert.deepEqual(gate.regions, prod.regions);
  assert.deepEqual(gate.plans, prod.plans);
  assert.ok(!/ORACLE_IMPORT_ENABLED/.test(gate.text));
  assert.ok(/GATE_COPY/.test(gate.text));
});

test('S3-OPS-04: the gate launcher refuses to start without GATE_COPY=1, and on the production service', async () => {
  const { spawnSync } = await import('node:child_process');
  const root = join(import.meta.dirname, '..', '..');
  const run = (env) =>
    spawnSync(process.execPath, [join(root, 'e2e/gate/gate-server.mjs')], {
      env: { PATH: process.env.PATH, ...env },
      encoding: 'utf8',
      timeout: 20_000,
    });
  assert.equal(run({}).status, 2);
  assert.equal(run({ GATE_COPY: '1', RENDER_SERVICE_NAME: 'cv-screening' }).status, 2);
  assert.equal(run({ GATE_COPY: '1', ORACLE_IMPORT_ENABLED: 'false' }).status, 2);
});
