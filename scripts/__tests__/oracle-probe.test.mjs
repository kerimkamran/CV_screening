// Stage 3 plan, sections 5.4 and 13: tests for the operator-run Oracle probe.
// The "Oracle" here is a fake built with http.createServer on 127.0.0.1. Its labels, link shapes
// and answers are the fake's own choices: they exercise the probe and are not statements about
// Oracle. Every scenario also checks that nothing personal can be printed.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  BASE_PATH,
  STEP_NAMES,
  clampMaxApplications,
  classifyBytes,
  createClient,
  extensionOf,
  hostLabelOf,
  isAllowedAddress,
  isBlockedAddress,
  main,
  normaliseAddress,
  parseKnownLabels,
  readConfig,
  renderJson,
  renderSummary,
  runProbe,
  safeContentType,
  safeLabel,
  testPodConfirmation,
} from '../oracle-probe.mjs';

const PROBE_FILE = fileURLToPath(new URL('../oracle-probe.mjs', import.meta.url));
const MB = 1024 * 1024;

const POD = 'https://probe-test.fa.em2.oraclecloud.com';
const FILES = 'https://files.objectstorage.eu-frankfurt-1.oraclecloud.com';
const USER = 'parallax.probe';
const PASSWORD = 'Pr0be-secret-word';
const BASIC = `Basic ${Buffer.from(`${USER}:${PASSWORD}`).toString('base64')}`;
const REQ_NUMBER = 'REQ-90417';
const REQ_ID = 300000111222333;
// A host name without a test-style word: what a production address could look like.
const UNLABELLED_POD = 'https://parallaxco.fa.em2.oraclecloud.com';
// The labels the operator lists, as the Oracle team would give them in writing. They are the
// fake's own labels, not statements about Oracle.
const KNOWN_LABELS =
  'To be Reviewed|Rejected by Employer|Withdrawn by Candidate|New|Screening|' +
  'IRC_CANDIDATE_RESUME|IRC_CANDIDATE_COVERLETTER|MISC';
// The name lookup used when a test names an Oracle host: one public address, never contacted.
const lookupPublic = async () => [{ address: '8.8.8.8', family: 4 }];
// The synthetic candidate. None of these three values may ever reach the output.
const PERSON = {
  name: 'Leyla Sentinel',
  email: 'leyla.sentinel@example.test',
  file: 'Leyla_Sentinel_CV.pdf',
};

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF = Buffer.concat([
  Buffer.from('%PDF-1.7\n'),
  Buffer.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]),
  Buffer.from(`(${PERSON.name}) (${PERSON.email})\n`),
  Buffer.alloc(1500, 0x20),
  Buffer.from('%%EOF\n'),
]);
const DOCX = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]),
  Buffer.alloc(900),
]);
const OLE = Buffer.concat([
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  Buffer.alloc(600),
]);
const RTF = Buffer.from(`{\\rtf1\\ansi ${PERSON.name}}`);
const TXT = Buffer.from(`${PERSON.name}\n${PERSON.email}\n`);

// ---------------------------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------------------------

function seedBuilder() {
  let attachmentId = 300000888000000;
  const file = (FileName, UploadedFileContentType, bytes, more = {}) => {
    attachmentId += 1;
    return {
      AttachedDocumentId: attachmentId,
      DmDocumentId: `UCMFA${4400000 + (attachmentId % 1000)}`,
      DatatypeCode: 'FILE',
      CategoryName: 'IRC_CANDIDATE_RESUME',
      FileName,
      UploadedFileContentType,
      UploadedFileLength: bytes.length,
      fileUrl: 'relative',
      bytes,
      ...more,
    };
  };
  const notAFile = (DatatypeCode) => {
    attachmentId += 1;
    return {
      AttachedDocumentId: attachmentId,
      DmDocumentId: null,
      DatatypeCode,
      CategoryName: 'MISC',
      FileName: null,
      UploadedFileContentType: null,
      UploadedFileLength: null,
      fileUrl: 'absent',
      bytes: null,
    };
  };
  const application = (
    n,
    [confirmed, disqualified, internal],
    StateName,
    PhaseName,
    attachments,
  ) => ({
    JobApplicationId: 300000555000000 + n,
    CandidatePersonId: 300000777000000 + n,
    RequisitionId: REQ_ID,
    ConfirmedFlag: confirmed,
    DisqualifiedFlag: disqualified,
    InternalFlag: internal,
    StateName,
    PhaseName,
    JobApplicationDate: '2026-11-03T08:00:00+00:00',
    LastUpdateDate: '2026-11-12T10:30:00.000Z',
    attachments,
  });
  const requisition = (RequisitionId) => ({
    RequisitionId,
    RequisitionNumber: REQ_NUMBER,
    Title: `Synthetic vacancy, hiring manager ${PERSON.name}`,
    StateName: 'Open',
    PhaseName: 'Posting',
  });
  return { file, notAFile, application, requisition };
}

/** Five applications whose tallies are worked out by hand in the happy-path test. */
function standardSeed() {
  const { file, notAFile, application, requisition } = seedBuilder();
  const applications = [
    application(1, [true, false, false], 'To be Reviewed', 'New', [
      file(PERSON.file, `application/pdf; name="${PERSON.file}"`, PDF),
    ]),
    application(2, [true, true, false], 'Rejected by Employer', 'Screening', [
      file('Sentinel Leyla résumé.DOCX', DOCX_TYPE, DOCX),
      notAFile('WEB_PAGE'),
      file('cover letter Leyla.txt', 'text/plain; charset=utf-8', TXT, {
        CategoryName: 'IRC_CANDIDATE_COVERLETTER',
        UploadedFileLength: 2 * MB,
        fileUrl: 'absent',
      }),
    ]),
    application(3, [false, false, true], 'To be Reviewed', 'New', []),
    application(4, [true, false, false], 'Withdrawn by Candidate', 'Screening', [
      file('leyla.sentinel.cv.doc', 'application/msword', OLE, { UploadedFileLength: null }),
    ]),
    application(5, [true, false, false], 'To be Reviewed', 'New', [
      file('Leyla Sentinel portfolio.sentinelx', 'application/x-leyla-sentinel', RTF, {
        CategoryName: 'MISC',
        UploadedFileLength: 12 * MB,
        fileUrl: 'otherHost',
      }),
      file('scan_of_Leyla_Sentinel', 'image/jpeg', RTF, {
        UploadedFileLength: 6 * MB,
        fileUrl: 'sameHost',
      }),
      notAFile('TEXT'),
    ]),
  ];
  // Stored newest first, so the order is right only when the probe asks for it.
  return { requisitions: [requisition(REQ_ID)], applications: applications.reverse() };
}

function manySeed(count) {
  const { file, application, requisition } = seedBuilder();
  const applications = [];
  for (let n = 1; n <= count; n += 1) {
    applications.push(
      application(n, [true, false, false], 'To be Reviewed', 'New', [
        file(PERSON.file, 'application/pdf', PDF),
      ]),
    );
  }
  return { requisitions: [requisition(REQ_ID)], applications };
}

// ---------------------------------------------------------------------------------------------
// The fake Oracle
// ---------------------------------------------------------------------------------------------

const keyOf = (attachment) => `00020000000EACED${attachment.AttachedDocumentId}`;

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

function closer(server) {
  return () =>
    new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
}

/**
 * Options: seed, publicOrigin (the origin written into links), headers (added to every answer),
 * signIn 'refused' | 'forbidden', emptyScope, titleUnknown, acceptSemicolon, ignoreFields,
 * ignoreLimit, ignoreOffset, fieldsDropLinks, attachmentLinks false, hugeList,
 * attachments 'error' | 'error400',
 * flagForms (the flag spellings the filter accepts; default ['true_false']), flagFilterIgnored,
 * attachmentFields 'refused' (400 when the attachments read names fields),
 * enclosure 'redirectForeign' | 'redirectSameHost' | 'tooBigStream' | 'hang',
 * fileUrl 'open' | 'redirectForeign' | 'redirectOracle' | 'tooBigDeclared' | 'throttled',
 * foreignOrigin, filesOrigin.
 */
