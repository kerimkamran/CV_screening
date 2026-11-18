#!/usr/bin/env node
// The full-stack server for the UAT journeys (layer L2, plan 2.3): the compiled API from
// apps/api/dist, serving the built web app with the production security policy, against the
// local database cv_uat, with the fake AI (fake-ai.mjs) in place of the provider and the e-mails
// kept in an outbox. A small control server on PORT+1 lets the tests read the outbox and the
// model calls, change the fake AI's mode, and wait for the screening queue.
//   UAT_RESET=1 node e2e/fullstack/server.mjs   (drops and rebuilds cv_uat first)
//   UAT_FAKE_AI=0 ...                           (the real provider: layer L3)
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeFetch, state } from './fake-ai.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(join(root, 'apps/api/package.json'));
const PORT = Number(process.env.UAT_PORT ?? 4320);
const OWNER_URL = process.env.UAT_OWNER_URL ?? 'postgresql://cv:cv@127.0.0.1:5432/cv_uat';
const APP_URL = process.env.UAT_APP_URL ?? 'postgresql://cv_api:cv_api@127.0.0.1:5432/cv_uat';

// Local test secrets, generated once and kept out of git (e2e/.env.uat.local).
const envFile = join(root, 'e2e/.env.uat.local');
if (!existsSync(envFile)) {
  const pw = () => `Uat-${randomBytes(9).toString('base64url')}-1a`;
  writeFileSync(
    envFile,
    JSON.stringify(
      {
        SESSION_SECRET: randomBytes(48).toString('base64'),
        SETTINGS_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
        BOOTSTRAP_ADMIN_EMAIL: 'uat.admin@example.az',
        BOOTSTRAP_ADMIN_PASSWORD: pw(),
        ADMIN_PASSWORD: pw(),
        PASSWORD: pw(),
      },
      null,
      2,
    ),
  );
}
const secrets = JSON.parse(readFileSync(envFile, 'utf8'));

if (process.env.UAT_RESET === '1') {
  const db = new URL(OWNER_URL);
  const name = db.pathname.slice(1);
  db.pathname = '/postgres';
  const psql = (sql) => execFileSync('psql', [db.toString(), '-v', 'ON_ERROR_STOP=1', '-c', sql]);
  psql(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  psql(`CREATE DATABASE ${name}`);
  execFileSync(process.execPath, [join(root, 'scripts/migrate.mjs'), 'up'], {
    env: { ...process.env, MIGRATION_DATABASE_URL: OWNER_URL },
    stdio: 'inherit',
  });
  execFileSync('psql', [
    OWNER_URL,
    '-v',
    'ON_ERROR_STOP=1',
    '-f',
    join(root, 'db/dev/app-login.sql'),
  ]);
}

Object.assign(process.env, {
  NODE_ENV: 'development',
  DATABASE_URL: APP_URL,
  AUTH_MODE: 'local',
  SESSION_SECRET: secrets.SESSION_SECRET,
  SETTINGS_ENCRYPTION_KEY: secrets.SETTINGS_ENCRYPTION_KEY,
  BOOTSTRAP_ADMIN_EMAIL: process.env.UAT_BOOTSTRAP_EMAIL ?? secrets.BOOTSTRAP_ADMIN_EMAIL,
  BOOTSTRAP_ADMIN_PASSWORD: process.env.UAT_BOOTSTRAP_PASSWORD ?? secrets.BOOTSTRAP_ADMIN_PASSWORD,
  WEB_DIST_DIR: join(root, 'apps/web/dist'),
  EMAIL_PROVIDER: process.env.EMAIL_PROVIDER ?? 'console',
  VACANCY_EDIT: process.env.VACANCY_EDIT ?? 'everyone',
  VACANCY_VISIBILITY: process.env.VACANCY_VISIBILITY ?? 'all',
  RENDITION_SOFFICE: process.env.RENDITION_SOFFICE ?? 'soffice',
  PORT: String(PORT),
  HOST: '127.0.0.1',
  LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn',
  // Every browser of the run signs in from 127.0.0.1: the per-address brake would trip between tests.
  AUTH_IP_LIMIT_PER_MIN: process.env.AUTH_IP_LIMIT_PER_MIN ?? '600',
  APP_BASE_URL: `http://127.0.0.1:${PORT}`,
});

require('reflect-metadata');
const { createApp } = require(join(root, 'apps/api/dist/app.factory.js'));
const { AiGateway } = require(join(root, 'apps/api/dist/ai/ai-gateway.service.js'));
const { EmailService } = require(join(root, 'apps/api/dist/auth/email.service.js'));
const { ProcessorService } = require(join(root, 'apps/api/dist/pipeline/processor.service.js'));
const { LINK_READER } = require(join(root, 'apps/api/dist/pipeline/link-reader.token.js'));

const app = await createApp();
const outbox = [];
const email = app.get(EmailService);
const send = email.send.bind(email);
email.send = async (mail) => {
  outbox.push({ at: new Date().toISOString(), ...mail });
  if (process.env.UAT_MAIL_OK === '1') return true;
  return send(mail);
};
if (process.env.UAT_FAKE_AI !== '0') app.get(AiGateway).fetcher = fakeFetch;
// Link review reads a fake page on this machine: the reader refuses loopback unless told otherwise
// (the same switch the API's own tests use, LinkReader({ allowLoopback: true })).
if (process.env.UAT_LINK_LOOPBACK === '1') app.get(LINK_READER).o.allowLoopback = true;
await app.listen(PORT, '127.0.0.1');
console.log(
  `uat: full stack on http://127.0.0.1:${PORT} (fake AI ${process.env.UAT_FAKE_AI !== '0' ? 'on' : 'off'})`,
);

// Control server for the tests (never part of the app).
const control = createServer(async (req, res) => {
  const reply = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString() || '{}') : {};
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/health') return reply(200, { ok: true });
  if (u.pathname === '/outbox') return reply(200, outbox);
  if (u.pathname === '/outbox/clear') return reply(200, ((outbox.length = 0), { ok: true }));
  if (u.pathname === '/model-calls') return reply(200, state.calls);
  if (u.pathname === '/model-calls/clear')
    return reply(200, ((state.calls.length = 0), { ok: true }));
  if (u.pathname === '/ai') {
    if (body.mode) state.mode = body.mode;
    if (body.delayMs !== undefined) state.delayMs = body.delayMs;
    if (Array.isArray(body.failMarkers)) state.failMarkers = body.failMarkers;
    if (body.reader !== undefined) state.reader = !!body.reader;
    if (body.hold === true && !state.hold) {
      state.hold = true;
      state.held = new Promise((r) => (state.release = r));
    }
    if (body.hold === false && state.hold) {
      state.hold = false;
      state.release();
    }
    return reply(200, {
      mode: state.mode,
      delayMs: state.delayMs,
      failMarkers: state.failMarkers,
      reader: state.reader,
    });
  }
  if (u.pathname === '/drain') {
    await app.get(ProcessorService).drain();
    return reply(200, { ok: true });
  }
  if (u.pathname === '/secrets') return reply(200, secrets); // local test values only
  return reply(404, { message: 'unknown control path' });
});
control.listen(PORT + 1, '127.0.0.1');

const stop = async () => {
  control.close();
  await app.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
