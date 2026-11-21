// Stage 3, S3-OPS-04 (b): the gate launcher for G-11 to G-14 (docs/stage-3/development-plan.md 17.3).
// Runs ONLY on the temporary copy `cv-screening-gate` (render.gate.yaml): test data, the fake AI and
// the one fake Oracle inside the process. Started as:
//   node scripts/render-start.mjs e2e/gate/gate-server.mjs
// It refuses to start on the production service, without GATE_COPY=1, when the deploy switch was
// given to it from outside, or when a saved Oracle address is not the fake's.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeFetch, state as ai } from '../fullstack/fake-ai.mjs';
import { loadFakeOracle } from '../fullstack/fake-oracle.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(join(root, 'apps/api/package.json'));
const refuse = (why) => {
  console.error(`gate: refusing to start: ${why}`);
  process.exit(2);
};
if (process.env.GATE_COPY !== '1') refuse('GATE_COPY is not 1');
if (process.env.RENDER_SERVICE_NAME === 'cv-screening') refuse('this is the production service');
if ('ORACLE_IMPORT_ENABLED' in process.env)
  refuse('the import switch must not be set from outside');

// Set inside this process only: the copy's own environment never carries the switch.
process.env.ORACLE_IMPORT_ENABLED = 'true';
process.env.IMPORT_TOMBSTONE_KEY ??= process.env.SESSION_SECRET;
process.env.DB_SIZE_LIMIT_MB ??= '1024';

const oracle = loadFakeOracle();
const fake = oracle.createFakeOracle(Number(process.env.GATE_SEED ?? 7));

/** Set A (mixed, 17.3): 325 PDF, 175 Word; 480 of 50-600 KB, 20 of 9.5 MB as ten back-to-back pairs. */
export function setA(seed = 7) {
  let x = seed;
  const rnd = () => (x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const files = [];
  for (let i = 0; i < 500; i++) {
    const big = i >= 100 && i < 140 && i % 4 < 2; // 20 big files, in pairs
    files.push({
      kind: i % 20 < 13 ? 'pdf' : 'docx',
      sizeBytes: big ? Math.round(9.5 * 2 ** 20) : Math.round((50 + rnd() * 550) * 1024),
    });
  }
  return { number: 'GATE-A', applications: 500, files };
}
/** Set B (UAT-size): 500 applications, mean 1.5 MB, 35 % Word. */
export function setB(seed = 11) {
  let x = seed;
  const rnd = () => (x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const files = Array.from({ length: 500 }, (_, i) => ({
    kind: i % 20 < 13 ? 'pdf' : 'docx',
    sizeBytes: Math.round((0.5 + rnd() * 2) * 2 ** 20),
  }));
  return { number: 'GATE-B', applications: 500, files };
}
fake.seed([setA(), setB()]);
// Until the probe has measured them: 1 s per page of 100 and 2 MB a second (ASSUMPTION, 17.3).
fake.set({
  pace: {
    secondsPerPage: Number(process.env.GATE_PAGE_SECONDS ?? 1),
    bytesPerSecond: Number(process.env.GATE_BYTES_PER_SECOND ?? 2 * 2 ** 20),
  },
  password: process.env.GATE_ORACLE_PASSWORD ?? 'gate-fake-password',
});
ai.delayMs = Number(process.env.GATE_AI_DELAY_MS ?? 20_000);

require('reflect-metadata');
const { createApp } = require(join(root, 'apps/api/dist/app.factory.js'));
const { AiGateway } = require(join(root, 'apps/api/dist/ai/ai-gateway.service.js'));
const { OracleHcmClient } = require(
  join(root, 'apps/api/dist/integrations/oracle/oracle-hcm.client.js'),
);
const { DbService } = require(join(root, 'apps/api/dist/db/db.service.js'));
const { memoryShare } = require(join(root, 'apps/api/dist/pipeline/rendition.service.js'));

const app = await createApp();
app.get(AiGateway).fetcher = fakeFetch;
const client = app.get(OracleHcmClient);
client.fetcher = fake.fetch;
client.lookup = fake.lookup;
const db = app.get(DbService);
const saved = (
  await db.query(`SELECT base_url FROM integration_connection WHERE system = 'oracle_hcm'`)
).rows[0];
if (saved && new URL(saved.base_url).origin !== oracle.FAKE_ORIGIN) {
  await app.close();
  refuse('a saved Oracle address is not the fake Oracle');
}
await app.listen(Number(process.env.PORT ?? 10000), '0.0.0.0');
console.log(
  `gate: up; activate in Admin with address ${oracle.FAKE_ORIGIN}, user ${fake.state.switches.user} and GATE_ORACLE_PASSWORD; requisitions GATE-A and GATE-B`,
);

// One gate.report line every 30 s: memory, runs, database size, Oracle calls in flight.
setInterval(async () => {
  try {
    const runs = await db.query(
      `SELECT state, phase, count(*)::int AS n, coalesce(sum(listed),0)::int AS listed FROM import_run
        WHERE state IN ('queued','running','awaiting_confirm') GROUP BY 1,2`,
    );
    const size = await db.query(`SELECT pg_database_size(current_database()) AS b`);
    console.log(
      `gate.report ${JSON.stringify({
        at: new Date().toISOString(),
        memoryShare: Number(memoryShare().toFixed(3)),
        rssMb: Math.round(process.memoryUsage().rss / 2 ** 20),
        dbMb: Math.round(Number(size.rows[0].b) / 2 ** 20),
        runs: runs.rows,
        oracleInFlight: fake.inFlight(),
        oracleMaxInFlight: fake.maxInFlight,
        downloads: fake.downloads(),
      })}`,
    );
  } catch (e) {
    console.log(`gate.report error ${e.message}`);
  }
}, 30_000).unref();
// SIGTERM and SIGINT: the app's own shutdown hooks close it (app.factory.ts), which also hands an
// import's claim back (ImportRunnerService.onModuleDestroy), as on the production service.