async function startFake(options = {}) {
  const seed = options.seed ?? standardSeed();
  const requests = [];
  let origin = '';
  const pub = () => options.publicOrigin ?? origin;

  const send = (res, status, body, headers = {}) => {
    const payload = Buffer.isBuffer(body) || typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json', ...options.headers, ...headers });
    res.end(payload);
  };
  // Every refusal carries personal data in its body: the probe must never read it.
  const refuse = (res, status, headers) =>
    send(
      res,
      status,
      { title: 'Refused', detail: `${PERSON.name} <${PERSON.email}> ${REQ_ID}` },
      headers,
    );
  const redirect = (res, location) => {
    res.writeHead(302, { location, ...options.headers });
    res.end();
  };
  const sendFile = (res, attachment) =>
    send(res, 200, attachment.bytes, {
      'content-type': attachment.UploadedFileContentType,
      'content-length': attachment.bytes.length,
      'content-disposition': `attachment; filename="${encodeURIComponent(attachment.FileName)}"`,
    });

  function collection(url, rows, toItem) {
    const params = url.searchParams;
    const limit = Number(params.get('limit') ?? 25);
    const offset = options.ignoreOffset ? 0 : Number(params.get('offset') ?? 0);
    const slice = rows.slice(offset, options.ignoreLimit ? undefined : offset + limit);
    const fields = options.ignoreFields ? null : (params.get('fields')?.split(',') ?? null);
    const dropLinks =
      params.get('onlyData') === 'true' || (fields !== null && options.fieldsDropLinks === true);
    const items = slice.map((row) => {
      const { links, ...data } = toItem(row);
      const kept = fields
        ? Object.fromEntries(Object.entries(data).filter(([name]) => fields.includes(name)))
        : data;
      return dropLinks || !links ? kept : { ...kept, links };
    });
    const body = {
      items,
      count: items.length,
      hasMore: offset + slice.length < rows.length,
      limit,
      offset,
    };
    if (params.get('totalResults') === 'true') body.totalResults = rows.length;
    return body;
  }

  function requisitions(res, url) {
    const fields = (url.searchParams.get('fields') ?? '').split(',');
    if (options.titleUnknown && fields.includes('Title')) return refuse(res, 400);
    const finder = url.searchParams.get('finder');
    let rows = options.emptyScope ? [] : seed.requisitions;
    if (finder !== null) {
      const match = /^findByRequisitionNumber;RequisitionNumber=(.+)$/.exec(finder);
      if (!match) return refuse(res, 400);
      rows = rows.filter((row) => row.RequisitionNumber === match[1]);
    }
    const toItem = (row) => ({ ...row, HiringManagerName: PERSON.name, links: [] });
    return send(res, 200, collection(url, rows, toItem));
  }

  function applicationItem(row) {
    const data = { ...row };
    delete data.attachments; // the fake's own bookkeeping, not part of the row
    const self = `${pub()}${BASE_PATH}/recruitingJobApplications/${row.JobApplicationId}`;
    return {
      ...data,
      CandidateName: PERSON.name,
      CandidateEmail: PERSON.email,
      links: [
        { rel: 'self', href: self, name: 'recruitingJobApplications', kind: 'item' },
        {
          rel: 'child',
          href: `${self}/child/attachments`,
          name: 'attachments',
          kind: 'collection',
        },
      ],
    };
  }

  function applications(res, url) {
    const q = url.searchParams.get('q') ?? '';
    if (q.includes(';') && !options.acceptSemicolon) return refuse(res, 400);
    let rows = [...seed.applications];
    for (const part of q.split(/\s+and\s+|;/)) {
      const flag = /^(ConfirmedFlag|DisqualifiedFlag)\s*=\s*(true|false|'Y'|'N')$/.exec(
        part.trim(),
      );
      if (flag) {
        const form = flag[2].startsWith("'") ? 'y_n' : 'true_false';
        if (!(options.flagForms ?? ['true_false']).includes(form)) return refuse(res, 400);
        const wanted = flag[2] === 'true' || flag[2] === "'Y'";
        if (!options.flagFilterIgnored) rows = rows.filter((row) => row[flag[1]] === wanted);
        continue;
      }
      const term = /^(RequisitionId|JobApplicationId)\s*(=|>)\s*(\d+)$/.exec(part.trim());
      if (!term) return refuse(res, 400);
      const [, name, sign, value] = term;
      rows = rows.filter((row) =>
        sign === '=' ? row[name] === Number(value) : row[name] > Number(value),
      );
    }
    if (url.searchParams.get('orderBy') === 'JobApplicationId:asc') {
      rows.sort((a, b) => a.JobApplicationId - b.JobApplicationId);
    }
    const body = collection(url, rows, applicationItem);
    const isTheList = (url.searchParams.get('fields') ?? '').includes('CandidatePersonId');
    if (options.hugeList && isTheList) {
      // More than 5 MB, sent in pieces so no length is stated up front.
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write(`{"padding":"${'x'.repeat(6 * MB)}",`);
      return res.end(JSON.stringify(body).slice(1));
    }
    return send(res, 200, body);
  }

  function fileUrlOf(attachment) {
    const path =
      `/content/conn/FusionAppsContentRepository/${attachment.AttachedDocumentId}/` +
      `${encodeURIComponent(attachment.FileName ?? 'none')}` +
      `?XFND_SIGNATURE=sig${attachment.AttachedDocumentId}&XFND_EXPIRES=1795000000000`;
    if (attachment.fileUrl === 'absent') return null;
    if (attachment.fileUrl === 'sameHost') return `${pub()}${path}`;
    if (attachment.fileUrl === 'otherHost') {
      return `${options.filesOrigin ?? 'https://files.example.test'}/cv/${attachment.AttachedDocumentId}`;
    }
    return path;
  }

  function attachmentItem(application, attachment) {
    const self =
      `${pub()}${BASE_PATH}/recruitingJobApplications/${application.JobApplicationId}` +
      `/child/attachments/${keyOf(attachment)}`;
    const links = [{ rel: 'self', href: self, name: 'attachments', kind: 'item' }];
    if (attachment.DatatypeCode === 'FILE') {
      links.push({
        rel: 'enclosure',
        href: `${self}/enclosure/FileContents`,
        name: 'FileContents',
        kind: 'other',
      });
    }
    return {
      AttachedDocumentId: attachment.AttachedDocumentId,
      LastUpdateDate: '2026-11-18T09:15:00+00:00',
      DatatypeCode: attachment.DatatypeCode,
      CategoryName: attachment.CategoryName,
      FileName: attachment.FileName,
      UploadedFileName: attachment.FileName,
      UploadedFileContentType: attachment.UploadedFileContentType,
      UploadedFileLength: attachment.UploadedFileLength,
      FileUrl: fileUrlOf(attachment),
      DmDocumentId: attachment.DmDocumentId,
      DmVersionNumber: '1',
      Title: attachment.FileName ?? PERSON.name,
      Description: `CV of ${PERSON.name} <${PERSON.email}>`,
      CreatedBy: PERSON.email,
      CreatedByUserName: PERSON.name,
      LastUpdatedByUserName: PERSON.name,
      DownloadInfo: JSON.stringify({ fileName: attachment.FileName, person: PERSON.name }),
      links: options.attachmentLinks === false ? null : links,
    };
  }

  function enclosure(res, attachment) {
    const mode = options.enclosure ?? 'ok';
    if (mode === 'hang') return undefined; // never answers
    if (mode === 'redirectForeign') {
      return redirect(res, `${options.foreignOrigin}/elsewhere/${attachment.FileName}`);
    }
    if (mode === 'redirectSameHost')
      return redirect(res, fileUrlOf({ ...attachment, fileUrl: 'relative' }));
    if (mode === 'tooBigStream') {
      // 11 MB in pieces, with no length stated up front.
      res.writeHead(200, { 'content-type': 'application/pdf' });
      for (let i = 0; i < 11; i += 1) res.write(Buffer.alloc(MB, 0x41));
      return res.end();
    }
    if (!attachment.bytes) return refuse(res, 404);
    return sendFile(res, attachment);
  }

  function content(req, res, url) {
    const id = url.pathname.split('/')[4];
    const attachment = seed.applications
      .flatMap((application) => application.attachments)
      .find((candidate) => String(candidate.AttachedDocumentId) === id);
    const mode = options.fileUrl ?? 'signInNeeded';
    if (!attachment?.bytes) return refuse(res, 404);
    if (mode === 'redirectForeign') {
      return redirect(res, `${options.foreignOrigin}/elsewhere/${attachment.FileName}`);
    }
    if (mode === 'redirectOracle') return redirect(res, `${FILES}/cv/${attachment.FileName}`);
    if (mode === 'throttled') return refuse(res, 429, { 'retry-after': '30' });
    if (mode === 'tooBigDeclared') {
      const big = Buffer.alloc(11 * MB, 0x41);
      return send(res, 200, big, {
        'content-type': 'application/pdf',
        'content-length': big.length,
      });
    }
    if (mode === 'signInNeeded' && req.headers.authorization !== BASIC) {
      return send(res, 401, `<html>${PERSON.name}, please sign in</html>`, {
        'content-type': 'text/html',
      });
    }
    return sendFile(res, attachment);
  }

  function route(req, res) {
    const url = new URL(req.url, origin);
    requests.push({
      method: req.method,
      path: url.pathname,
      rawQuery: url.search.slice(1),
      headers: req.headers,
    });
    if (req.method !== 'GET') return refuse(res, 405);
    if (url.pathname.startsWith('/content/conn/')) return content(req, res, url);
    if (!url.pathname.startsWith(`${BASE_PATH}/`)) return refuse(res, 404);
    if (options.signIn === 'forbidden') return refuse(res, 403);
    if (options.signIn === 'refused' || req.headers.authorization !== BASIC)
      return refuse(res, 401);
    if (req.headers['rest-framework-version'] !== '4') return refuse(res, 400);

    const parts = url.pathname
      .slice(BASE_PATH.length + 1)
      .split('/')
      .map(decodeURIComponent);
    const [resource, id, child, childName, key, lob, field] = parts;
    if (resource === 'recruitingJobRequisitions' && parts.length === 1)
      return requisitions(res, url);
    if (resource !== 'recruitingJobApplications') return refuse(res, 404);
    if (parts.length === 1) return applications(res, url);
    const application = seed.applications.find((row) => String(row.JobApplicationId) === id);
    if (!application || child !== 'child' || childName !== 'attachments') return refuse(res, 404);
    if (parts.length === 4) {
      if (options.attachments === 'error') return refuse(res, 500);
      if (options.attachments === 'error400') return refuse(res, 400);
      if (options.attachmentFields === 'refused' && url.searchParams.has('fields')) {
        return refuse(res, 400);
      }
      const toItem = (attachment) => attachmentItem(application, attachment);
      return send(res, 200, collection(url, application.attachments, toItem));
    }
    const attachment = application.attachments.find(
      (candidate) => keyOf(candidate) === key || String(candidate.AttachedDocumentId) === key,
    );
    if (!attachment) return refuse(res, 404);
    if (parts.length === 5) {
      const wantsContents = url.searchParams.get('fields') === 'FileContents';
      if (!wantsContents) return send(res, 200, attachmentItem(application, attachment));
      return send(res, 200, { FileContents: attachment.bytes?.toString('base64') ?? null });
    }
    if (parts.length === 7 && lob === 'enclosure' && field === 'FileContents') {
      return enclosure(res, attachment);
    }
    return refuse(res, 404);
  }

  const server = createServer((req, res) => {
    res.on('error', () => {});
    route(req, res);
  });
  origin = await listen(server);
  return { origin, seed, requests, close: closer(server) };
}

/** Another host. It hands out a file to anyone who asks and records who asked. */
async function startForeign() {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ method: req.method, path: req.url, headers: req.headers });
    res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': PDF.length });
    res.end(PDF);
  });
  const origin = await listen(server);
  return { origin, requests, close: closer(server) };
}

/** A fetch that sends the named https origins to local servers and records every call. */
function mappedFetch(routes, log = []) {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    log.push({
      origin: url.origin,
      path: url.pathname,
      search: url.search,
      method: init.method,
      redirect: init.redirect,
      authorization: init.headers?.Authorization ?? null,
      framework: init.headers?.['REST-Framework-Version'] ?? null,
    });
    const target = routes[url.origin];
    if (!target) throw new Error(`the test has no server for ${url.origin}`);
    return fetch(`${target}${url.pathname}${url.search}`, init);
  };
}

// ---------------------------------------------------------------------------------------------
// Checks shared by every scenario
// ---------------------------------------------------------------------------------------------

function forbiddenWords(seed) {
  const ids = [REQ_ID];
  for (const application of seed.applications) {
    ids.push(application.JobApplicationId, application.CandidatePersonId);
    for (const attachment of application.attachments) {
      ids.push(attachment.AttachedDocumentId);
      if (attachment.DmDocumentId) ids.push(attachment.DmDocumentId);
    }
  }
  return [
    'Leyla',
    'Sentinel',
    'example.test',
    REQ_NUMBER,
    USER,
    PASSWORD,
    BASIC.slice('Basic '.length),
    '127.0.0.1',
    'http:',
    'https:',
    'probe-test',
    'parallaxco',
    'oraclecloud.com',
    'hcmRestApi',
    'XFND',
    ...ids.filter((id) => id !== null).map(String),
  ];
}

function assertNothingPersonal(text, seed) {
  const lower = text.toLowerCase();
  for (const word of forbiddenWords(seed)) {
    assert.ok(!lower.includes(word.toLowerCase()), `the output must not contain "${word}"`);
  }
}

function assertFixedNotes(report) {
  const notes = report.steps.flatMap((step) => [
    step.note,
    ...(step.routes ?? []).map((route) => route.note),
  ]);
  for (const note of notes) {
    assert.ok(note === null || /^[a-z0-9_]+$/.test(note), `a note must be a fixed word: ${note}`);
  }
}

/** Runs the probe against the fake over loopback and applies the shared checks. */
async function probe(fake, overrides = {}) {
  const report = await runProbe({
    baseUrl: fake.origin,
    user: USER,
    password: PASSWORD,
    requisition: REQ_NUMBER,
    knownLabels: KNOWN_LABELS,
    allowLoopbackForTests: true,
    ...overrides,
  });
  assertNothingPersonal(renderJson(report) + renderSummary(report), fake.seed);
  assertFixedNotes(report);
  assert.deepEqual(
    report.steps.map((step) => step.step),
    STEP_NAMES,
  );
  assert.ok(fake.requests.every((request) => request.method === 'GET'));
  return report;
}

const stepOf = (report, name) => report.steps.find((step) => step.step === name);
const routeOf = (report, name) => stepOf(report, 'download').routes.find((r) => r.route === name);
const pick = (record, names) => Object.fromEntries(names.map((name) => [name, record[name]]));

async function runMain(env, fetchImpl) {
  let out = '';
  let err = '';
  const code = await main({
    env,
    argv: [],
    fetch: fetchImpl,
    lookup: lookupPublic,
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      err += text;
    },
  });
  return { code, out, err };
}

function runCli(env, args = []) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [PROBE_FILE, ...args],
      { env: { PATH: process.env.PATH, ...env }, timeout: 30_000 },
      (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }),
    );
  });
}

const ENV = {
  ORACLE_PROBE_URL: POD,
  ORACLE_PROBE_USER: USER,
  ORACLE_PROBE_PASSWORD: PASSWORD,
  ORACLE_PROBE_REQUISITION: REQ_NUMBER,
  ORACLE_PROBE_CONFIRM_TEST_POD: 'yes',
};
// What a test passes to runProbe when it names the Oracle host itself.
const ON_POD = {
  baseUrl: POD,
  user: USER,
  password: PASSWORD,
  requisition: REQ_NUMBER,
  confirmTestPod: 'yes',
  knownLabels: KNOWN_LABELS,
  lookup: lookupPublic,
};

// ---------------------------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------------------------

test('normaliseAddress trims a pasted REST link to the address', () => {
  const pasted = `${POD}${BASE_PATH}/recruitingJobRequisitions?limit=1&onlyData=true#top`;
  assert.equal(normaliseAddress(pasted), POD);
  assert.equal(normaliseAddress(`  ${POD}/  `), POD);
  assert.equal(normaliseAddress('probe-test.fa.em2.oraclecloud.com/hcmRestApi'), POD);
  assert.equal(normaliseAddress(`${POD}:443/x`), POD);
  assert.equal(normaliseAddress('HTTPS://Probe-Test.FA.em2.OracleCloud.com/'), POD);
  assert.equal(
    normaliseAddress('http://probe-test.fa.em2.oraclecloud.com/a'),
    'http://probe-test.fa.em2.oraclecloud.com',
  );
});

test('normaliseAddress refuses what is not an address', () => {
  assert.equal(normaliseAddress(''), null);
  assert.equal(normaliseAddress('   '), null);
  assert.equal(normaliseAddress(undefined), null);
  assert.equal(normaliseAddress(42), null);
  assert.equal(normaliseAddress('https://exa mple.oraclecloud.com'), null);
  assert.equal(normaliseAddress('ftp://probe-test.fa.em2.oraclecloud.com'), null);
  assert.equal(
    normaliseAddress(`https://${USER}:${PASSWORD}@probe-test.fa.em2.oraclecloud.com`),
    null,
  );
  assert.equal(normaliseAddress(`${USER}:${PASSWORD}@probe-test.fa.em2.oraclecloud.com`), null);
});

