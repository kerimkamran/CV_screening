import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { scanDirectory } from '../check-bundle-keys.mjs';
import { isAllowed, scanHcl, scanPlan } from '../check-residency.mjs';
import { checkIsolation } from '../check-env-isolation.mjs';
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