test('isAllowedAddress: https only, the standard port, an oraclecloud.com host, no credentials', () => {
  assert.equal(isAllowedAddress(POD), true);
  assert.equal(isAllowedAddress(new URL(`${POD}${BASE_PATH}/recruitingJobRequisitions`)), true);
  assert.equal(isAllowedAddress('https://a.oraclecloud.com:443'), true);

  assert.equal(isAllowedAddress('https://a.oraclecloud.com:8443'), false);
  assert.equal(isAllowedAddress(`${POD}:8443/x`), false);
  assert.equal(isAllowedAddress(normaliseAddress(`${POD}:8443/hcmRestApi`)), false);
  assert.equal(isAllowedAddress('http://probe-test.fa.em2.oraclecloud.com'), false);
  assert.equal(isAllowedAddress('https://example.com'), false);
  assert.equal(isAllowedAddress('https://oraclecloud.com'), false);
  assert.equal(isAllowedAddress('https://eviloraclecloud.com'), false);
  assert.equal(isAllowedAddress('https://probe-test.oraclecloud.com.example.test'), false);
  assert.equal(isAllowedAddress('https://oraclecloud.com.example.test/.oraclecloud.com'), false);
  assert.equal(isAllowedAddress('https://127.0.0.1'), false);
  assert.equal(isAllowedAddress('http://127.0.0.1:8080'), false);
  assert.equal(
    isAllowedAddress(`https://${USER}:${PASSWORD}@probe-test.fa.em2.oraclecloud.com`),
    false,
  );
  assert.equal(isAllowedAddress(`https://${USER}@probe-test.fa.em2.oraclecloud.com`), false);
  assert.equal(isAllowedAddress('not an address'), false);
  assert.equal(isAllowedAddress(''), false);
  assert.equal(isAllowedAddress(null), false);

  assert.equal(isAllowedAddress(normaliseAddress(`${POD}/hcmRestApi/x?y=1`)), true);
  assert.equal(
    isAllowedAddress(normaliseAddress('http://probe-test.fa.em2.oraclecloud.com')),
    false,
  );
});

test('classifyBytes reads the kind of a file from its first bytes', () => {
  assert.equal(classifyBytes(PDF), 'pdf');
  assert.equal(classifyBytes(DOCX), 'zip');
  assert.equal(classifyBytes(Buffer.from([0x50, 0x4b, 0x05, 0x06, 0, 0])), 'zip');
  assert.equal(classifyBytes(OLE), 'ole');
  assert.equal(classifyBytes(RTF), 'rtf');
  assert.equal(classifyBytes(TXT), 'text');
  assert.equal(classifyBytes(Buffer.from('Tərcümeyi-hal: təcrübə, təhsil\r\n', 'utf8')), 'text');
  assert.equal(classifyBytes(Buffer.from('<html><body>Sign in</body></html>')), 'text');
  assert.equal(
    classifyBytes(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])),
    'other',
  );
  assert.equal(classifyBytes(Buffer.from([0x50, 0x4b, 0x00, 0x00])), 'other');
  assert.equal(classifyBytes(Buffer.from('%PDF')), 'text');
  assert.equal(classifyBytes(Buffer.alloc(0)), 'empty');
  assert.equal(classifyBytes(new Uint8Array(PDF)), 'pdf');
  assert.equal(classifyBytes(undefined), 'empty');
});

test('what a candidate can influence is printed only as a word from a fixed list', () => {
  assert.equal(extensionOf(PERSON.file), 'pdf');
  assert.equal(extensionOf('Sentinel Leyla résumé.DOCX'), 'docx');
  assert.equal(extensionOf('leyla.sentinel'), '(other)');
  assert.equal(extensionOf('Leyla Sentinel'), '(none)');
  assert.equal(extensionOf('trailing.'), '(none)');
  assert.equal(extensionOf(null), '(none)');

  assert.equal(safeContentType(`application/pdf; name="${PERSON.file}"`), 'application/pdf');
  assert.equal(safeContentType('TEXT/PLAIN; charset=utf-8'), 'text/plain');
  assert.equal(safeContentType('application/x-leyla-sentinel'), 'application/(other)');
  assert.equal(safeContentType('leyla/sentinel'), '(other)');
  assert.equal(safeContentType(PERSON.name), '(other)');
  assert.equal(safeContentType(''), '(none)');
  assert.equal(safeContentType(null), '(none)');
});

test('a label is printed only when the operator listed it, and in the operator spelling', () => {
  const known = parseKnownLabels(
    ' To be Reviewed | hr / manager   screens|IRC_CANDIDATE_RESUME|Müsahibə||',
  );
  assert.equal(known.size, 4);
  assert.equal(safeLabel('To be Reviewed', known), 'To be Reviewed');
  // The text printed is the operator's, never the text of the answer.
  assert.equal(safeLabel('  HR / Manager   Screens ', known), 'hr / manager screens');
  assert.equal(safeLabel('irc_candidate_resume', known), 'IRC_CANDIDATE_RESUME');
  assert.equal(safeLabel('Müsahibə', known), 'Müsahibə');

  // Nothing in its shape tells a label from a name, so what is not listed is never printed.
  for (const value of [
    PERSON.name,
    'Leyla',
    'Sentinel',
    'Leyla Sentinel CV',
    'Leyla_Sentinel_CV',
    'LEYLA_SENTINEL',
    "Seán O'Brien CV",
    'Reviewed',
    PERSON.email,
    PERSON.file,
    'Application 300000555000001',
    `${POD}/x`,
    'x'.repeat(61),
    '',
  ]) {
    assert.equal(safeLabel(value, known), null, `"${value}" must not be printed`);
    assert.equal(safeLabel(value), null);
  }
  assert.equal(safeLabel(7, known), null);
  assert.equal(safeLabel('To be Reviewed'), null);
  // The one way a name could be printed, and what these tests do not guard against: the
  // operator typed that name into ORACLE_PROBE_KNOWN_LABELS.
  assert.equal(safeLabel(PERSON.name, parseKnownLabels(PERSON.name)), PERSON.name);
  // A listed label that holds a value the probe keeps as sensitive is still dropped.
  assert.equal(
    safeLabel('Phase REQ-7', parseKnownLabels('Phase REQ-7'), (text) =>
      text.toLowerCase().includes('req-7'),
    ),
    null,
  );
});

test('parseKnownLabels takes label names and refuses what does not look like one', () => {
  assert.equal(parseKnownLabels(undefined).size, 0);
  assert.equal(parseKnownLabels('').size, 0);
  assert.equal(parseKnownLabels(' | | ').size, 0);
  assert.deepEqual([...parseKnownLabels('New|Screening|new').values()], ['new', 'Screening']);
  assert.equal(parseKnownLabels(PERSON.email), null);
  assert.equal(parseKnownLabels(`New|${PERSON.file}`), null);
  assert.equal(parseKnownLabels('Stage 300000555000005'), null);
  assert.equal(parseKnownLabels(`New|${POD}`), null);
  assert.equal(parseKnownLabels('x'.repeat(61)), null);
  assert.equal(parseKnownLabels(['New']), null);
  assert.equal(
    parseKnownLabels(Array.from({ length: 101 }, (_, i) => `Label ${i}`).join('|')),
    null,
  );
  assert.equal(
    parseKnownLabels(Array.from({ length: 100 }, (_, i) => `Label ${i}`).join('|')).size,
    100,
  );
});

test('the TEST environment: a test-style host name and the word of the operator', () => {
  for (const host of [
    'probe-test.fa.em2.oraclecloud.com',
    'abcd-dev1.fa.em2.oraclecloud.com',
    'fa-abcd-test-saasfaprod1.fa.ocs.oraclecloud.com',
    'abcd-STAGE.fa.em2.oraclecloud.com',
    'abcd-uat2.fa.em2.oraclecloud.com',
  ]) {
    assert.equal(hostLabelOf(host), 'test_style', host);
  }
  for (const host of [
    'parallaxco.fa.em2.oraclecloud.com',
    'fa-abcd-saasfaprod1.fa.ocs.oraclecloud.com',
    'contest.fa.em2.oraclecloud.com',
    'devices.fa.em2.oraclecloud.com',
    'abcd.test.oraclecloud.com',
  ]) {
    assert.equal(hostLabelOf(host), 'no_test_label', host);
  }

  const testHost = 'probe-test.fa.em2.oraclecloud.com';
  const otherHost = 'parallaxco.fa.em2.oraclecloud.com';
  assert.deepEqual(testPodConfirmation(testHost, 'yes'), { ok: true, hostLabel: 'test_style' });
  assert.deepEqual(testPodConfirmation(testHost, ' YES '), { ok: true, hostLabel: 'test_style' });
  for (const value of [undefined, '', 'no', 'y', 'true', '1', 'yes please', 7]) {
    assert.equal(testPodConfirmation(testHost, value).ok, false);
    assert.equal(testPodConfirmation(otherHost, value).ok, false);
  }
  // "yes" is not enough for a host name without a test-style word.
  assert.deepEqual(testPodConfirmation(otherHost, 'yes'), {
    ok: false,
    hostLabel: 'no_test_label',
  });
  assert.deepEqual(testPodConfirmation(otherHost, 'yes-host-has-no-test-label'), {
    ok: true,
    hostLabel: 'no_test_label',
  });
  assert.equal(testPodConfirmation(testHost, 'yes-host-has-no-test-label').ok, true);
});

test('isBlockedAddress: private, loopback, link-local and reserved addresses are not public', () => {
  for (const ip of [
    '10.1.2.3',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.10',
    '100.64.0.1',
    '0.0.0.0',
    '198.18.0.1',
    '203.0.113.7',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    '::ffff:10.0.0.1',
    '::ffff:7f00:1',
    '64:ff9b::a00:1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'ff02::1',
    '2001:db8::1',
    '2002:0a00:0001::1',
    'not-an-address',
    '',
    undefined,
  ]) {
    assert.equal(isBlockedAddress(ip), true, String(ip));
  }
  for (const ip of [
    '8.8.8.8',
    '172.32.0.1',
    '192.169.0.1',
    '100.128.0.1',
    '2606:4700::1111',
    '::ffff:8.8.8.8',
  ]) {
    assert.equal(isBlockedAddress(ip), false, ip);
  }
});

test('the ceiling of 50 applications cannot be raised', async (t) => {
  assert.equal(clampMaxApplications(undefined), 25);
  assert.equal(clampMaxApplications(10), 10);
  assert.equal(clampMaxApplications('10'), 10);
  assert.equal(clampMaxApplications(50), 50);
  assert.equal(clampMaxApplications(51), 50);
  assert.equal(clampMaxApplications('5000'), 50);
  assert.equal(clampMaxApplications(Number.MAX_SAFE_INTEGER), 50);
  assert.equal(clampMaxApplications(0), 25);
  assert.equal(clampMaxApplications(-4), 25);
  assert.equal(clampMaxApplications(2.5), 25);
  assert.equal(clampMaxApplications('many'), 25);

  assert.equal(readConfig(ENV).maxApplications, 25);
  assert.equal(readConfig({ ...ENV, ORACLE_PROBE_MAX_APPLICATIONS: '9999' }).maxApplications, 50);
  assert.equal(readConfig({ ...ENV, ORACLE_PROBE_MAX_APPLICATIONS: '7' }).maxApplications, 7);
  assert.match(readConfig({ ...ENV, ORACLE_PROBE_MAX_APPLICATIONS: 'all' }).error, /whole number/);

  // 60 applications, and a fake that hands back all of them whatever limit it is given.
  const fake = await startFake({ seed: manySeed(60), ignoreLimit: true });
  t.after(fake.close);
  const report = await probe(fake, { maxApplications: 5000 });
  assert.equal(report.maxApplications, 50);
  assert.match(fake.requests[3].rawQuery, /&limit=50&/);
  assert.equal(stepOf(report, 'list_rowmatch').count, 60);
  assert.equal(stepOf(report, 'list_rowmatch').returnedMoreThanAsked, true);
  assert.equal(stepOf(report, 'attachments').applicationsRead, 50);
  const read = new Set(
    fake.requests.filter((r) => r.path.endsWith('/child/attachments')).map((r) => r.path),
  );
  assert.equal(read.size, 50);
});

// ---------------------------------------------------------------------------------------------
// The run, end to end
// ---------------------------------------------------------------------------------------------

test('happy path: the nine steps against the fake Oracle', async (t) => {
  const fake = await startFake();
  t.after(fake.close);
  const report = await probe(fake);

  assert.equal(report.ok, true);
  assert.equal(report.target, 'test_loopback');
  assert.equal(report.hostLabel, null);
  assert.equal(report.maxApplications, 25);
  assert.equal(report.knownLabelsListed, 8);
  assert.equal(report.frameworkVersion, '4');
  assert.equal(report.requests, 19);
  assert.equal(fake.requests.length, 19);
  // The report says itself what it does not settle.
  assert.deepEqual(report.notCovered, ['oauth_sign_in', 'region']);
  assert.deepEqual(report.partlyCovered, [
    'withdrawn_and_purged_shapes',
    'cv_only_on_candidate_profile',
  ]);
  for (const step of report.steps.slice(0, 8)) assert.equal(typeof step.elapsedMs, 'number');

  assert.deepEqual(pick(stepOf(report, 'sign_in'), ['ok', 'status', 'note', 'seesRequisitions']), {
    ok: true,
    status: 200,
    note: 'signed_in',
    seesRequisitions: true,
  });

  assert.deepEqual(
    pick(stepOf(report, 'find_requisition'), [
      'ok',
      'status',
      'note',
      'found',
      'fieldsReturned',
      'fieldsMissing',
      'retriedWithoutTitle',
    ]),
    {
      ok: true,
      status: 200,
      note: 'found',
      found: '1',
      fieldsReturned: ['RequisitionId', 'RequisitionNumber', 'Title', 'StateName', 'PhaseName'],
      fieldsMissing: [],
      retriedWithoutTitle: false,
    },
  );

  assert.deepEqual(pick(stepOf(report, 'estimate'), ['ok', 'status', 'note', 'totalResults']), {
    ok: true,
    status: 200,
    note: 'estimate_returned',
    totalResults: 5,
  });

  const list = stepOf(report, 'list_rowmatch');
  assert.deepEqual(pick(list, ['ok', 'status', 'note', 'count', 'hasMore', 'rowsWithoutId']), {
    ok: true,
    status: 200,
    note: 'listed',
    count: 5,
    hasMore: false,
    rowsWithoutId: 0,
  });
  assert.deepEqual(list.fieldsReturned, [
    'JobApplicationId',
    'CandidatePersonId',
    'ConfirmedFlag',
    'DisqualifiedFlag',
    'InternalFlag',
    'StateName',
    'PhaseName',
    'JobApplicationDate',
    'LastUpdateDate',
  ]);
  assert.deepEqual(list.fieldsMissing, []);
  assert.deepEqual(list.flags, {
    ConfirmedFlag: { true: 4, false: 1 },
    DisqualifiedFlag: { true: 1, false: 4 },
    InternalFlag: { true: 1, false: 4 },
  });
  assert.deepEqual(list.stateNames, {
    'Rejected by Employer': 1,
    'To be Reviewed': 3,
    'Withdrawn by Candidate': 1,
  });
  assert.deepEqual(list.phaseNames, { New: 3, Screening: 2 });
  assert.deepEqual(list.labelsWithheld, { stateNames: 0, phaseNames: 0 });
  assert.ok(Object.values(list.blankValues).every((count) => count === 0));
  assert.deepEqual(Object.keys(list.blankValues), list.fieldsReturned);
  assert.deepEqual(list.dateShapes, {
    JobApplicationDate: { date_time_offset: 5 },
    LastUpdateDate: { date_time_utc: 5 },
  });
  assert.deepEqual(list.selfLinkKey, { plainId: 5, otherKey: 0, noSelfLink: 0 });
  // The flag conditions of the import: this fake takes true/false and refuses 'Y'/'N'.
  // Three of the five rows are confirmed and not disqualified.
  assert.deepEqual(list.flagFilter, [
    { form: 'true_false', status: 200, note: 'accepted', count: 3, matchesListedRows: true },
    { form: 'y_n', status: 400, note: 'bad_request', count: null, matchesListedRows: null },
  ]);
  assert.deepEqual(list.flagFilterAccepted, ['true_false']);

  assert.deepEqual(pick(stepOf(report, 'list_semicolon'), ['ok', 'status', 'note']), {
    ok: true,
    status: 400,
    note: 'refused_as_expected',
  });

  assert.deepEqual(
    pick(stepOf(report, 'list_offset'), [
      'ok',
      'status',
      'note',
      'pageSize',
      'firstPageCount',
      'secondPageCount',
      'repeated',
      'ascending',
    ]),
    {
      ok: true,
      status: 200,
      note: 'too_few_rows_to_tell',
      pageSize: 5,
      firstPageCount: 5,
      secondPageCount: 0,
      repeated: false,
      ascending: true,
    },
  );

  const attachments = stepOf(report, 'attachments');
  assert.deepEqual(
    pick(attachments, [
      'ok',
      'status',
      'note',
      'applicationsRead',
      'applicationsFailed',
      'applicationsWithoutFile',
      'attachmentsSeen',
      'fileAttachments',
      'moreThanOnePage',
    ]),
    {
      ok: true,
      status: 200,
      note: 'read',
      applicationsRead: 5,
      applicationsFailed: 0,
      applicationsWithoutFile: 1,
      attachmentsSeen: 8,
      fileAttachments: 6,
      moreThanOnePage: 0,
    },
  );
  assert.deepEqual(attachments.statuses, { 200: 5 });
  assert.deepEqual(
    pick(attachments, ['fieldList', 'readsWithoutFieldList', 'rowsWithoutLinks', 'labelsWithheld']),
    {
      fieldList: 'accepted',
      readsWithoutFieldList: 0,
      rowsWithoutLinks: 0,
      labelsWithheld: { categoryNames: 0 },
    },
  );
  assert.deepEqual(attachments.linkSource, { childLink: 5, selfLink: 0, builtById: 0 });
  assert.deepEqual(attachments.fieldsReturned, [
    'AttachedDocumentId',
    'CategoryName',
    'DatatypeCode',
    'FileName',
    'UploadedFileContentType',
    'UploadedFileLength',
    'FileUrl',
    'DmDocumentId',
    'DmVersionNumber',
    'LastUpdateDate',
  ]);
  assert.deepEqual(attachments.categoryNames, {
    IRC_CANDIDATE_COVERLETTER: 1,
    IRC_CANDIDATE_RESUME: 4,
    MISC: 3,
  });
  assert.deepEqual(attachments.datatypeCodes, { FILE: 6, TEXT: 1, WEB_PAGE: 1 });
  assert.deepEqual(attachments.contentTypes, {
    'application/(other)': 1,
    'application/msword': 1,
    'application/pdf': 1,
    [DOCX_TYPE]: 1,
    'image/jpeg': 1,
    'text/plain': 1,
  });
  assert.deepEqual(attachments.extensions, {
    '(none)': 1,
    '(other)': 1,
    doc: 1,
    docx: 1,
    pdf: 1,
    txt: 1,
  });
  assert.deepEqual(attachments.sizes, {
    under_1_mb: 2,
    from_1_to_5_mb: 1,
    from_5_to_10_mb: 1,
    over_10_mb: 1,
    no_length: 1,
  });
  assert.deepEqual(attachments.enclosureLink, {
    advertised: 6,
    notAdvertised: 0,
    onAnotherHost: 0,
  });
  assert.deepEqual(attachments.fileUrl, {
    absent: 1,
    relative: 3,
    sameHost: 1,
    otherOracleCloudHost: 0,
    otherHost: 1,
    unreadable: 0,
  });

  const download = stepOf(report, 'download');
  assert.deepEqual(
    pick(download, [
      'ok',
      'status',
      'note',
      'readAgainFirst',
      'fullReadForLinks',
      'lengthStated',
      'delivered',
    ]),
    {
      ok: true,
      status: 200,
      note: 'delivered',
      readAgainFirst: true,
      fullReadForLinks: 'not_needed',
      lengthStated: true,
      delivered: ['enclosure_link', 'file_url_with_sign_in', 'file_contents_base64'],
    },
  );
  const received = {
    attempted: true,
    delivered: true,
    status: 200,
    note: 'file_received',
    redirected: false,
    redirectSameHost: null,
    redirectToOracleCloud: null,
    contentType: 'application/pdf',
    bytes: PDF.length,
    matchesLength: true,
    kind: 'pdf',
    tooLarge: false,
  };
  assert.deepEqual(download.routes, [
    { route: 'enclosure_link', ...received },
    { route: 'file_url_with_sign_in', ...received },
    {
      route: 'file_url_without_sign_in',
      ...received,
      delivered: false,
      status: 401,
      note: 'sign_in_refused',
      contentType: 'text/html',
      bytes: null,
      matchesLength: null,
      kind: null,
    },
    {
      route: 'file_contents_base64',
      ...received,
      contentType: 'application/json',
      builtByHand: false,
    },
  ]);

  assert.deepEqual(stepOf(report, 'signals'), {
    step: 'signals',
    ok: true,
    status: null,
    note: 'none_seen',
    headerNames: [],
    otherRateLimitStyleHeaders: 0,
    throttled429: 0,
    unavailable503: 0,
  });

  // What the fake was asked, word for word.
  const api = fake.requests.filter((request) => request.path.startsWith(BASE_PATH));
  assert.equal(api.length, 17);
  for (const request of api) {
    assert.equal(request.headers['rest-framework-version'], '4');
    assert.equal(request.headers.authorization, BASIC);
  }
  const requisitionsPath = `${BASE_PATH}/recruitingJobRequisitions`;
  const applicationsPath = `${BASE_PATH}/recruitingJobApplications`;
  const applicationFields =
    'JobApplicationId,CandidatePersonId,ConfirmedFlag,DisqualifiedFlag,InternalFlag,' +
    'StateName,PhaseName,JobApplicationDate,LastUpdateDate';
  const flagQuery = (conditions) =>
    `${applicationsPath}?q=RequisitionId=${REQ_ID}%20and%20JobApplicationId%20%3E%200` +
    `%20and%20${conditions}` +
    '&orderBy=JobApplicationId:asc&limit=25&fields=JobApplicationId&onlyData=true';
  assert.deepEqual(
    fake.requests.slice(0, 9).map((request) => `${request.path}?${request.rawQuery}`),
    [
      `${requisitionsPath}?limit=1&onlyData=true&fields=RequisitionId`,
      `${requisitionsPath}?finder=findByRequisitionNumber;RequisitionNumber=${REQ_NUMBER}` +
        '&fields=RequisitionId,RequisitionNumber,Title,StateName,PhaseName&limit=2&onlyData=true',
      `${applicationsPath}?q=RequisitionId=${REQ_ID}&limit=1&totalResults=true` +
        '&fields=JobApplicationId&onlyData=true',
      `${applicationsPath}?q=RequisitionId=${REQ_ID}%20and%20JobApplicationId%20%3E%200` +
        `&orderBy=JobApplicationId:asc&limit=25&fields=${applicationFields}`,
      flagQuery('ConfirmedFlag=true%20and%20DisqualifiedFlag=false'),
      // A URL writes the quote mark as %27 on the wire.
      flagQuery('ConfirmedFlag=%27Y%27%20and%20DisqualifiedFlag=%27N%27'),
      `${applicationsPath}?q=RequisitionId=${REQ_ID};JobApplicationId%20%3E%200` +
        '&orderBy=JobApplicationId:asc&limit=1&fields=JobApplicationId&onlyData=true',
      `${applicationsPath}?q=RequisitionId=${REQ_ID}` +
        '&orderBy=JobApplicationId:asc&limit=5&offset=0&fields=JobApplicationId&onlyData=true',
      `${applicationsPath}?q=RequisitionId=${REQ_ID}` +
        '&orderBy=JobApplicationId:asc&limit=5&offset=5&fields=JobApplicationId&onlyData=true',
    ],
  );

  // The attachments are read with a field list: no file contents, no uploader, no description,
  // and the links are kept (no onlyData).
  const attachmentReads = fake.requests.filter((r) => r.path.endsWith('/child/attachments'));
  assert.equal(attachmentReads.length, 6);
  for (const request of attachmentReads) {
    assert.equal(
      request.rawQuery,
      'fields=AttachedDocumentId,CategoryName,DatatypeCode,FileName,UploadedFileContentType,' +
        'UploadedFileLength,FileUrl,DmDocumentId,DmVersionNumber,LastUpdateDate',
    );
  }

  // The download: one attachment only, the oldest application's file.
  const first = `${applicationsPath}/300000555000001/child/attachments`;
  const lastFive = fake.requests.slice(-5);
  assert.equal(lastFive[0].path, first);
  assert.equal(lastFive[1].path, `${first}/00020000000EACED300000888000001/enclosure/FileContents`);
  assert.match(lastFive[1].headers.accept, /application\/octet-stream/);
  assert.match(lastFive[2].path, /^\/content\/conn\//);
  assert.equal(lastFive[2].headers.authorization, BASIC);
  assert.equal(lastFive[3].path, lastFive[2].path);
  assert.equal(lastFive[3].headers.authorization, undefined);
  assert.equal(lastFive[3].headers['rest-framework-version'], undefined);
  assert.equal(lastFive[4].path, `${first}/00020000000EACED300000888000001`);
  assert.equal(lastFive[4].rawQuery, 'fields=FileContents&onlyData=true');

  // The summary for the operator names every step and the result.
  const summary = renderSummary(report);
  for (const name of STEP_NAMES) assert.ok(summary.includes(name));
  assert.match(summary, /PASS: steps 1, 2, 4 and 7 succeeded/);
  assert.match(summary, /Target: the stand-in used by the tests/);
  assert.match(summary, /flag filter accepted as: true_false/);
  assert.match(summary, /Not settled by this probe: sign-in by OAuth and region/);
});

test('the flag filter of the import: each spelling is tried and only status and count are kept', async (t) => {
  const yn = await startFake({ flagForms: ['y_n'] });
  const both = await startFake({ flagForms: ['true_false', 'y_n'] });
  const neither = await startFake({ flagForms: [] });
  const ignored = await startFake({ flagFilterIgnored: true });
  for (const fake of [yn, both, neither, ignored]) t.after(fake.close);

  const accepted = { status: 200, note: 'accepted', count: 3, matchesListedRows: true };
  const refused = { status: 400, note: 'bad_request', count: null, matchesListedRows: null };

  const first = stepOf(await probe(yn), 'list_rowmatch');
  assert.deepEqual(first.flagFilter, [
    { form: 'true_false', ...refused },
    { form: 'y_n', ...accepted },
  ]);
  assert.deepEqual(first.flagFilterAccepted, ['y_n']);

  const second = stepOf(await probe(both), 'list_rowmatch');
  assert.deepEqual(second.flagFilterAccepted, ['true_false', 'y_n']);

  // Neither spelling works: the list itself still counts, and the run is not failed for it.
  const third = await probe(neither);
  assert.deepEqual(stepOf(third, 'list_rowmatch').flagFilter, [
    { form: 'true_false', ...refused },
    { form: 'y_n', ...refused },
  ]);
  assert.deepEqual(stepOf(third, 'list_rowmatch').flagFilterAccepted, []);
  assert.equal(stepOf(third, 'list_rowmatch').ok, true);
  assert.equal(third.ok, true);
  assert.match(renderSummary(third), /flag filter accepted as: neither form/);

  // A filter that is accepted but not applied shows in the count.
  const fourth = stepOf(await probe(ignored), 'list_rowmatch');
  assert.deepEqual(fourth.flagFilter[0], {
    form: 'true_false',
    status: 200,
    note: 'accepted',
    count: 5,
    matchesListedRows: false,
  });

  // When the list was cut at the limit, the two counts cannot be compared.
  const cut = stepOf(await probe(both, { maxApplications: 2 }), 'list_rowmatch');
  assert.deepEqual(pick(cut, ['count', 'hasMore']), { count: 2, hasMore: true });
  assert.deepEqual(pick(cut.flagFilter[0], ['note', 'count', 'matchesListedRows']), {
    note: 'accepted',
    count: 2,
    matchesListedRows: null,
  });
});

test('blank values: a row that came back with empty fields is counted per field', async (t) => {
  const seed = standardSeed();
  const blanked = seed.applications.find((row) => row.JobApplicationId === 300000555000003);
  blanked.CandidatePersonId = null;
  blanked.StateName = '';
  blanked.JobApplicationDate = null;
  const fake = await startFake({ seed });
  t.after(fake.close);
  const list = stepOf(await probe(fake), 'list_rowmatch');
  assert.deepEqual(list.blankValues, {
    JobApplicationId: 0,
    CandidatePersonId: 1,
    ConfirmedFlag: 0,
    DisqualifiedFlag: 0,
    InternalFlag: 0,
    StateName: 1,
    PhaseName: 0,
    JobApplicationDate: 1,
    LastUpdateDate: 0,
  });
  assert.equal(list.stateNames['(none)'], 1);
  assert.deepEqual(list.dateShapes.JobApplicationDate, { date_time_offset: 4, none: 1 });
});

test('attachments: the field list is asked for; a refusal (400) falls back once', async (t) => {
  const refusing = await startFake({ attachmentFields: 'refused' });
  t.after(refusing.close);
  const report = await probe(refusing);
  assert.equal(report.ok, true);
  const attachments = stepOf(report, 'attachments');
  assert.deepEqual(
    pick(attachments, [
      'ok',
      'status',
      'fieldList',
      'applicationsRead',
      'applicationsFailed',
      'readsWithoutFieldList',
      'fileAttachments',
    ]),
    {
      ok: true,
      status: 200,
      fieldList: 'refused',
      applicationsRead: 5,
      applicationsFailed: 0,
      readsWithoutFieldList: 5,
      fileAttachments: 6,
    },
  );
  // One refused read with the list, then every read without it: 1 + 5 in step 7, 1 before the
  // download.
  const reads = refusing.requests.filter((r) => r.path.endsWith('/child/attachments'));
  assert.deepEqual(
    reads.map((r) => r.rawQuery.startsWith('fields=')),
    [true, false, false, false, false, false, false],
  );
  assert.equal(stepOf(report, 'download').fullReadForLinks, 'not_needed');
  assert.equal(stepOf(report, 'download').ok, true);

  // A 400 that the field list did not cause: one fallback in the whole run, then no more.
  const seed = standardSeed();
  const broken = await startFake({ seed, attachments: 'error400' });
  t.after(broken.close);
  const other = await probe(broken);
  const failed = stepOf(other, 'attachments');
  assert.deepEqual(pick(failed, ['ok', 'status', 'note', 'fieldList', 'applicationsFailed']), {
    ok: false,
    status: 400,
    note: 'bad_request',
    fieldList: 'fallback_failed',
    applicationsFailed: 5,
  });
  assert.equal(broken.requests.filter((r) => r.path.endsWith('/child/attachments')).length, 6);
});

test('attachments: when the field list costs the links, ONE application is read in full', async (t) => {
  const fake = await startFake({ fieldsDropLinks: true });
  t.after(fake.close);
  const report = await probe(fake);
  assert.equal(report.ok, true);
  const attachments = stepOf(report, 'attachments');
  assert.equal(attachments.rowsWithoutLinks, 8);
  assert.deepEqual(attachments.enclosureLink, {
    advertised: 0,
    notAdvertised: 6,
    onAnotherHost: 0,
  });
  const download = stepOf(report, 'download');
  assert.equal(download.fullReadForLinks, 'links_found');
  assert.deepEqual(pick(routeOf(report, 'enclosure_link'), ['attempted', 'delivered', 'kind']), {
    attempted: true,
    delivered: true,
    kind: 'pdf',
  });
  assert.equal(routeOf(report, 'file_contents_base64').builtByHand, false);
  // Exactly one read without the field list, and it is the picked application's.
  const full = fake.requests.filter(
    (r) => r.path.endsWith('/child/attachments') && r.rawQuery === '',
  );
  assert.equal(full.length, 1);
  assert.ok(full[0].path.includes('/300000555000001/'));
});

test('sign-in refused (401): one call, no second try, the rest is skipped', async (t) => {
  const fake = await startFake({ signIn: 'refused' });
  t.after(fake.close);
  const report = await probe(fake);
  assert.equal(report.ok, false);
  assert.deepEqual(pick(stepOf(report, 'sign_in'), ['ok', 'status', 'note']), {
    ok: false,
    status: 401,
    note: 'sign_in_refused',
  });
  for (const step of report.steps.slice(1, 8)) {
    assert.deepEqual(pick(step, ['ok', 'status', 'note']), {
      ok: false,
      status: null,
      note: 'skipped_stopped_after_401',
    });
  }
  assert.equal(fake.requests.length, 1);
  assert.equal(report.requests, 1);
  assert.match(renderSummary(report), /NOT COMPLETE/);
  // Only user name + password is tried. The output says so, and that OAuth is not settled here.
  assert.match(renderSummary(report), /user name \+ password refused; OAuth is not tried/);
  assert.ok(report.notCovered.includes('oauth_sign_in'));
});

test('a wrong password is told apart from an account without the right (403)', async (t) => {
  const wrong = await startFake();
  const forbidden = await startFake({ signIn: 'forbidden' });
  t.after(wrong.close);
  t.after(forbidden.close);

  const refused = await probe(wrong, { password: 'not-the-password' });
  assert.deepEqual(pick(stepOf(refused, 'sign_in'), ['ok', 'status', 'note']), {
    ok: false,
    status: 401,
    note: 'sign_in_refused',
  });
  assert.equal(wrong.requests.length, 1);

  const report = await probe(forbidden);
  assert.deepEqual(pick(stepOf(report, 'sign_in'), ['ok', 'status', 'note']), {
    ok: false,
    status: 403,
    note: 'forbidden',
  });
  assert.equal(stepOf(report, 'find_requisition').note, 'skipped_not_signed_in');
  assert.equal(forbidden.requests.length, 1);
  assert.equal(report.ok, false);
});

test('200 with no items: the account signs in but sees nothing', async (t) => {
  const fake = await startFake({ emptyScope: true });
  t.after(fake.close);
  const report = await probe(fake);
  assert.deepEqual(pick(stepOf(report, 'sign_in'), ['ok', 'status', 'note', 'seesRequisitions']), {
    ok: true,
    status: 200,
    note: 'empty_scope',
    seesRequisitions: false,
  });
  assert.deepEqual(pick(stepOf(report, 'find_requisition'), ['ok', 'status', 'note', 'found']), {
    ok: false,
    status: 200,
    note: 'not_found_or_not_visible',
    found: '0',
  });
  for (const name of ['estimate', 'list_rowmatch', 'list_semicolon', 'list_offset']) {
    assert.equal(stepOf(report, name).note, 'skipped_no_requisition');
  }
  assert.equal(report.ok, false);
  assert.equal(fake.requests.length, 2);
});

test('find_requisition: more than one match, and a refused Title field', async (t) => {
  const twice = standardSeed();
  twice.requisitions.push({ ...twice.requisitions[0], RequisitionId: 300000111222444 });
  const two = await startFake({ seed: twice });
  const noTitle = await startFake({ titleUnknown: true });
  t.after(two.close);
  t.after(noTitle.close);

  const ambiguous = await probe(two);
  assert.deepEqual(pick(stepOf(ambiguous, 'find_requisition'), ['ok', 'note', 'found']), {
    ok: false,
    note: 'more_than_one_match',
    found: 'more',
  });
  assert.equal(stepOf(ambiguous, 'list_rowmatch').note, 'skipped_no_requisition');

  const retried = await probe(noTitle);
  assert.deepEqual(
    pick(stepOf(retried, 'find_requisition'), [
      'ok',
      'status',
      'note',
      'found',
      'fieldsMissing',
      'retriedWithoutTitle',
    ]),
    {
      ok: true,
      status: 200,
      note: 'found',
      found: '1',
      fieldsMissing: ['Title'],
      retriedWithoutTitle: true,
    },
  );
  assert.equal(retried.ok, true);
});

test('the ";" filter is refused with 400 while the "and" form works', async (t) => {
  const strict = await startFake();
  const lenient = await startFake({ acceptSemicolon: true });
  t.after(strict.close);
  t.after(lenient.close);

  const report = await probe(strict);
  assert.deepEqual(pick(stepOf(report, 'list_rowmatch'), ['ok', 'status', 'count']), {
    ok: true,
    status: 200,
    count: 5,
  });
  assert.deepEqual(pick(stepOf(report, 'list_semicolon'), ['ok', 'status', 'note']), {
    ok: true,
    status: 400,
    note: 'refused_as_expected',
  });
  const asked = strict.requests
    .filter((request) => request.path.endsWith('/recruitingJobApplications'))
    .map((request) => new URLSearchParams(request.rawQuery).get('q'));
  assert.equal(asked[1], `RequisitionId=${REQ_ID} and JobApplicationId > 0`);
  assert.equal(
    asked[2],
    `RequisitionId=${REQ_ID} and JobApplicationId > 0 and ConfirmedFlag=true and DisqualifiedFlag=false`,
  );
  assert.equal(
    asked[3],
    `RequisitionId=${REQ_ID} and JobApplicationId > 0 and ConfirmedFlag='Y' and DisqualifiedFlag='N'`,
  );
  assert.equal(asked[4], `RequisitionId=${REQ_ID};JobApplicationId > 0`);
  assert.equal(report.ok, true);

  const other = await probe(lenient);
  assert.deepEqual(pick(stepOf(other, 'list_semicolon'), ['ok', 'status', 'note']), {
    ok: true,
    status: 200,
    note: 'accepted',
  });
});

test('list_offset: two pages under the same order, and a repeated row is noticed', async (t) => {
  const good = await startFake();
  const broken = await startFake({ ignoreOffset: true });
  t.after(good.close);
  t.after(broken.close);

  const report = await probe(good, { maxApplications: 4 });
  assert.deepEqual(pick(stepOf(report, 'list_rowmatch'), ['count', 'hasMore']), {
    count: 4,
    hasMore: true,
  });
  assert.deepEqual(
    pick(stepOf(report, 'list_offset'), [
      'ok',
      'note',
      'pageSize',
      'firstPageCount',
      'secondPageCount',
      'repeated',
      'ascending',
    ]),
    {
      ok: true,
      note: 'no_row_repeated',
      pageSize: 2,
      firstPageCount: 2,
      secondPageCount: 2,
      repeated: false,
      ascending: true,
    },
  );

  const repeated = await probe(broken, { maxApplications: 4 });
  assert.deepEqual(pick(stepOf(repeated, 'list_offset'), ['ok', 'note', 'repeated', 'ascending']), {
    ok: true,
    note: 'row_repeated',
    repeated: true,
    ascending: false,
  });
});

test('links: the probe uses the links it is given and says when it built one by hand', async (t) => {
  const fake = await startFake({ fieldsDropLinks: true, attachmentLinks: false });
  t.after(fake.close);
  const report = await probe(fake);
  assert.equal(report.ok, true);
  assert.deepEqual(stepOf(report, 'list_rowmatch').selfLinkKey, {
    plainId: 0,
    otherKey: 0,
    noSelfLink: 5,
  });
  const attachments = stepOf(report, 'attachments');
  assert.deepEqual(attachments.linkSource, { childLink: 0, selfLink: 0, builtById: 5 });
  assert.deepEqual(attachments.enclosureLink, {
    advertised: 0,
    notAdvertised: 6,
    onAnotherHost: 0,
  });
  assert.deepEqual(pick(routeOf(report, 'enclosure_link'), ['attempted', 'delivered', 'note']), {
    attempted: false,
    delivered: false,
    note: 'not_advertised',
  });
  assert.deepEqual(
    pick(routeOf(report, 'file_contents_base64'), [
      'attempted',
      'delivered',
      'builtByHand',
      'kind',
    ]),
    { attempted: true, delivered: true, builtByHand: true, kind: 'pdf' },
  );
  // The one full read of the picked application found no links either: Oracle sends none here.
  assert.equal(attachments.rowsWithoutLinks, 8);
  assert.equal(stepOf(report, 'download').fullReadForLinks, 'still_no_links');
});

test('a failed attachments read fails step 7 and the run', async (t) => {
  const fake = await startFake({ attachments: 'error' });
  t.after(fake.close);
  const report = await probe(fake);
  assert.deepEqual(
    pick(stepOf(report, 'attachments'), [
      'ok',
      'status',
      'note',
      'applicationsRead',
      'applicationsFailed',
    ]),
    { ok: false, status: 500, note: 'server_error', applicationsRead: 0, applicationsFailed: 5 },
  );
  assert.equal(stepOf(report, 'download').note, 'no_file_attachment');
  assert.equal(report.ok, false);
});

test('download: bytes that differ from the stated length are not counted as delivered', async (t) => {
  const seed = standardSeed();
  const oldest = seed.applications.find((row) => row.JobApplicationId === 300000555000001);
  oldest.attachments[0].UploadedFileLength = PDF.length + 7;
  const fake = await startFake({ seed, fileUrl: 'open' });
  t.after(fake.close);
  const report = await probe(fake);
  for (const route of stepOf(report, 'download').routes) {
    assert.deepEqual(
      pick(route, ['delivered', 'status', 'note', 'bytes', 'matchesLength', 'kind']),
      {
        delivered: false,
        status: 200,
        note: 'length_differs',
        bytes: PDF.length,
        matchesLength: false,
        kind: 'pdf',
      },
    );
  }
  assert.deepEqual(pick(stepOf(report, 'download'), ['ok', 'note', 'delivered']), {
    ok: false,
    note: 'no_route_delivered',
    delivered: [],
  });
  // The download step is not one of the four that decide the exit code.
  assert.equal(report.ok, true);
});

test('download: one small file is picked; base64 above the JSON limit ends as too_large', async (t) => {
  const { file, application, requisition } = seedBuilder();
  const oneApplication = (files) => ({
    requisitions: [requisition(REQ_ID)],
    applications: [application(1, [true, false, false], 'To be Reviewed', 'New', files)],
  });
  // A file without a stated length, a large one, then a small one: the small one is used.
  const mixed = await startFake({
    seed: oneApplication([
      file('first.docx', DOCX_TYPE, DOCX, { UploadedFileLength: null }),
      file('second.docx', DOCX_TYPE, DOCX, { UploadedFileLength: 8 * MB }),
      file('third.pdf', 'application/pdf', PDF),
    ]),
  });
  // One file of 4 MB: as base64 inside JSON it is above the 5 MB limit for JSON.
  const large = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(4 * MB, 0x20)]);
  const big = await startFake({
    seed: oneApplication([file('big.pdf', 'application/pdf', large)]),
  });
  t.after(mixed.close);
  t.after(big.close);

  const report = await probe(mixed);
  for (const name of ['enclosure_link', 'file_url_with_sign_in', 'file_contents_base64']) {
    assert.deepEqual(pick(routeOf(report, name), ['delivered', 'bytes', 'kind']), {
      delivered: true,
      bytes: PDF.length,
      kind: 'pdf',
    });
  }
  const downloads = mixed.requests.filter(
    (request) => request.path.includes('/enclosure/') || request.path.startsWith('/content/'),
  );
  assert.equal(downloads.length, 3);
  assert.ok(downloads.every((request) => request.path.includes('300000888000003')));

  const other = await probe(big);
  assert.deepEqual(pick(routeOf(other, 'enclosure_link'), ['delivered', 'bytes', 'kind']), {
    delivered: true,
    bytes: large.length,
    kind: 'pdf',
  });
  assert.deepEqual(
    pick(routeOf(other, 'file_contents_base64'), [
      'delivered',
      'status',
      'note',
      'tooLarge',
      'bytes',
    ]),
    { delivered: false, status: 200, note: 'too_large', tooLarge: true, bytes: null },
  );
});

test('attachments: the size buckets are under 1 MB, 1 to 5, 5 to 10 and over 10', async (t) => {
  const { file, application, requisition } = seedBuilder();
  const lengths = [0, MB - 1, MB, 5 * MB - 1, 5 * MB, 10 * MB, 10 * MB + 1, null];
  const files = lengths.map((UploadedFileLength, i) =>
    file(`file-${i}.pdf`, 'application/pdf', PDF, { UploadedFileLength }),
  );
  const seed = {
    requisitions: [requisition(REQ_ID)],
    applications: [application(1, [true, false, false], 'To be Reviewed', 'New', files)],
  };
  const fake = await startFake({ seed });
  t.after(fake.close);
  const report = await probe(fake);
  assert.deepEqual(stepOf(report, 'attachments').sizes, {
    under_1_mb: 2,
    from_1_to_5_mb: 2,
    from_5_to_10_mb: 2,
    over_10_mb: 1,
    no_length: 1,
  });
});

// ---------------------------------------------------------------------------------------------
// Network rules
// ---------------------------------------------------------------------------------------------

test('a redirect to another host is not followed and no sign-in header reaches it', async (t) => {
  const foreign = await startForeign();
  const fake = await startFake({
    enclosure: 'redirectForeign',
    fileUrl: 'redirectForeign',
    foreignOrigin: foreign.origin,
  });
  t.after(foreign.close);
  t.after(fake.close);

  const report = await probe(fake);
  assert.equal(foreign.requests.length, 0);
  for (const name of ['enclosure_link', 'file_url_with_sign_in', 'file_url_without_sign_in']) {
    assert.deepEqual(
      pick(routeOf(report, name), [
        'attempted',
        'delivered',
        'status',
        'note',
        'redirected',
        'redirectSameHost',
        'redirectToOracleCloud',
        'bytes',
      ]),
      {
        attempted: true,
        delivered: false,
        status: 302,
        note: 'redirect_not_followed',
        redirected: true,
        redirectSameHost: false,
        redirectToOracleCloud: false,
        bytes: null,
      },
    );
  }
  assert.deepEqual(stepOf(report, 'download').delivered, ['file_contents_base64']);
  assert.equal(report.ok, true);
});

test('a redirect that stays on the configured host is followed', async (t) => {
  const fake = await startFake({ enclosure: 'redirectSameHost' });
  t.after(fake.close);
  const report = await probe(fake);
  assert.deepEqual(
    pick(routeOf(report, 'enclosure_link'), [
      'delivered',
      'status',
      'redirected',
      'redirectSameHost',
      'bytes',
      'kind',
    ]),
    {
      delivered: true,
      status: 200,
      redirected: true,
      redirectSameHost: true,
      bytes: PDF.length,
      kind: 'pdf',
    },
  );
});

test('the probe talks to the configured host only, also when a link names another Oracle host', async (t) => {
  const files = await startForeign();
  const seed = standardSeed();
  const oldest = seed.applications.find((row) => row.JobApplicationId === 300000555000001);
  oldest.attachments[0].fileUrl = 'otherHost';
  const fake = await startFake({
    seed,
    publicOrigin: POD,
    filesOrigin: FILES,
    enclosure: 'redirectForeign',
    foreignOrigin: 'https://elsewhere.example.test',
  });
  t.after(files.close);
  t.after(fake.close);

  const log = [];
  const report = await runProbe({
    ...ON_POD,
    fetch: mappedFetch({ [POD]: fake.origin, [FILES]: files.origin }, log),
  });
  assertNothingPersonal(renderJson(report) + renderSummary(report), seed);
  assertFixedNotes(report);
  assert.equal(report.target, 'oracle_cloud_host');
  assert.equal(report.hostLabel, 'test_style');
  assert.equal(report.operatorConfirmedTestPod, true);
  assert.equal(report.ok, true);
  assert.match(
    renderSummary(report),
    /Target: an Oracle host whose name carries a test-style word/,
  );

  // Every call is a GET that does not follow redirects by itself.
  assert.ok(log.every((call) => call.method === 'GET' && call.redirect === 'manual'));
  // The probe talks to the configured host and to no other: not to the host of the redirect,
  // and not to the other Oracle host named in FileUrl.
  assert.ok(log.length > 0);
  assert.ok(log.every((call) => call.origin === POD));
  assert.equal(files.requests.length, 0);
  assert.deepEqual(
    pick(routeOf(report, 'enclosure_link'), [
      'status',
      'note',
      'redirected',
      'redirectToOracleCloud',
    ]),
    { status: 302, note: 'redirect_not_followed', redirected: true, redirectToOracleCloud: false },
  );
  // The link on another Oracle host is counted, and fetched neither with sign-in nor without.
  for (const name of ['file_url_with_sign_in', 'file_url_without_sign_in']) {
    assert.deepEqual(pick(routeOf(report, name), ['attempted', 'delivered', 'status', 'note']), {
      attempted: false,
      delivered: false,
      status: null,
      note: 'file_url_on_another_host',
    });
  }
  assert.deepEqual(stepOf(report, 'attachments').fileUrl, {
    absent: 1,
    relative: 2,
    sameHost: 1,
    otherOracleCloudHost: 2,
    otherHost: 0,
    unreadable: 0,
  });
  assert.deepEqual(stepOf(report, 'download').delivered, ['file_contents_base64']);
});

test('a redirect to another Oracle host is recorded as such and still not followed', async (t) => {
  const files = await startForeign();
  const fake = await startFake({ publicOrigin: POD, fileUrl: 'redirectOracle' });
  t.after(files.close);
  t.after(fake.close);
  const log = [];
  const report = await runProbe({
    ...ON_POD,
    fetch: mappedFetch({ [POD]: fake.origin, [FILES]: files.origin }, log),
  });
  assertNothingPersonal(renderJson(report) + renderSummary(report), fake.seed);
  for (const name of ['file_url_with_sign_in', 'file_url_without_sign_in']) {
    assert.deepEqual(
      pick(routeOf(report, name), [
        'status',
        'note',
        'redirected',
        'redirectSameHost',
        'redirectToOracleCloud',
      ]),
      {
        status: 302,
        note: 'redirect_not_followed',
        redirected: true,
        redirectSameHost: false,
        redirectToOracleCloud: true,
      },
    );
  }
  assert.equal(files.requests.length, 0);
  assert.ok(log.every((call) => call.origin === POD));
});

test('the client itself keeps the sign-in header on the configured host', async () => {
  const calls = [];
  const spy = async (url, init) => {
    calls.push({ url: String(url), ...init });
    return new Response('{"items":[]}', { headers: { 'content-type': 'application/json' } });
  };
  const asked = [];
  const checkAddress = async (hostname) => {
    asked.push(hostname);
    return null;
  };
  const client = createClient({ origin: POD, authorization: BASIC, fetchImpl: spy, checkAddress });

  const home = await client.get(new URL(`${POD}${BASE_PATH}/recruitingJobRequisitions?limit=1`));
  await client.get(new URL(`${POD}/content/conn/x`), { auth: false, as: 'file' });
  const otherOracleHost = await client.get(new URL(`${FILES}/cv/1`));
  const otherOracleFile = await client.get(new URL(`${FILES}/cv/1`), { auth: false, as: 'file' });
  const otherPort = await client.get(new URL(`${POD}:8443/content/conn/x`));
  const elsewhere = await client.get(new URL('https://elsewhere.example.test/x'));
  const plainHttp = await client.get(new URL('http://probe-test.fa.em2.oraclecloud.com/x'));
  const notALink = await client.get(`${POD}${BASE_PATH}/recruitingJobRequisitions`);

  assert.equal(home.status, 200);
  assert.deepEqual(
    calls.map((call) => [new URL(call.url).origin, call.headers.Authorization ?? null]),
    [
      [POD, BASIC],
      [POD, null],
    ],
  );
  assert.deepEqual(
    calls.map((call) => call.headers['REST-Framework-Version'] ?? null),
    ['4', null],
  );
  assert.ok(calls.every((call) => call.method === 'GET' && call.redirect === 'manual'));
  assert.ok(calls.every((call) => call.signal instanceof AbortSignal));
  // Any other host, another Oracle host included, is refused before anything is sent.
  for (const refused of [otherOracleHost, otherOracleFile, otherPort, elsewhere, plainHttp]) {
    assert.deepEqual(pick(refused, ['sent', 'status', 'note']), {
      sent: false,
      status: null,
      note: 'host_not_allowed',
    });
  }
  assert.deepEqual(pick(notALink, ['sent', 'note']), { sent: false, note: 'bad_link' });
  assert.equal(client.seen.requests, 2);
  // The address check is asked before every request that is sent, and for the configured host.
  assert.deepEqual(asked, [
    'probe-test.fa.em2.oraclecloud.com',
    'probe-test.fa.em2.oraclecloud.com',
  ]);
});

test('public addresses only: a host that resolves to a private address is never contacted', async () => {
  const calls = [];
  const spy = async (...args) => {
    calls.push(args);
    throw new Error('must not be called');
  };
  const lookups = {
    private: async () => [{ address: '10.1.2.3', family: 4 }],
    mixed: async () => [
      { address: '8.8.8.8', family: 4 },
      { address: 'fd00::1', family: 6 },
    ],
    loopback: async () => [{ address: '127.0.0.1', family: 4 }],
  };
  for (const lookup of Object.values(lookups)) {
    const report = await runProbe({ ...ON_POD, fetch: spy, lookup });
    assertFixedNotes(report);
    assert.deepEqual(pick(stepOf(report, 'sign_in'), ['ok', 'status', 'note']), {
      ok: false,
      status: null,
      note: 'address_not_public',
    });
    assert.equal(stepOf(report, 'find_requisition').note, 'skipped_not_signed_in');
    assert.equal(report.requests, 0);
    assert.equal(report.ok, false);
  }

  const failing = {
    throws: async () => {
      throw new Error(`getaddrinfo ENOTFOUND probe-test.fa.em2.oraclecloud.com ${PERSON.email}`);
    },
    empty: async () => [],
    oneAddress: async () => ({ address: '8.8.8.8', family: 4 }),
  };
  for (const lookup of Object.values(failing)) {
    const report = await runProbe({ ...ON_POD, fetch: spy, lookup });
    assertNothingPersonal(renderJson(report) + renderSummary(report), standardSeed());
    assert.equal(stepOf(report, 'sign_in').note, 'address_lookup_failed');
    assert.equal(report.requests, 0);
  }
  assert.equal(calls.length, 0);

  // The name is looked up before every request, and all of its addresses are asked for.
  const seen = [];
  const fake = await startFake({ publicOrigin: POD });
  const counting = async (hostname, options) => {
    seen.push([hostname, options]);
    return [{ address: '8.8.8.8', family: 4 }];
  };
  const report = await runProbe({
    ...ON_POD,
    fetch: mappedFetch({ [POD]: fake.origin }),
    lookup: counting,
  });
  await fake.close();
  assert.equal(report.requests, 19);
  assert.equal(seen.length, 19);
  assert.ok(seen.every(([hostname]) => hostname === 'probe-test.fa.em2.oraclecloud.com'));
  assert.ok(seen.every(([, options]) => options.all === true));
});

test('an answer that states a length above the cap is not read at all', async () => {
  let pulled = 0;
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) {
      pulled += 1;
      controller.enqueue(new Uint8Array(1024));
    },
    cancel() {
      cancelled = true;
    },
  });
  const spy = async () =>
    new Response(body, {
      headers: { 'content-type': 'application/pdf', 'content-length': String(11 * MB) },
    });
  const client = createClient({ origin: POD, authorization: BASIC, fetchImpl: spy });
  const answer = await client.get(new URL(`${POD}/content/conn/x`), { as: 'file', cap: 10 * MB });
  assert.deepEqual(pick(answer, ['status', 'note', 'tooLarge', 'bytes', 'head']), {
    status: 200,
    note: 'too_large',
    tooLarge: true,
    bytes: null,
    head: null,
  });
  assert.equal(cancelled, true);
  assert.ok(pulled <= 2, `the body was read (${pulled} pieces)`);
});

test('without the test flag a loopback or foreign address is never contacted', async (t) => {
  const fake = await startFake();
  t.after(fake.close);
  const calls = [];
  const spy = async (...args) => {
    calls.push(args);
    throw new Error('must not be called');
  };
  const settings = { user: USER, password: PASSWORD, requisition: REQ_NUMBER, fetch: spy };
  const attempts = [
    { baseUrl: fake.origin },
    { baseUrl: fake.origin, allowLoopbackForTests: 'true' },
    { baseUrl: fake.origin, allowLoopbackForTests: 1 },
    { baseUrl: fake.origin.replace('127.0.0.1', 'localhost'), allowLoopbackForTests: true },
    { baseUrl: 'http://10.0.0.5:8080', allowLoopbackForTests: true },
    { baseUrl: 'https://127.0.0.1', allowLoopbackForTests: true },
    { baseUrl: 'https://example.test' },
    { baseUrl: 'http://probe-test.fa.em2.oraclecloud.com' },
    { baseUrl: `${POD}:8443`, confirmTestPod: 'yes' },
    { baseUrl: `https://${USER}:${PASSWORD}@probe-test.fa.em2.oraclecloud.com` },
    { baseUrl: undefined },
  ];
  for (const attempt of attempts) {
    const report = await runProbe({ ...settings, ...attempt });
    assert.equal(report.ok, false);
    assert.equal(report.target, null);
    assert.equal(report.requests, 0);
    assert.deepEqual(
      report.steps.map((step) => step.step),
      STEP_NAMES,
    );
    assert.ok(report.steps.every((step) => step.note === 'skipped_address_not_allowed'));
  }
  assert.equal(calls.length, 0);
  assert.equal(fake.requests.length, 0);

  const badSettings = await runProbe({ ...settings, baseUrl: POD, requisition: 'REQ 1;drop' });
  assert.ok(badSettings.steps.every((step) => step.note === 'skipped_settings_not_valid'));
  const badLabels = await runProbe({ ...ON_POD, fetch: spy, knownLabels: PERSON.email });
  assert.ok(badLabels.steps.every((step) => step.note === 'skipped_settings_not_valid'));
  assert.equal(calls.length, 0);
});

test('nothing is sent until the operator has confirmed the TEST environment', async (t) => {
  const fake = await startFake({ publicOrigin: UNLABELLED_POD });
  t.after(fake.close);
  const log = [];
  const settings = {
    user: USER,
    password: PASSWORD,
    requisition: REQ_NUMBER,
    lookup: lookupPublic,
    fetch: mappedFetch({ [POD]: fake.origin, [UNLABELLED_POD]: fake.origin }, log),
  };
  const refused = [
    // A host name with a test-style word still needs the operator's word.
    { baseUrl: POD, hostLabel: 'test_style' },
    { baseUrl: POD, confirmTestPod: '', hostLabel: 'test_style' },
    { baseUrl: POD, confirmTestPod: 'no', hostLabel: 'test_style' },
    { baseUrl: POD, confirmTestPod: true, hostLabel: 'test_style' },
    // A host name without one: what production could look like. "yes" is not enough.
    { baseUrl: UNLABELLED_POD, hostLabel: 'no_test_label' },
    { baseUrl: UNLABELLED_POD, confirmTestPod: 'yes', hostLabel: 'no_test_label' },
  ];
  for (const { hostLabel, ...attempt } of refused) {
    const report = await runProbe({ ...settings, ...attempt });
    assert.equal(report.ok, false);
    assert.equal(report.target, 'oracle_cloud_host');
    assert.equal(report.hostLabel, hostLabel);
    assert.equal(report.operatorConfirmedTestPod, false);
    assert.equal(report.requests, 0);
    assert.ok(report.steps.every((step) => step.note === 'skipped_test_pod_not_confirmed'));
    assert.match(renderSummary(report), /Target: NOT confirmed as the TEST environment/);
    assert.match(renderSummary(report), /NOT COMPLETE/);
  }
  assert.equal(log.length, 0);
  assert.equal(fake.requests.length, 0);

  // The second step, for a TEST environment whose name carries no test-style word. The report
  // and the summary say so, loudly.
  const report = await runProbe({
    ...settings,
    baseUrl: UNLABELLED_POD,
    confirmTestPod: 'yes-host-has-no-test-label',
    knownLabels: KNOWN_LABELS,
  });
  assertNothingPersonal(renderJson(report) + renderSummary(report), fake.seed);
  assert.equal(report.ok, true);
  assert.equal(report.hostLabel, 'no_test_label');
  assert.equal(report.operatorConfirmedTestPod, true);
  assert.match(
    renderSummary(report),
    /Target: an Oracle host whose name carries NO test-style word.*CHECK THIS before the report is used/,
  );
  assert.ok(log.length > 0);
  assert.ok(log.every((call) => call.origin === UNLABELLED_POD));
});

test('what is read is capped: 10 MB for a file, 5 MB for JSON', async (t) => {
  const bigFiles = await startFake({ enclosure: 'tooBigStream', fileUrl: 'tooBigDeclared' });
  const bigList = await startFake({ hugeList: true });
  t.after(bigFiles.close);
  t.after(bigList.close);

  const report = await probe(bigFiles);
  for (const name of ['enclosure_link', 'file_url_with_sign_in', 'file_url_without_sign_in']) {
    assert.deepEqual(
      pick(routeOf(report, name), ['delivered', 'status', 'note', 'tooLarge', 'bytes', 'kind']),
      { delivered: false, status: 200, note: 'too_large', tooLarge: true, bytes: null, kind: null },
    );
  }
  assert.equal(routeOf(report, 'file_contents_base64').delivered, true);

  const other = await probe(bigList);
  assert.deepEqual(pick(stepOf(other, 'list_rowmatch'), ['ok', 'status', 'note']), {
    ok: false,
    status: 200,
    note: 'too_large',
  });
  assert.equal(stepOf(other, 'attachments').note, 'skipped_no_applications');
  assert.equal(other.ok, false);
});

test('deadlines: 15 s for metadata, 60 s for a download; a call that hangs ends as a timeout', async (t) => {
  const asked = [];
  const real = AbortSignal.timeout.bind(AbortSignal);
  let shortened = false;
  t.mock.method(AbortSignal, 'timeout', (ms) => {
    asked.push(ms);
    // Only the first download deadline is shortened, so the test does not wait a minute.
    if (ms === 60_000 && !shortened) {
      shortened = true;
      return real(200);
    }
    return real(ms);
  });
  const fake = await startFake({ enclosure: 'hang' });
  t.after(fake.close);
  const report = await probe(fake);

  assert.deepEqual(
    pick(routeOf(report, 'enclosure_link'), ['attempted', 'delivered', 'status', 'note']),
    {
      attempted: true,
      delivered: false,
      status: null,
      note: 'timeout',
    },
  );
  assert.equal(routeOf(report, 'file_url_with_sign_in').delivered, true);
  assert.deepEqual(
    [...new Set(asked)].sort((a, b) => a - b),
    [15_000, 60_000],
  );
  // The four download routes use the long deadline; everything else uses the short one.
  assert.equal(asked.filter((ms) => ms === 60_000).length, 4);
  assert.equal(asked.filter((ms) => ms === 15_000).length, report.requests - 4);
});

test('signals: throttling headers are reported by name only', async (t) => {
  const fake = await startFake({
    fileUrl: 'throttled',
    headers: {
      'x-ratelimit-remaining': '41',
      'x-leyla-sentinel-quota': PERSON.name,
      'set-cookie': `session=${PERSON.email}`,
    },
  });
  t.after(fake.close);
  const report = await probe(fake);
  const signals = stepOf(report, 'signals');
  assert.deepEqual(pick(signals, ['ok', 'note', 'headerNames', 'throttled429', 'unavailable503']), {
    ok: true,
    note: 'signals_seen',
    headerNames: ['retry-after', 'x-ratelimit-remaining'],
    throttled429: 2,
    unavailable503: 0,
  });
  assert.ok(signals.otherRateLimitStyleHeaders > 0);
  assert.equal(routeOf(report, 'file_url_with_sign_in').note, 'throttled');
});

test('a network failure becomes a fixed word, never the text of the error', async () => {
  const failing = async () => {
    const cause = new Error(`connect ECONNREFUSED 10.1.2.3:443 for ${PERSON.email}`);
    cause.code = 'ECONNREFUSED';
    throw new TypeError(`fetch failed: ${POD}/hcmRestApi?user=${USER}&password=${PASSWORD}`, {
      cause,
    });
  };
  const report = await runProbe({ ...ON_POD, fetch: failing });
  assertNothingPersonal(renderJson(report) + renderSummary(report), standardSeed());
  assertFixedNotes(report);
  assert.deepEqual(pick(stepOf(report, 'sign_in'), ['ok', 'status', 'note']), {
    ok: false,
    status: null,
    note: 'network_error_econnrefused',
  });
  assert.equal(report.ok, false);

  // The same without an error code: still one fixed word.
  const nameless = await runProbe({
    ...ON_POD,
    fetch: async () => {
      throw new Error(`${PERSON.name} <${PERSON.email}> at ${POD}?password=${PASSWORD}`);
    },
  });
  assertNothingPersonal(renderJson(nameless) + renderSummary(nameless), standardSeed());
  assert.equal(stepOf(nameless, 'sign_in').note, 'network_error');
});

// ---------------------------------------------------------------------------------------------
// Output and the command line
// ---------------------------------------------------------------------------------------------

test('leak test: neither the JSON on stdout nor the summary on stderr holds anything personal', async (t) => {
  // This fake ignores `fields`, so every row carries the name and the e-mail, and it puts the
  // name into headers too. It also misuses the label fields. Three of the values give themselves
  // away by their shape: an e-mail as a state, an identifier inside a phase and a file name as a
  // category. The other four are the hard case, a bare name, which looks just like a label: the
  // full name as a state, the family name as a phase, "name + CV" as a category and the name in
  // the shape of a code as a data type. All seven must be withheld.
  const misused = () => {
    const seed = standardSeed();
    const byId = (id) => seed.applications.find((row) => row.JobApplicationId === id);
    byId(300000555000003).StateName = PERSON.email;
    byId(300000555000005).PhaseName = 'Stage 300000555000005';
    byId(300000555000002).attachments[1].CategoryName = PERSON.file;
    byId(300000555000001).StateName = PERSON.name;
    byId(300000555000004).PhaseName = 'Sentinel';
    byId(300000555000004).attachments[0].CategoryName = 'Leyla Sentinel CV';
    byId(300000555000005).attachments[2].DatatypeCode = 'LEYLA_SENTINEL';
    return seed;
  };
  const noisy = {
    publicOrigin: POD,
    ignoreFields: true,
    headers: {
      'x-candidate': PERSON.name,
      'x-leyla-sentinel-ratelimit': PERSON.email,
      'retry-after': '1',
    },
  };
  const scenarios = [
    { options: { ...noisy, fileUrl: 'open' }, code: 0 },
    { options: { ...noisy, signIn: 'refused' }, code: 1 },
    { options: { ...noisy, signIn: 'forbidden' }, code: 1 },
    { options: { ...noisy, emptyScope: true }, code: 1 },
    { options: { ...noisy, attachments: 'error' }, code: 1 },
    { options: { ...noisy, fileUrl: 'redirectOracle', enclosure: 'redirectSameHost' }, code: 0 },
  ];
  // The operator pasted a full REST link from the documentation, and listed the labels the
  // Oracle team gave in writing.
  const env = {
    ...ENV,
    ORACLE_PROBE_URL: `${POD}${BASE_PATH}/recruitingJobRequisitions?limit=1&q=${PERSON.name}`,
    ORACLE_PROBE_KNOWN_LABELS: KNOWN_LABELS,
  };
  for (const scenario of scenarios) {
    const fake = await startFake({ ...scenario.options, seed: misused() });
    t.after(fake.close);
    const log = [];
    const { code, out, err } = await runMain(env, mappedFetch({ [POD]: fake.origin }, log));

    assert.equal(code, scenario.code);
    assert.ok(log.length > 0);
    assert.ok(log.every((call) => call.origin === POD && !call.search.includes('Leyla')));
    const report = JSON.parse(out); // stdout is one JSON object and nothing else
    assert.equal(report.probe, 'oracle-probe');
    assert.equal(report.ok, scenario.code === 0);
    assertFixedNotes(report);
    assert.ok(err.length > 0);
    // One line on what is printed, one on the target, nine steps, the verdict, what is not settled.
    assert.ok(err.split('\n').length <= 14, 'the summary stays short');

    for (const text of [out, err]) {
      assertNothingPersonal(text, fake.seed);
      for (const word of ['Leyla', 'Sentinel', 'example.test']) assert.ok(!text.includes(word));
      assert.ok(!/leyla|sentinel/i.test(text));
    }

    if (scenario.code === 0) {
      // The run really read the personal rows: the counts are all there, and so are the labels
      // the operator listed. The seven misused values are counted as withheld, the bare names
      // among them.
      const list = stepOf(report, 'list_rowmatch');
      assert.equal(list.count, 5);
      assert.deepEqual(list.stateNames, {
        '(withheld)': 2,
        'Rejected by Employer': 1,
        'To be Reviewed': 1,
        'Withdrawn by Candidate': 1,
      });
      assert.deepEqual(list.phaseNames, { '(withheld)': 2, New: 2, Screening: 1 });
      assert.deepEqual(list.labelsWithheld, { stateNames: 2, phaseNames: 2 });
      const attachments = stepOf(report, 'attachments');
      assert.equal(attachments.fileAttachments, 6);
      assert.deepEqual(attachments.categoryNames, {
        '(withheld)': 2,
        IRC_CANDIDATE_COVERLETTER: 1,
        IRC_CANDIDATE_RESUME: 3,
        MISC: 2,
      });
      assert.deepEqual(attachments.labelsWithheld, { categoryNames: 2 });
      assert.deepEqual(attachments.datatypeCodes, { '(other)': 1, FILE: 6, WEB_PAGE: 1 });
      assert.ok(stepOf(report, 'download').delivered.length > 0);
    }
  }

  // Without a list from the operator no label is printed at all: counts only.
  const fake = await startFake({ ...noisy, fileUrl: 'open', seed: misused() });
  t.after(fake.close);
  const { code, out, err } = await runMain(
    { ...env, ORACLE_PROBE_KNOWN_LABELS: '' },
    mappedFetch({ [POD]: fake.origin }),
  );
  assert.equal(code, 0);
  for (const text of [out, err]) {
    assertNothingPersonal(text, fake.seed);
    assert.ok(
      !/leyla|sentinel|to be reviewed|rejected by|withdrawn by|irc_candidate|screening/i.test(text),
    );
  }
  const report = JSON.parse(out);
  assert.equal(report.knownLabelsListed, 0);
  const list = stepOf(report, 'list_rowmatch');
  assert.deepEqual(list.stateNames, { '(withheld)': 5 });
  assert.deepEqual(list.phaseNames, { '(withheld)': 5 });
  assert.deepEqual(list.labelsWithheld, { stateNames: 5, phaseNames: 4 });
  assert.deepEqual(stepOf(report, 'attachments').categoryNames, { '(withheld)': 8 });
  assert.deepEqual(stepOf(report, 'attachments').labelsWithheld, { categoryNames: 5 });
});

test('settings come from the environment only; a mistake gives one line and exit code 2', async (t) => {
  const fake = await startFake();
  t.after(fake.close);

  const missing = await runCli({});
  assert.equal(missing.code, 2);
  assert.equal(missing.stdout, '');
  assert.equal(missing.stderr.trim().split('\n').length, 1);
  assert.match(missing.stderr, /^usage: /);
  for (const name of Object.keys(ENV)) assert.ok(missing.stderr.includes(name));

  const onePresent = await runCli({ ORACLE_PROBE_PASSWORD: PASSWORD });
  assert.equal(onePresent.code, 2);
  assert.match(onePresent.stderr, /^usage: /);
  assert.ok(!onePresent.stderr.includes(PASSWORD));

  // Nothing is read from the command line, so nothing lands in the shell history.
  const withArguments = await runCli({ ...ENV, ORACLE_PROBE_URL: fake.origin }, [
    `--url=${fake.origin}`,
    '--allow-loopback-for-tests',
  ]);
  assert.equal(withArguments.code, 2);
  assert.equal(withArguments.stdout, '');
  assert.match(withArguments.stderr, /^usage: /);

  // No environment variable can switch the loopback stand-in on.
  const loopback = await runCli({
    ...ENV,
    ORACLE_PROBE_URL: fake.origin,
    ORACLE_PROBE_ALLOW_LOOPBACK: '1',
    ORACLE_PROBE_ALLOW_LOOPBACK_FOR_TESTS: 'true',
    ALLOW_LOOPBACK_FOR_TESTS: 'true',
    allowLoopbackForTests: 'true',
    NODE_ENV: 'test',
  });
  assert.equal(loopback.code, 2);
  assert.equal(loopback.stdout, '');
  assert.equal(loopback.stderr.trim().split('\n').length, 1);
  assert.match(loopback.stderr, /ORACLE_PROBE_URL is not an Oracle address/);
  assert.ok(!loopback.stderr.includes('127.0.0.1'));
  assert.ok(!loopback.stderr.includes(PASSWORD));
  assert.equal(fake.requests.length, 0);
});

test('readConfig checks the settings and never repeats a value in its message', () => {
  assert.deepEqual(readConfig({ ...ENV, ORACLE_PROBE_URL: `${POD}${BASE_PATH}/x?limit=1` }), {
    baseUrl: POD,
    user: USER,
    password: PASSWORD,
    requisition: REQ_NUMBER,
    confirmTestPod: 'yes',
    knownLabels: '',
    maxApplications: 25,
  });
  assert.equal(
    readConfig({ ...ENV, ORACLE_PROBE_KNOWN_LABELS: KNOWN_LABELS }).knownLabels,
    KNOWN_LABELS,
  );
  const bad = [
    { ORACLE_PROBE_URL: 'http://probe-test.fa.em2.oraclecloud.com' },
    { ORACLE_PROBE_URL: 'https://example.test/secret-path' },
    { ORACLE_PROBE_URL: `${POD}:8443/secret-path` },
    { ORACLE_PROBE_URL: `https://${USER}:${PASSWORD}@probe-test.fa.em2.oraclecloud.com` },
    { ORACLE_PROBE_USER: 'name:with-colon' },
    { ORACLE_PROBE_REQUISITION: 'REQ 1;RequisitionId=2' },
    { ORACLE_PROBE_MAX_APPLICATIONS: '-5' },
    { ORACLE_PROBE_PASSWORD: '' },
    { ORACLE_PROBE_USER: '   ' },
    { ORACLE_PROBE_CONFIRM_TEST_POD: '' },
    { ORACLE_PROBE_CONFIRM_TEST_POD: 'maybe-later' },
    { ORACLE_PROBE_KNOWN_LABELS: `New|${PERSON.email}` },
    { ORACLE_PROBE_KNOWN_LABELS: 'Stage 300000555000005' },
  ];
  for (const change of bad) {
    const { error } = readConfig({ ...ENV, ...change });
    assert.equal(typeof error, 'string');
    assert.equal(error.split('\n').length, 1);
    for (const value of [...Object.values(change), PASSWORD, USER]) {
      if (value.trim().length > 2) assert.ok(!error.includes(value));
    }
  }
});

test('readConfig asks for the word of the operator that this is the TEST environment', () => {
  // Missing: the usage line names the variable and says what the probe is for.
  const missing = readConfig({ ...ENV, ORACLE_PROBE_CONFIRM_TEST_POD: undefined }).error;
  assert.match(missing, /^usage: /);
  assert.match(missing, /missing: ORACLE_PROBE_CONFIRM_TEST_POD/);
  assert.match(missing, /never production/);

  // A wrong word, on a host name with a test-style word.
  const wrong = readConfig({ ...ENV, ORACLE_PROBE_CONFIRM_TEST_POD: 'ok' }).error;
  assert.match(wrong, /ORACLE_PROBE_CONFIRM_TEST_POD must be "yes"/);
  assert.match(wrong, /never be pointed at production/);

  // A host name without a test-style word: "yes" is refused, and the message says what to do.
  const unlabelled = { ...ENV, ORACLE_PROBE_URL: UNLABELLED_POD };
  const refused = readConfig(unlabelled).error;
  assert.match(refused, /carries no test-style word/);
  assert.match(refused, /never be pointed at production/);
  assert.match(refused, /confirmed in writing/);
  assert.match(refused, /yes-host-has-no-test-label/);
  assert.ok(!refused.includes('parallaxco'));
  assert.equal(refused.split('\n').length, 1);

  const second = readConfig({
    ...unlabelled,
    ORACLE_PROBE_CONFIRM_TEST_POD: 'yes-host-has-no-test-label',
  });
  assert.equal(second.error, undefined);
  assert.equal(second.baseUrl, UNLABELLED_POD);
  assert.equal(second.confirmTestPod, 'yes-host-has-no-test-label');
});

test('a production-style address stops at the command line: exit code 2, nothing sent', async () => {
  const calls = [];
  const spy = async (...args) => {
    calls.push(args);
    throw new Error('must not be called');
  };
  const { code, out, err } = await runMain({ ...ENV, ORACLE_PROBE_URL: UNLABELLED_POD }, spy);
  assert.equal(code, 2);
  assert.equal(out, '');
  assert.equal(err.trim().split('\n').length, 1);
  assert.match(err, /carries no test-style word/);
  assert.equal(calls.length, 0);

  const cli = await runCli({ ...ENV, ORACLE_PROBE_CONFIRM_TEST_POD: '' });
  assert.equal(cli.code, 2);
  assert.equal(cli.stdout, '');
  assert.match(cli.stderr, /^usage: .*missing: ORACLE_PROBE_CONFIRM_TEST_POD/);
});
