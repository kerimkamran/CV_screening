#!/usr/bin/env node
// Stage 3 plan, sections 5.4 and 13 (Phase 0): the operator-run Oracle probe.
// An operator runs it ONCE against the customer's Oracle Recruiting TEST environment, on ONE
// synthetic vacancy, to settle what Oracle's documentation leaves open before the import is built.
// NEVER point it at a production environment or at a vacancy with real applicants (see below).
//
//   export ORACLE_PROBE_URL=...                 the Oracle API address (a pasted REST link is trimmed)
//   export ORACLE_PROBE_USER=...                the integration account
//   read -rs ORACLE_PROBE_PASSWORD && export ORACLE_PROBE_PASSWORD      (keeps it out of shell history)
//   export ORACLE_PROBE_REQUISITION=...         the number of the synthetic vacancy
//   export ORACLE_PROBE_CONFIRM_TEST_POD=yes    your word: TEST environment, synthetic vacancy
//   node scripts/oracle-probe.mjs > oracle-probe-report.json
// Optional settings are listed further down. Settings come from the environment only.
//
// What is printed:
//   - Nothing personal is printed. The report holds counts, yes/no answers, HTTP status codes,
//     field NAMES, content types, file extensions and words from fixed lists. It never holds a
//     name, an e-mail, a file name, an identifier or a link.
//   - What a candidate can influence (the file name, the content type of the upload) is printed
//     only as a word from a fixed list: a well-known extension, a well-known content type.
//   - A label the Oracle team set up (state, phase, category) is printed only when the operator
//     listed it in ORACLE_PROBE_KNOWN_LABELS, and then in the operator's own spelling. Every
//     other label is counted as "(withheld)". No text is copied from an Oracle answer: what is
//     taken as it came is a number or a yes/no (a status code, Oracle's estimate, "more rows").
//   - The body of an error answer is never read, so it cannot reach a note. A note is always one
//     of a fixed set of words.
//
// Network rules:
//   - GET only. Sign-in is user name + password (Basic). The Authorization header goes to the
//     configured host and nowhere else.
//   - The address must be https on the standard port, and its host must end with
//     .oraclecloud.com.
//   - The probe talks to that one host only. A redirect to another host is never followed and a
//     file link (FileUrl) on another host is never fetched: both are only counted.
//   - Before every request the host name is looked up, and the request is not sent when any of
//     its addresses is private, loopback, link-local or reserved (the same list as
//     apps/api/src/pipeline/link-reader.ts:41-95). `fetch` gives no way to check the address of
//     the connection itself, so this is a check just before the call, not on the call.
//   - Limits on what is read: 5 MB for a JSON answer and 10 MB for a file, counted while the
//     answer streams in. The last download route carries the file inside JSON as base64, so it
//     can show a file of up to about 3.7 MB; the download step picks a file of 3 MB or less
//     when there is one.
//
// The test-environment check. Whether any value in Oracle's answers tells a TEST environment
// from production is not known (to confirm on the Oracle test environment), so the probe cannot
// check this by itself. It asks the operator instead:
//   - ORACLE_PROBE_CONFIRM_TEST_POD=yes must be set. It is the operator's word that the address
//     is the customer's TEST environment and that the vacancy holds invented applicants only.
//     Both halves matter: a TEST environment cloned from production holds real applicants too
//     (plan section 10, risk 7).
//   - "yes" is accepted only when the first part of the host name carries a test-style word
//     (-test, -dev, -stage, -uat and the like). That is a naming habit, not a rule (to confirm
//     with the Oracle team). For a TEST environment named differently, the Oracle team must
//     first confirm the address in writing; then the value is yes-host-has-no-test-label.
//   - The report and the summary say which kind of host name was used.
// Reading live Oracle applicants needs the owner's written exception (plan section 8). That
// exception is OPEN: the owner must sign it and the DPO must sign off. Nothing in this file
// grants it.
//
// Optional settings:
//   export ORACLE_PROBE_MAX_APPLICATIONS=25     never more than 50
//   export ORACLE_PROBE_KNOWN_LABELS='A|B|C'    the state, phase and category names the Oracle
//                                               team gave in writing, separated by "|"
//
// What the nine steps do NOT settle, although the plan (sections 10 and 13) gives it to the probe:
//   - Sign-in by OAuth. Only user name + password is tried. When step 1 ends as sign_in_refused,
//     the Oracle team says which OAuth grant they allow (plan section 12), and an OAuth check has
//     to be added to this file before the probe can confirm it. OAuth is never tried as a
//     fallback after a 401: a second failed sign-in can lock the account.
//   - Region. The Oracle team answers where each environment is hosted (plan section 12).
//   - Withdrawn and purged applicants, only in part. The probe cannot point at one row. It gives
//     numbers to compare with what the Oracle team seeded: Oracle's estimate (step 3) against
//     the rows listed (step 4), the rows with a blank value in each field (step 4), and the
//     status codes of the attachment reads (step 7).
//   - CVs kept only on the candidate profile, only in part (plan section 10, risk 20). The probe
//     counts the applications without a file (step 7). It does not read the candidate profile,
//     so it cannot say how many of them have a CV there. That check is still to be added.
// The report repeats this in `notCovered` and `partlyCovered`.
//
// File kinds in the report: pdf, zip (docx and other ZIP-based files), ole (old Word .doc and
// other files in that container), rtf, text, other, empty.
//
// Exit code: 0 when steps 1, 2, 4 and 7 succeeded, 1 otherwise, 2 for a set-up mistake.
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';

export const BASE_PATH = '/hcmRestApi/resources/11.13.18.05';
export const FRAMEWORK_VERSION = '4';
export const DEFAULT_MAX_APPLICATIONS = 25;
export const MAX_APPLICATIONS_CEILING = 50;
export const STEP_NAMES = [
  'sign_in',
  'find_requisition',
  'estimate',
  'list_rowmatch',
  'list_semicolon',
  'list_offset',
  'attachments',
  'download',
  'signals',
];
const REQUIRED_STEPS = ['sign_in', 'find_requisition', 'list_rowmatch', 'attachments'];

const MB = 1024 * 1024;
const META_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const JSON_CAP_BYTES = 5 * MB;
const FILE_CAP_BYTES = 10 * MB;
// The last download route carries the file inside JSON as base64. A file of 3 MB is about 4 MB
// in base64, so it fits the JSON limit; the download step picks a file this small when it can.
const SMALL_FILE_BYTES = 3 * MB;
const HEAD_BYTES = 4096;
const MAX_SAME_HOST_REDIRECTS = 3;

const REQUISITION_FIELDS = [
  'RequisitionId',
  'RequisitionNumber',
  'Title',
  'StateName',
  'PhaseName',
];
const APPLICATION_FIELDS = [
  'JobApplicationId',
  'CandidatePersonId',
  'ConfirmedFlag',
  'DisqualifiedFlag',
  'InternalFlag',
  'StateName',
  'PhaseName',
  'JobApplicationDate',
  'LastUpdateDate',
];
const ATTACHMENT_FIELDS = [
  'AttachedDocumentId',
  'CategoryName',
  'DatatypeCode',
  'FileName',
  'UploadedFileContentType',
  'UploadedFileLength',
  'FileUrl',
  'FileContents',
  'DmDocumentId',
  'DmVersionNumber',
  'LastUpdateDate',
];
// What the attachments read asks for: the fields the probe uses and nothing else. No uploader
// name, no title, no description and no file contents.
const ATTACHMENT_READ_FIELDS = ATTACHMENT_FIELDS.filter((name) => name !== 'FileContents');
const FLAG_FIELDS = ['ConfirmedFlag', 'DisqualifiedFlag', 'InternalFlag'];
// The flag conditions of the import (plan 5.4, call D: "+ filter flags"). The plan does not fix
// how a flag is written in the filter, so the probe tries both spellings (to confirm on the
// Oracle test environment). "Withdrawn" has no flag among the fields the plan lists: it shows as
// a state label on the row.
const FLAG_FILTER_FORMS = [
  ['true_false', 'ConfirmedFlag=true and DisqualifiedFlag=false'],
  ['y_n', "ConfirmedFlag='Y' and DisqualifiedFlag='N'"],
];
// What the plan gives to the probe and the nine steps do not settle. See the header.
const NOT_COVERED = ['oauth_sign_in', 'region'];
const PARTLY_COVERED = ['withdrawn_and_purged_shapes', 'cv_only_on_candidate_profile'];

// ---------------------------------------------------------------------------------------------
// Address rules
// ---------------------------------------------------------------------------------------------

const isOracleCloudHost = (hostname) =>
  /^[a-z0-9-]+(\.[a-z0-9-]+)*\.oraclecloud\.com$/.test(String(hostname).toLowerCase());

/**
 * Trims what the operator pasted to the address itself (scheme + host + port). A full REST link
 * copied from Oracle's documentation is accepted. Returns null when the text is not an address
 * or carries a user name or password.
 */
export function normaliseAddress(input) {
  if (typeof input !== 'string') return null;
  let text = input.trim();
  if (!text) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  return url.origin;
}

/**
 * https only, on the standard port; the host ends with ".oraclecloud.com"; no user name or
 * password in the address.
 */
export function isAllowedAddress(url) {
  let parsed;
  try {
    parsed = url instanceof URL ? url : new URL(String(url));
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.port !== '') return false; // a URL drops ":443", so anything left is another port
  if (parsed.username !== '' || parsed.password !== '') return false;
  return isOracleCloudHost(parsed.hostname);
}

// ---------------------------------------------------------------------------------------------
// The test-environment check (see the header)
// ---------------------------------------------------------------------------------------------

export const CONFIRM_TEST_POD = 'yes';
export const CONFIRM_UNLABELLED_TEST_POD = 'yes-host-has-no-test-label';
// Words that mark a test environment in the first part of a host name. A naming habit, not a
// rule: to confirm with the Oracle team. A number after the word is ignored (dev1, test2).
const TEST_STYLE_WORDS = new Set([
  'test',
  'tst',
  'dev',
  'stage',
  'staging',
  'stg',
  'uat',
  'sandbox',
]);

/** 'test_style' when the first part of the host name carries a test-style word. */
export function hostLabelOf(hostname) {
  const first = String(hostname).toLowerCase().split('.')[0];
  const words = first.split('-').map((word) => word.replace(/\d+$/, ''));
  return words.some((word) => TEST_STYLE_WORDS.has(word)) ? 'test_style' : 'no_test_label';
}

/**
 * The operator's word that the address is the TEST environment and the vacancy is synthetic.
 * "yes" is enough only for a host name with a test-style word; any other host name needs the
 * longer value, which the operator sets after the Oracle team confirmed the address in writing.
 */
export function testPodConfirmation(hostname, value) {
  const hostLabel = hostLabelOf(hostname);
  const said = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const ok =
    said === CONFIRM_UNLABELLED_TEST_POD ||
    (said === CONFIRM_TEST_POD && hostLabel === 'test_style');
  return { ok, hostLabel };
}

// ---------------------------------------------------------------------------------------------
// Public addresses only
// ---------------------------------------------------------------------------------------------

// Where a request must never go. The same ranges, and the same reading of IPv6, as the server's
// check in apps/api/src/pipeline/link-reader.ts:41-95 (a script cannot import that file).
const V4_BLOCKED = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];
const v4Number = (ip) => ip.split('.').reduce((n, part) => (n * 256 + Number(part)) >>> 0, 0) >>> 0;
const inV4Range = (ip, [base, bits]) => {
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (v4Number(ip) & mask) >>> 0 === (v4Number(base) & mask) >>> 0;
};

/** True when the address is not a public one: private, loopback, link-local or reserved. */
export function isBlockedAddress(ip) {
  const kind = isIP(String(ip));
  if (kind === 4) return V4_BLOCKED.some((range) => inV4Range(ip, range));
  if (kind === 6) {
    const a = ip.toLowerCase();
    if (a === '::1' || a === '::') return true;
    // IPv4 inside IPv6 (::ffff:1.2.3.4, NAT64): judge the embedded address.
    const mapped = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(a);
    if (mapped) return isBlockedAddress(mapped[1]);
    const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(a);
    if (hex) {
      const n = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16);
      return isBlockedAddress([24, 16, 8, 0].map((shift) => (n >>> shift) & 255).join('.'));
    }
    const first = parseInt(a.split(':')[0] || '0', 16);
    return (
      (first & 0xfe00) === 0xfc00 || // unique local
      (first & 0xffc0) === 0xfe80 || // link-local
      (first & 0xff00) === 0xff00 || // multicast
      a.startsWith('2001:db8') || // documentation
      a.startsWith('2002:') || // 6to4
      a.startsWith('64:ff9b')
    );
  }
  return true; // not an address we understand
}

/**
 * Looks a host name up and answers with null when every address is public, or with a fixed word
 * when the request must not be sent. The text of a lookup error is never used.
 */
function createAddressCheck(lookup) {
  return async (hostname) => {
    let found;
    try {
      found = await lookup(hostname, { all: true });
    } catch {
      return 'address_lookup_failed';
    }
    if (!Array.isArray(found) || found.length === 0) return 'address_lookup_failed';
    return found.some((entry) => isBlockedAddress(entry?.address)) ? 'address_not_public' : null;
  };
}

/** Waits for `promise`, but no longer than the deadline of `signal`. */
function beforeDeadline(promise, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** The ceiling of 50 cannot be raised: anything above it becomes 50. */
export function clampMaxApplications(value) {
  const n = typeof value === 'string' && /^\d{1,9}$/.test(value.trim()) ? Number(value) : value;
  if (!Number.isInteger(n) || n < 1) return DEFAULT_MAX_APPLICATIONS;
  return Math.min(n, MAX_APPLICATIONS_CEILING);
}

// The test file passes `allowLoopbackForTests` so a fake Oracle on 127.0.0.1 over http can stand
// in. It is a function argument only: `readConfig` never sets it, so no environment variable can.
function allowedOrigin(baseUrl, loopbackForTests) {
  let url;
  try {
    url = new URL(String(baseUrl));
  } catch {
    return null;
  }
  if (isAllowedAddress(url)) return { origin: url.origin, target: 'oracle_cloud_host' };
  const loopback =
    url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password;
  if (loopbackForTests === true && loopback) return { origin: url.origin, target: 'test_loopback' };
  return null;
}

// ---------------------------------------------------------------------------------------------
// What may be printed
// ---------------------------------------------------------------------------------------------

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const RTF_MAGIC = [0x7b, 0x5c, 0x72, 0x74, 0x66]; // {\rtf
const ZIP_MARKS = new Set([0x0304, 0x0506, 0x0708]);

const startsWith = (bytes, magic) =>
  bytes.length >= magic.length && magic.every((byte, i) => bytes[i] === byte);

function asBytes(value) {
  if (value instanceof Uint8Array) return value; // a Buffer is one too
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(0);
}

function looksLikeText(bytes) {
  const utf16Mark =
    bytes.length >= 2 &&
    ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff));
  if (utf16Mark) return true;
  for (const byte of bytes) {
    if (byte === 0x09 || byte === 0x0a || byte === 0x0c || byte === 0x0d) continue;
    if (byte < 0x20 || byte === 0x7f) return false;
  }
  return true;
}

/** The kind of a file, read from its first bytes: pdf, zip, ole, rtf, text, other or empty. */
export function classifyBytes(buffer) {
  const bytes = asBytes(buffer);
  if (bytes.length === 0) return 'empty';
  if (startsWith(bytes, PDF_MAGIC)) return 'pdf';
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && ZIP_MARKS.has((bytes[2] << 8) | bytes[3])) {
    return 'zip';
  }
  if (startsWith(bytes, OLE_MAGIC)) return 'ole';
  if (startsWith(bytes, RTF_MAGIC)) return 'rtf';
  return looksLikeText(bytes.subarray(0, HEAD_BYTES)) ? 'text' : 'other';
}

const KNOWN_EXTENSIONS = new Set(
  (
    'pdf doc docx docm dot dotx rtf txt odt md htm html pages wps ' +
    'jpg jpeg png gif tif tiff bmp heic webp zip xls xlsx ppt pptx csv xml msg eml'
  ).split(' '),
);

/** Only the extension, and only a well-known one. Anything else is "(other)", never the text. */
export function extensionOf(fileName) {
  if (typeof fileName !== 'string') return '(none)';
  const dot = fileName.lastIndexOf('.');
  if (dot < 0 || dot === fileName.length - 1) return '(none)';
  const extension = fileName
    .slice(dot + 1)
    .trim()
    .toLowerCase();
  return KNOWN_EXTENSIONS.has(extension) ? extension : '(other)';
}

const LABEL_SHAPE = /^[\p{L}\p{M}\p{N} _\-–—/&(),']{1,60}$/u;
const MAX_KNOWN_LABELS = 100;
const tidyLabel = (text) => text.trim().replace(/\s+/g, ' ');

/**
 * The labels the operator expects, from ORACLE_PROBE_KNOWN_LABELS: names separated by "|".
 * Returns a Map from the compared form (lower case) to the operator's own spelling, or null when
 * an entry does not look like a label: too long, an "@", a long number, odd characters.
 */
export function parseKnownLabels(input) {
  const known = new Map();
  if (input === undefined || input === null) return known;
  if (typeof input !== 'string') return null;
  for (const part of input.split('|')) {
    const text = tidyLabel(part);
    if (!text) continue;
    if (!LABEL_SHAPE.test(text) || /\p{N}{4,}/u.test(text)) return null;
    known.set(text.toLowerCase(), text);
    if (known.size > MAX_KNOWN_LABELS) return null;
  }
  return known;
}

/**
 * State, phase and category labels are free text set up by the Oracle team, and nothing in the
 * shape of a text tells a label from a person's name. So a label is printed only when the
 * operator listed it, and then in the operator's own spelling: the text of the answer itself is
 * never printed. Anything else is dropped (null). So is a listed label that holds a value the
 * probe keeps in memory as sensitive.
 */
export function safeLabel(value, known = new Map(), isSensitive = () => false) {
  if (typeof value !== 'string') return null;
  const listed = known.get(tidyLabel(value).toLowerCase());
  if (listed === undefined || isSensitive(listed)) return null;
  return listed;
}

const MEDIA_FAMILIES = new Set(
  'application audio binary font image message model multipart text video'.split(' '),
);

// The content types the report may name. The browser that uploaded a file chose its content
// type, so a type outside this list is cut down to its family, for example "application/(other)".
const KNOWN_CONTENT_TYPES = new Set([
  'application/pdf',
  'application/x-pdf',
  'application/msword',
  'application/vnd.ms-word',
  'application/vnd.ms-word.document.macroenabled.12',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
  'application/vnd.oasis.opendocument.text',
  'application/rtf',
  'application/x-rtf',
  'text/rtf',
  'text/richtext',
  'text/plain',
  'text/html',
  'text/xml',
  'text/csv',
  'application/xml',
  'application/json',
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream',
  'binary/octet-stream',
  'application/download',
  'application/x-download',
  'application/force-download',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-outlook',
  'message/rfc822',
  'image/jpeg',
  'image/jpg',
  'image/pjpeg',
  'image/png',
  'image/gif',
  'image/tiff',
  'image/bmp',
  'image/webp',
  'image/heic',
  'application/vnd.oracle.adf.resourcecollection+json',
  'application/vnd.oracle.adf.resourceitem+json',
  'application/vnd.oracle.adf.error+json',
]);

/**
 * The media type alone, in lower case, and only a well-known one. Parameters (which can hold a
 * file name) are cut off. Anything else becomes "<family>/(other)" or "(other)", never the text.
 */
export function safeContentType(value) {
  if (typeof value !== 'string' || !value.trim()) return '(none)';
  const media = value.split(';')[0].trim().toLowerCase();
  if (KNOWN_CONTENT_TYPES.has(media)) return media;
  const slash = media.indexOf('/');
  const family = slash > 0 ? media.slice(0, slash) : '';
  return MEDIA_FAMILIES.has(family) ? `${family}/(other)` : '(other)';
}

// FILE is the value the probe looks for. FILE, WEB_PAGE and TEXT are the values Oracle's
// documentation gives for a candidate's attachments; whether the attachments of an application
// use the same ones is to confirm on the Oracle test environment. Any other value is counted as
// "(other)", never printed.
const KNOWN_DATATYPE_CODES = new Set(['FILE', 'TEXT', 'WEB_PAGE']);

const safeCode = (value) => {
  if (value === null || value === undefined || value === '') return '(none)';
  const code = typeof value === 'string' ? value.toUpperCase() : '';
  return KNOWN_DATATYPE_CODES.has(code) ? code : '(other)';
};

const KNOWN_SIGNAL_HEADERS = new Set([
  'retry-after',
  'ratelimit',
  'ratelimit-limit',
  'ratelimit-policy',
  'ratelimit-remaining',
  'ratelimit-reset',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'x-ratelimit-used',
  'x-rate-limit-limit',
  'x-rate-limit-remaining',
  'x-rate-limit-reset',
]);
const SIGNAL_HEADER_SHAPE = /rate-?limit|throttl|quota/;

/**
 * Values held in memory during the run that must never appear in a label: the settings, the host
 * and every identifier Oracle returned. File names are left out on purpose. A file called
 * "Resume.pdf" would otherwise hide the category label "Resume", which is one of the answers the
 * probe is run for, and a file name cannot be printed anyway: only `extensionOf` reads it.
 */
function createSensitive(initial) {
  const values = new Set();
  const add = (value) => {
    if (value === null || value === undefined) return;
    const text = String(value).trim().toLowerCase();
    if (text) values.add(text);
  };
  for (const value of initial) add(value);
  const hit = (text) => {
    const lower = String(text).toLowerCase();
    for (const value of values) {
      if (value.length >= 4 ? lower.includes(value) : lower === value) return true;
    }
    return false;
  };
  return { add, hit };
}

function createTally() {
  const counts = new Map();
  return {
    add(key) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    },
    toObject() {
      const sorted = [...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return Object.fromEntries(sorted);
    },
  };
}

/**
 * A tally of labels (state, phase or category). A label the operator did not list is counted as
 * "(withheld)". The withheld texts are held in memory only to count how many different ones
 * there were; they are never printed.
 */
function createLabelTally(ctx) {
  const tally = createTally();
  const withheld = new Set();
  return {
    add(value) {
      if (value === null || value === undefined || value === '') {
        tally.add('(none)');
        return;
      }
      const listed = safeLabel(value, ctx.knownLabels, ctx.sensitive.hit);
      if (listed === null) withheld.add(tidyLabel(String(value)).toLowerCase());
      tally.add(listed ?? '(withheld)');
    },
    toObject: () => tally.toObject(),
    distinctWithheld: () => withheld.size,
  };
}

// ---------------------------------------------------------------------------------------------
// Reading Oracle's answers
// ---------------------------------------------------------------------------------------------

const has = (item, name) => item !== null && typeof item === 'object' && Object.hasOwn(item, name);

const itemsOf = (json) =>
  json !== null && typeof json === 'object' && Array.isArray(json.items) ? json.items : null;

// A whole number that JavaScript cannot hold exactly is kept as the digits Oracle sent, so an
// identifier is never rounded on its way into the next request.
function parseJson(text) {
  return JSON.parse(text, (key, value, context) => {
    const unsafe = typeof value === 'number' && !Number.isSafeInteger(value);
    return unsafe && context && /^-?\d+$/.test(context.source) ? context.source : value;
  });
}

/** An identifier as digits, or null. It is used to build links and is never printed. */
function idText(value) {
  if (typeof value === 'number')
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  if (typeof value === 'string' && /^\d{1,30}$/.test(value) && !/^0+$/.test(value)) return value;
  return null;
}

function countOf(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value === 'string' && /^\d{1,15}$/.test(value)) return Number(value);
  return null;
}

function flagToken(item, name) {
  if (!has(item, name)) return 'missing';
  const value = item[name];
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (value === null) return 'null';
  if (value === 'Y' || value === 'N') return value;
  if (value === 'true' || value === 'false') return `text_${value}`;
  return 'other';
}

function dateShape(value) {
  if (value === null || value === undefined) return 'none';
  if (typeof value !== 'string') return 'other';
  if (/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(value)) return 'date_time_utc';
  if (/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?[+-]\d\d:\d\d$/.test(value))
    return 'date_time_offset';
  if (/^\d{4}-\d\d-\d\d$/.test(value)) return 'date_only';
  return 'other';
}

function sizeBucket(length) {
  if (length === null) return 'no_length';
  if (length < MB) return 'under_1_mb';
  if (length < 5 * MB) return 'from_1_to_5_mb';
  if (length <= 10 * MB) return 'from_5_to_10_mb';
  return 'over_10_mb';
}

function noteForStatus(status) {
  if (status === 400) return 'bad_request';
  if (status === 401) return 'sign_in_refused';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 406 || status === 415) return 'not_acceptable';
  if (status === 429) return 'throttled';
  if (status >= 500 && status <= 599) return 'server_error';
  return 'unexpected_status';
}

// A note is always one of a fixed set of words. The error's own message is never used: it can
// hold a host name or a link.
function errorNote(error) {
  const name = error !== null && typeof error === 'object' ? error.name : '';
  if (name === 'TimeoutError') return 'timeout';
  if (name === 'AbortError') return 'aborted';
  const code = error?.cause?.code ?? error?.code;
  if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{2,40}$/.test(code)) {
    return `network_error_${code.toLowerCase()}`;
  }
  return 'network_error';
}

async function discard(response) {
  try {
    await response.body?.cancel();
  } catch {
    // Nothing to do: the answer is being thrown away.
  }
}

/** Reads a body while counting bytes, and stops at the cap. `keep` is 'all' or 'head'. */
async function readBody(response, cap, keep) {
  const declared = Number(response.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > cap) {
    await discard(response);
    return { bytes: null, tooLarge: true, data: null };
  }
  if (!response.body) return { bytes: 0, tooLarge: false, data: Buffer.alloc(0) };
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  let kept = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > cap) {
      try {
        await reader.cancel();
      } catch {
        // Nothing to do: the read is being given up.
      }
      return { bytes: null, tooLarge: true, data: null };
    }
    if (keep === 'all') {
      chunks.push(value);
    } else if (kept < HEAD_BYTES) {
      const part = value.subarray(0, HEAD_BYTES - kept);
      chunks.push(part);
      kept += part.byteLength;
    }
  }
  return { bytes, tooLarge: false, data: Buffer.concat(chunks) };
}

function redirectTarget(location, from) {
  if (!location) return null;
  try {
    const next = new URL(location, from);
    return next.protocol === 'https:' || next.protocol === 'http:' ? next : null;
  } catch {
    return null;
  }
}

/**
 * The one place that talks to the network. Exported so the tests can check its rules directly:
 * GET only, the configured host only, no redirect to another host, the sign-in header to the
 * configured host only. `runProbe` is its only caller. It checks the address before it builds a
 * client and passes `checkAddress`, which is asked before every request (null means "send").
 */
export function createClient({
  origin,
  authorization,
  fetchImpl,
  checkAddress = async () => null,
}) {
  const seen = {
    requests: 0,
    halted: false,
    headerNames: new Set(),
    otherRateLimitStyleHeaders: 0,
    throttled429: 0,
    unavailable503: 0,
  };

  function noteSignals(response) {
    if (response.status === 429) seen.throttled429 += 1;
    if (response.status === 503) seen.unavailable503 += 1;
    for (const rawName of response.headers.keys()) {
      const name = rawName.toLowerCase();
      if (KNOWN_SIGNAL_HEADERS.has(name)) seen.headerNames.add(name);
      else if (SIGNAL_HEADER_SHAPE.test(name)) seen.otherRateLimitStyleHeaders += 1;
    }
  }

  /**
   * One GET, to the configured host and no other. `as` is 'json' (metadata) or 'file' (a
   * download: only the first bytes are kept). A redirect is followed only when it stays on the
   * configured host.
   */
  async function get(target, options = {}) {
    const { auth = true, as = 'json', cap = JSON_CAP_BYTES, timeoutMs = META_TIMEOUT_MS } = options;
    const out = {
      sent: false,
      status: null,
      note: null,
      redirected: false,
      redirectSameHost: null,
      redirectToOracleCloud: null,
      contentType: '(none)',
      bytes: null,
      tooLarge: false,
      json: null,
      head: null,
    };
    if (seen.halted) {
      out.note = 'stopped_after_401';
      return out;
    }
    let url = target;
    if (!(url instanceof URL) || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
      out.note = 'bad_link';
      return out;
    }
    if (url.origin !== origin) {
      out.note = 'host_not_allowed';
      return out;
    }
    try {
      const signal = AbortSignal.timeout(timeoutMs);
      for (let hop = 0; ; hop += 1) {
        const blocked = await beforeDeadline(checkAddress(url.hostname), signal);
        if (blocked) {
          out.note = blocked;
          return out;
        }
        const onConfiguredHost = url.origin === origin;
        const withSignIn = auth && onConfiguredHost;
        const headers = {
          Accept: as === 'json' ? 'application/json' : 'application/octet-stream, */*;q=0.8',
        };
        if (onConfiguredHost && url.pathname.startsWith('/hcmRestApi/')) {
          headers['REST-Framework-Version'] = FRAMEWORK_VERSION;
        }
        if (withSignIn) headers.Authorization = authorization;
        seen.requests += 1;
        out.sent = true;
        const response = await fetchImpl(url, {
          method: 'GET',
          headers,
          redirect: 'manual',
          signal,
        });
        noteSignals(response);
        out.status = response.status;
        out.contentType = safeContentType(response.headers.get('content-type'));

        if (response.status >= 300 && response.status < 400) {
          out.redirected = true;
          await discard(response);
          const next = redirectTarget(response.headers.get('location'), url);
          if (!next) {
            out.note = 'redirect_without_target';
            return out;
          }
          out.redirectSameHost = next.origin === origin;
          out.redirectToOracleCloud = isOracleCloudHost(next.hostname);
          const stays = onConfiguredHost && next.origin === origin;
          if (!stays || hop >= MAX_SAME_HOST_REDIRECTS) {
            out.note = 'redirect_not_followed';
            return out;
          }
          url = next;
          continue;
        }

        if (response.status !== 200) {
          await discard(response); // the body of an error answer is never read
          // A refused sign-in on the API stops the run: trying again can lock the account.
          if (response.status === 401 && withSignIn && as === 'json') seen.halted = true;
          out.note = noteForStatus(response.status);
          return out;
        }

        const body = await readBody(response, cap, as === 'json' ? 'all' : 'head');
        out.tooLarge = body.tooLarge;
        out.bytes = body.bytes;
        if (body.tooLarge) {
          out.note = 'too_large';
          return out;
        }
        if (as === 'file') {
          out.head = body.data;
          return out;
        }
        try {
          out.json = parseJson(body.data.toString('utf8'));
        } catch {
          out.note = 'not_json';
        }
        return out;
      }
    } catch (error) {
      out.note = errorNote(error);
      return out;
    }
  }

  return { get, seen };
}

// ---------------------------------------------------------------------------------------------
// Building requests
// ---------------------------------------------------------------------------------------------

// The plan (section 5.4) writes the calls as `finder=name;Var=value`, `fields=A,B` and
// `orderBy=Field:asc`, so ; = , : are sent as they are. All else is percent-encoded (a space
// becomes %20, never "+").
const encodeValue = (value) =>
  encodeURIComponent(String(value)).replace(
    /%3B|%3D|%2C|%3A/gi,
    (code) => ({ '%3B': ';', '%3D': '=', '%2C': ',', '%3A': ':' })[code.toUpperCase()],
  );

function apiUrl(origin, resource, params) {
  const query = Object.entries(params)
    .map(([name, value]) => `${name}=${encodeValue(value)}`)
    .join('&');
  return new URL(`${origin}${BASE_PATH}/${resource}?${query}`);
}

function linkOf(origin, item, rel, name) {
  const links = has(item, 'links') && Array.isArray(item.links) ? item.links : [];
  for (const link of links) {
    if (link === null || typeof link !== 'object' || link.rel !== rel) continue;
    if (name !== undefined && link.name !== name) continue;
    if (typeof link.href !== 'string') continue;
    try {
      return new URL(link.href, origin);
    } catch {
      return null;
    }
  }
  return null;
}

const lastSegment = (url) => {
  try {
    return decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? '');
  } catch {
    return '';
  }
};

const withoutEndSlash = (path) => path.replace(/\/+$/, '');

const stepRecord = (step, answer) => {
  const record = {
    step,
    ok: false,
    status: answer.status,
    note: answer.note ?? (answer.status === 200 ? null : noteForStatus(answer.status)),
  };
  if (answer.redirected) {
    record.redirected = true;
    record.redirectSameHost = answer.redirectSameHost;
    record.redirectToOracleCloud = answer.redirectToOracleCloud;
  }
  return record;
};

// ---------------------------------------------------------------------------------------------
// The nine steps
// ---------------------------------------------------------------------------------------------

// 1. Can the account sign in, and does it see anything? An account that may sign in but has no
//    data access is expected to get 200 with no items (to confirm on the Oracle test
//    environment), so that case is told apart from 401 and 403. `fields` keeps the answer to one
//    identifier: the probe asks Oracle for no more than it needs.
async function stepSignIn(ctx) {
  const answer = await ctx.get(
    apiUrl(ctx.origin, 'recruitingJobRequisitions', {
      limit: 1,
      onlyData: true,
      fields: 'RequisitionId',
    }),
  );
  const record = stepRecord('sign_in', answer);
  if (answer.status !== 200 || answer.note) return record;
  const items = itemsOf(answer.json);
  if (!items) {
    record.note = 'unexpected_shape';
    return record;
  }
  record.ok = true;
  record.seesRequisitions = items.length > 0;
  record.note = items.length > 0 ? 'signed_in' : 'empty_scope';
  return record;
}

// 2. Find the synthetic vacancy by its number. `Title` is not confirmed by the documentation,
//    so a 400 is tried once more without it.
async function stepFindRequisition(ctx, state) {
  const ask = (fields) =>
    ctx.get(
      apiUrl(ctx.origin, 'recruitingJobRequisitions', {
        finder: `findByRequisitionNumber;RequisitionNumber=${ctx.requisition}`,
        fields: fields.join(','),
        limit: 2,
        onlyData: true,
      }),
    );
  let answer = await ask(REQUISITION_FIELDS);
  let retriedWithoutTitle = false;
  if (answer.status === 400) {
    retriedWithoutTitle = true;
    answer = await ask(REQUISITION_FIELDS.filter((name) => name !== 'Title'));
  }
  const record = { ...stepRecord('find_requisition', answer), retriedWithoutTitle };
  if (answer.status !== 200 || answer.note) return record;
  const items = itemsOf(answer.json);
  if (!items) {
    record.note = 'unexpected_shape';
    return record;
  }
  const more = items.length > 1 || answer.json.hasMore === true;
  record.found = items.length === 0 ? '0' : more ? 'more' : '1';
  record.fieldsReturned = REQUISITION_FIELDS.filter((name) =>
    items.some((item) => has(item, name)),
  );
  record.fieldsMissing = REQUISITION_FIELDS.filter((name) => !record.fieldsReturned.includes(name));
  if (record.found !== '1') {
    record.note = record.found === '0' ? 'not_found_or_not_visible' : 'more_than_one_match';
    return record;
  }
  const id = idText(items[0].RequisitionId);
  if (!id) {
    record.note = 'no_requisition_id';
    return record;
  }
  state.requisitionId = id; // kept in memory for the next steps; never printed
  ctx.sensitive.add(id);
  record.ok = true;
  record.note = 'found';
  return record;
}

// 3. Oracle's estimated count: the number the recruiter will confirm up front.
async function stepEstimate(ctx, state) {
  const answer = await ctx.get(
    apiUrl(ctx.origin, 'recruitingJobApplications', {
      q: `RequisitionId=${state.requisitionId}`,
      limit: 1,
      totalResults: true,
      fields: 'JobApplicationId',
      onlyData: true,
    }),
  );
  const record = stepRecord('estimate', answer);
  if (answer.status !== 200 || answer.note) return record;
  record.totalResults = has(answer.json, 'totalResults') ? countOf(answer.json.totalResults) : null;
  record.ok = record.totalResults !== null;
  record.note = record.ok ? 'estimate_returned' : 'no_total_results';
  return record;
}

const FLAG_YES = new Set(['true', 'Y', 'text_true']);
const FLAG_NO = new Set(['false', 'N', 'text_false']);

// The list once more with the flag conditions of the import, in each spelling. Only the status
// and the row count are recorded. `expected` is the number of listed rows that are confirmed and
// not disqualified, or null when the list was not complete.
async function flagFilter(ctx, state, expected) {
  const results = [];
  for (const [form, conditions] of FLAG_FILTER_FORMS) {
    const answer = await ctx.get(
      apiUrl(ctx.origin, 'recruitingJobApplications', {
        q: `RequisitionId=${state.requisitionId} and JobApplicationId > 0 and ${conditions}`,
        orderBy: 'JobApplicationId:asc',
        limit: ctx.max,
        fields: 'JobApplicationId',
        onlyData: true,
      }),
    );
    const items = answer.status === 200 && !answer.note ? itemsOf(answer.json) : null;
    const failure = answer.status === 200 ? 'unexpected_shape' : noteForStatus(answer.status);
    results.push({
      form,
      status: answer.status,
      note: items ? 'accepted' : (answer.note ?? failure),
      count: items ? items.length : null,
      matchesListedRows: items && expected !== null ? items.length === expected : null,
    });
    if (ctx.seen.halted) break;
  }
  return results;
}

// 4. The list as the import will read it: the "and" form of the filter, oldest first. Then the
//    same list with the flag conditions that keep the import to active applicants.
async function stepListRowMatch(ctx, state) {
  const answer = await ctx.get(
    apiUrl(ctx.origin, 'recruitingJobApplications', {
      q: `RequisitionId=${state.requisitionId} and JobApplicationId > 0`,
      orderBy: 'JobApplicationId:asc',
      limit: ctx.max,
      fields: APPLICATION_FIELDS.join(','),
    }),
  );
  const record = stepRecord('list_rowmatch', answer);
  if (answer.status !== 200 || answer.note) return record;
  const items = itemsOf(answer.json);
  if (!items) {
    record.note = 'unexpected_shape';
    return record;
  }
  const flags = Object.fromEntries(FLAG_FIELDS.map((name) => [name, createTally()]));
  const states = createLabelTally(ctx);
  const phases = createLabelTally(ctx);
  const applicationDates = createTally();
  const updateDates = createTally();
  const selfLinkKey = { plainId: 0, otherKey: 0, noSelfLink: 0 };
  // Rows where a field came back empty: one of the shapes a purged or anonymised applicant may
  // have (to confirm on the Oracle test environment).
  const blankValues = Object.fromEntries(APPLICATION_FIELDS.map((name) => [name, 0]));
  let withoutId = 0;
  let active = 0;

  for (const item of items) {
    const id = idText(item?.JobApplicationId);
    ctx.sensitive.add(id);
    ctx.sensitive.add(idText(item?.CandidatePersonId));
    for (const name of FLAG_FIELDS) flags[name].add(flagToken(item, name));
    for (const name of APPLICATION_FIELDS) {
      if (has(item, name) && (item[name] === null || item[name] === '')) blankValues[name] += 1;
    }
    const confirmed = FLAG_YES.has(flagToken(item, 'ConfirmedFlag'));
    if (confirmed && FLAG_NO.has(flagToken(item, 'DisqualifiedFlag'))) active += 1;
    states.add(item?.StateName);
    phases.add(item?.PhaseName);
    applicationDates.add(dateShape(item?.JobApplicationDate));
    updateDates.add(dateShape(item?.LastUpdateDate));
    const self = linkOf(ctx.origin, item, 'self');
    if (!self) selfLinkKey.noSelfLink += 1;
    else if (id !== null && lastSegment(self) === id) selfLinkKey.plainId += 1;
    else selfLinkKey.otherKey += 1;
    if (id === null) withoutId += 1;
    else if (state.applications.length < ctx.max) {
      state.applications.push({ id, links: has(item, 'links') ? item.links : null });
    }
  }

  record.count = items.length;
  record.returnedMoreThanAsked = items.length > ctx.max;
  record.hasMore = typeof answer.json.hasMore === 'boolean' ? answer.json.hasMore : null;
  record.rowsWithoutId = withoutId;
  record.fieldsReturned = APPLICATION_FIELDS.filter((name) =>
    items.some((item) => has(item, name)),
  );
  record.fieldsMissing = APPLICATION_FIELDS.filter((name) => !record.fieldsReturned.includes(name));
  record.flags = Object.fromEntries(FLAG_FIELDS.map((name) => [name, flags[name].toObject()]));
  record.stateNames = states.toObject();
  record.phaseNames = phases.toObject();
  record.labelsWithheld = {
    stateNames: states.distinctWithheld(),
    phaseNames: phases.distinctWithheld(),
  };
  record.blankValues = blankValues;
  record.dateShapes = {
    JobApplicationDate: applicationDates.toObject(),
    LastUpdateDate: updateDates.toObject(),
  };
  record.selfLinkKey = selfLinkKey;
  const complete = record.hasMore === false && items.length <= ctx.max;
  record.flagFilter = await flagFilter(ctx, state, complete ? active : null);
  record.flagFilterAccepted = record.flagFilter
    .filter((result) => result.note === 'accepted')
    .map((result) => result.form);
  record.ok = state.applications.length > 0;
  record.note = record.ok
    ? 'listed'
    : items.length === 0
      ? 'no_applications'
      : 'no_application_ids';
  return record;
}

// 5. The same filter written with ";". The plan expects Oracle to refuse it under framework
//    version 4. Only the status is recorded.
async function stepListSemicolon(ctx, state) {
  const answer = await ctx.get(
    apiUrl(ctx.origin, 'recruitingJobApplications', {
      q: `RequisitionId=${state.requisitionId};JobApplicationId > 0`,
      orderBy: 'JobApplicationId:asc',
      limit: 1,
      fields: 'JobApplicationId',
      onlyData: true,
    }),
  );
  const record = stepRecord('list_semicolon', answer);
  record.ok = answer.status !== null && !answer.redirected;
  if (answer.status === 400) record.note = 'refused_as_expected';
  else if (answer.status === 200) record.note = 'accepted';
  return record;
}

// 6. Two small pages with limit and offset under the same order. Did any row come back twice?
async function stepListOffset(ctx, state) {
  const pageSize = Math.max(1, Math.min(5, Math.floor(ctx.max / 2)));
  const page = (offset) =>
    ctx.get(
      apiUrl(ctx.origin, 'recruitingJobApplications', {
        q: `RequisitionId=${state.requisitionId}`,
        orderBy: 'JobApplicationId:asc',
        limit: pageSize,
        offset,
        fields: 'JobApplicationId',
        onlyData: true,
      }),
    );
  const first = await page(0);
  const record = { ...stepRecord('list_offset', first), pageSize };
  if (first.status !== 200 || first.note) return record;
  const second = await page(pageSize);
  if (second.status !== 200 || second.note) {
    return { ...record, ...stepRecord('list_offset', second) };
  }
  const idsOf = (answer) =>
    (itemsOf(answer.json) ?? []).map((item) => idText(item?.JobApplicationId));
  const one = idsOf(first);
  const two = idsOf(second);
  const all = [...one, ...two];
  if (all.includes(null)) {
    record.note = 'no_application_ids';
    return record;
  }
  record.firstPageCount = one.length;
  record.secondPageCount = two.length;
  record.repeated = new Set(all).size !== all.length;
  record.ascending = all.every((id, i) => i === 0 || BigInt(all[i - 1]) < BigInt(id));
  record.ok = true;
  if (two.length === 0) record.note = 'too_few_rows_to_tell';
  else record.note = record.repeated ? 'row_repeated' : 'no_row_repeated';
  return record;
}

function attachmentsUrl(ctx, application, linkSource) {
  const child = linkOf(ctx.origin, application, 'child', 'attachments');
  if (child && child.origin === ctx.origin) {
    linkSource.childLink += 1;
    return child;
  }
  const self = linkOf(ctx.origin, application, 'self');
  if (self && self.origin === ctx.origin) {
    linkSource.selfLink += 1;
    return new URL(`${withoutEndSlash(self.pathname)}/child/attachments`, ctx.origin);
  }
  linkSource.builtById += 1; // built by hand: Oracle advertised no usable link
  const path = `${BASE_PATH}/recruitingJobApplications/${application.id}/child/attachments`;
  return new URL(path, ctx.origin);
}

const withQuery = (url, search) => {
  const copy = new URL(url);
  copy.search = search;
  return copy;
};

/**
 * Reads the attachments of one application, asking for the fields the probe uses and nothing
 * else. `onlyData` is left out so that the links stay. If Oracle refuses the field list (400),
 * the read is tried without it, once in the whole run; when that works, the later reads go
 * without the list too. `withFields` says how the answer in hand was read.
 */
async function readAttachments(ctx, state, childUrl) {
  if (state.fieldList === 'refused') {
    return { answer: await ctx.get(withQuery(childUrl, '')), withFields: false };
  }
  const fields = `?fields=${encodeValue(ATTACHMENT_READ_FIELDS.join(','))}`;
  const answer = await ctx.get(withQuery(childUrl, fields));
  if (answer.status !== 400 || state.fieldList !== 'not_tried') {
    if (answer.status === 200) state.fieldList = 'accepted';
    return { answer, withFields: true };
  }
  state.fieldList = 'fallback_failed';
  const again = await ctx.get(withQuery(childUrl, ''));
  if (again.status === 200 && !again.note) state.fieldList = 'refused';
  return { answer: again, withFields: false };
}

function enclosureLink(ctx, attachment) {
  const links = has(attachment, 'links') && Array.isArray(attachment.links) ? attachment.links : [];
  const named = linkOf(ctx.origin, attachment, 'enclosure', 'FileContents');
  const byPath = links
    .filter((link) => link !== null && typeof link === 'object' && link.rel === 'enclosure')
    .map((link) => linkOf(ctx.origin, { links: [link] }, 'enclosure'))
    .find((url) => url && url.pathname.endsWith('/enclosure/FileContents'));
  const url = named ?? byPath ?? null;
  if (!url) return { url: null, where: 'notAdvertised' };
  return url.origin === ctx.origin
    ? { url, where: 'advertised' }
    : { url: null, where: 'onAnotherHost' };
}

function fileUrl(ctx, attachment) {
  const raw = has(attachment, 'FileUrl') ? attachment.FileUrl : null;
  if (typeof raw !== 'string' || !raw.trim()) return { url: null, where: 'absent' };
  const text = raw.trim();
  const relative = !/^[a-z][a-z0-9+.-]*:/i.test(text) && !text.startsWith('//');
  let url;
  try {
    url = new URL(text, ctx.origin);
  } catch {
    return { url: null, where: 'unreadable' };
  }
  // A link on another host is counted and never fetched, so no address is handed back for it.
  if (url.origin !== ctx.origin) {
    return { url: null, where: isAllowedAddress(url) ? 'otherOracleCloudHost' : 'otherHost' };
  }
  return { url, where: relative ? 'relative' : 'sameHost' };
}

const isFile = (attachment) =>
  typeof attachment?.DatatypeCode === 'string' && attachment.DatatypeCode.toUpperCase() === 'FILE';

// 7. The attachments of each listed application. Tallies only; no file is read here.
async function stepAttachments(ctx, state) {
  const statuses = createTally();
  const categories = createLabelTally(ctx);
  const datatypes = createTally();
  const contentTypes = createTally();
  const extensions = createTally();
  const sizes = createTally();
  const fieldsSeen = new Set();
  const record = {
    step: 'attachments',
    ok: false,
    status: null,
    note: null,
    applicationsRead: 0,
    applicationsFailed: 0,
    applicationsWithoutFile: 0,
    attachmentsSeen: 0,
    fileAttachments: 0,
    moreThanOnePage: 0,
    readsWithoutFieldList: 0,
    rowsWithoutLinks: 0,
    linkSource: { childLink: 0, selfLink: 0, builtById: 0 },
    enclosureLink: { advertised: 0, notAdvertised: 0, onAnotherHost: 0 },
    fileUrl: {
      absent: 0,
      relative: 0,
      sameHost: 0,
      otherOracleCloudHost: 0,
      otherHost: 0,
      unreadable: 0,
    },
  };
  let firstFailure = null;

  for (const application of state.applications) {
    const childUrl = attachmentsUrl(ctx, application, record.linkSource);
    const { answer, withFields } = await readAttachments(ctx, state, childUrl);
    if (!withFields) record.readsWithoutFieldList += 1;
    const items = answer.status === 200 && !answer.note ? itemsOf(answer.json) : null;
    statuses.add(answer.status === null ? 'no_answer' : String(answer.status));
    if (!items) {
      record.applicationsFailed += 1;
      firstFailure ??= answer.note ?? (answer.status === 200 ? 'unexpected_shape' : 'no_answer');
      if (ctx.seen.halted) break;
      continue;
    }
    record.applicationsRead += 1;
    if (answer.json.hasMore === true) record.moreThanOnePage += 1;
    let files = 0;
    for (const attachment of items) {
      record.attachmentsSeen += 1;
      for (const name of ATTACHMENT_FIELDS) if (has(attachment, name)) fieldsSeen.add(name);
      if (!Array.isArray(attachment?.links)) record.rowsWithoutLinks += 1;
      const fileName = typeof attachment?.FileName === 'string' ? attachment.FileName : null;
      ctx.sensitive.add(idText(attachment?.AttachedDocumentId));
      ctx.sensitive.add(attachment?.DmDocumentId);
      datatypes.add(safeCode(attachment?.DatatypeCode));
      categories.add(attachment?.CategoryName);
      if (!isFile(attachment)) continue;

      files += 1;
      record.fileAttachments += 1;
      const length = countOf(attachment.UploadedFileLength);
      contentTypes.add(safeContentType(attachment.UploadedFileContentType));
      extensions.add(extensionOf(fileName));
      sizes.add(sizeBucket(length));
      record.enclosureLink[enclosureLink(ctx, attachment).where] += 1;
      record.fileUrl[fileUrl(ctx, attachment).where] += 1;
      // The download step uses ONE attachment. The first small file is preferred, because every
      // route can carry it; then the first file within the file limit; then any file.
      const rank =
        length === null || length > FILE_CAP_BYTES ? 0 : length > SMALL_FILE_BYTES ? 1 : 2;
      if (!state.candidate || rank > state.candidate.rank) {
        state.candidate = { childUrl, attachment, rank, index: items.indexOf(attachment) };
      }
    }
    if (files === 0) record.applicationsWithoutFile += 1;
  }

  const tally = statuses.toObject();
  const seenStatuses = Object.keys(tally);
  record.status =
    seenStatuses.length === 1 && /^\d+$/.test(seenStatuses[0]) ? Number(seenStatuses[0]) : null;
  record.statuses = tally;
  // 'accepted', or 'refused' when Oracle answered 400 to the field list and the read without it
  // worked. 'fallback_failed': the 400 had another cause. 'not_tried': no read got that far.
  record.fieldList = state.fieldList;
  record.fieldsReturned = ATTACHMENT_FIELDS.filter((name) => fieldsSeen.has(name));
  record.categoryNames = categories.toObject();
  record.labelsWithheld = { categoryNames: categories.distinctWithheld() };
  record.datatypeCodes = datatypes.toObject();
  record.contentTypes = contentTypes.toObject();
  record.extensions = extensions.toObject();
  record.sizes = sizes.toObject();
  record.ok = record.applicationsRead > 0 && record.applicationsFailed === 0;
  record.note = record.ok ? 'read' : (firstFailure ?? 'no_applications');
  return record;
}

const blankRoute = (route) => ({
  route,
  attempted: false,
  delivered: false,
  status: null,
  note: null,
  redirected: false,
  redirectSameHost: null,
  redirectToOracleCloud: null,
  contentType: '(none)',
  bytes: null,
  matchesLength: null,
  kind: null,
  tooLarge: false,
});

function finishRoute(route, answer, bytes, head, length) {
  route.attempted = answer.sent;
  route.status = answer.status;
  route.redirected = answer.redirected;
  route.redirectSameHost = answer.redirectSameHost;
  route.redirectToOracleCloud = answer.redirectToOracleCloud;
  route.contentType = answer.contentType;
  route.tooLarge = answer.tooLarge;
  route.note = answer.note ?? (answer.status === 200 ? null : noteForStatus(answer.status));
  if (answer.status !== 200 || route.note || bytes === null) return route;
  route.bytes = bytes;
  route.kind = classifyBytes(head);
  route.matchesLength = length === null ? null : bytes === length;
  route.delivered = bytes > 0 && route.matchesLength !== false;
  if (bytes === 0) route.note = 'empty_body';
  else route.note = route.matchesLength === false ? 'length_differs' : 'file_received';
  return route;
}

async function fileRoute(ctx, name, url, auth, skipNote, length) {
  const route = blankRoute(name);
  if (!url) {
    route.note = skipNote;
    return route;
  }
  const answer = await ctx.get(url, {
    auth,
    as: 'file',
    cap: FILE_CAP_BYTES,
    timeoutMs: DOWNLOAD_TIMEOUT_MS,
  });
  return finishRoute(route, answer, answer.bytes, answer.head, length);
}

async function base64Route(ctx, pick, attachment, length) {
  const route = { ...blankRoute('file_contents_base64'), builtByHand: false };
  const self = linkOf(ctx.origin, attachment, 'self');
  let url = self && self.origin === ctx.origin ? new URL(self.pathname, ctx.origin) : null;
  if (!url) {
    const id = idText(attachment?.AttachedDocumentId);
    if (!id) {
      route.note = 'no_item_link';
      return route;
    }
    url = new URL(`${withoutEndSlash(pick.childUrl.pathname)}/${id}`, ctx.origin);
    route.builtByHand = true;
  }
  url.search = '?fields=FileContents&onlyData=true';
  // This answer is JSON, so the JSON limit applies: a file above about 3.7 MB ends as "too_large".
  const answer = await ctx.get(url, { cap: JSON_CAP_BYTES, timeoutMs: DOWNLOAD_TIMEOUT_MS });
  if (answer.status !== 200 || answer.note) return finishRoute(route, answer, null, null, length);
  const text = has(answer.json, 'FileContents') ? answer.json.FileContents : null;
  if (typeof text !== 'string' || !text) {
    finishRoute(route, answer, null, null, length);
    route.note = 'field_not_returned';
    return route;
  }
  const data = Buffer.from(text, 'base64'); // held in memory for the checks below, then dropped
  return finishRoute(route, answer, data.length, data.subarray(0, HEAD_BYTES), length);
}

// 8. ONE attachment, every route that is on offer. The bytes are counted and dropped.
async function stepDownload(ctx, state) {
  const record = { step: 'download', ok: false, status: null, note: null };
  const pick = state.candidate;
  if (!pick) {
    record.note = 'no_file_attachment';
    return record;
  }
  // FileUrl can be a signed link that stops working after a while, so the attachment is read
  // again just before the download (the import will do the same).
  const wantedId = idText(pick.attachment?.AttachedDocumentId);
  const sameIn = (answer) => {
    const fresh = (answer.status === 200 && !answer.note ? itemsOf(answer.json) : null) ?? [];
    return (
      fresh.find((item) => wantedId !== null && idText(item?.AttachedDocumentId) === wantedId) ??
      (wantedId === null && isFile(fresh[pick.index]) ? fresh[pick.index] : null)
    );
  };
  const again = await readAttachments(ctx, state, pick.childUrl);
  const found = sameIn(again.answer);
  let attachment = found ?? pick.attachment;
  // The field list may cost the links (to confirm on the Oracle test environment). Without
  // links the probe could not tell "no enclosure link" from "links left out". Only then, and for
  // this ONE application only, the attachments are read once more without the field list.
  record.fullReadForLinks = 'not_needed';
  if (again.withFields && !Array.isArray(attachment?.links)) {
    const full = sameIn(await ctx.get(withQuery(pick.childUrl, '')));
    const hasLinks = Array.isArray(full?.links);
    record.fullReadForLinks = hasLinks ? 'links_found' : full ? 'still_no_links' : 'failed';
    if (hasLinks) attachment = full;
  }
  const length = countOf(attachment?.UploadedFileLength);
  record.readAgainFirst = Boolean(found);
  record.lengthStated = length !== null;

  const enclosure = enclosureLink(ctx, attachment);
  const link = fileUrl(ctx, attachment);
  // A file link on another host is not fetched, with or without sign-in. The import builds its
  // link from the saved host and FileUrl (plan 5.4, call F) and follows no redirect to another
  // host (plan section 6), so a fetch from another host would test a route it will not use.
  const elsewhere = link.where === 'otherHost' || link.where === 'otherOracleCloudHost';
  const absentNote = link.where === 'absent' ? 'no_file_url' : 'file_url_unreadable';
  const noLinkNote = elsewhere ? 'file_url_on_another_host' : absentNote;
  const routes = [
    await fileRoute(
      ctx,
      'enclosure_link',
      enclosure.url,
      true,
      enclosure.where === 'onAnotherHost' ? 'link_on_another_host' : 'not_advertised',
      length,
    ),
    await fileRoute(ctx, 'file_url_with_sign_in', link.url, true, noLinkNote, length),
    await fileRoute(ctx, 'file_url_without_sign_in', link.url, false, noLinkNote, length),
    await base64Route(ctx, pick, attachment, length),
  ];
  record.routes = routes;
  record.delivered = routes.filter((route) => route.delivered).map((route) => route.route);
  record.ok = record.delivered.length > 0;
  record.status = record.ok ? 200 : (routes.find((route) => route.status !== null)?.status ?? null);
  record.note = record.ok ? 'delivered' : 'no_route_delivered';
  return record;
}

// 9. Did Oracle send any throttling signal? Header NAMES only.
function stepSignals(ctx) {
  const headerNames = [...ctx.seen.headerNames].sort();
  const { otherRateLimitStyleHeaders, throttled429, unavailable503 } = ctx.seen;
  const any = headerNames.length > 0 || otherRateLimitStyleHeaders > 0 || throttled429 > 0;
  return {
    step: 'signals',
    ok: true,
    status: null,
    note: any ? 'signals_seen' : 'none_seen',
    headerNames,
    otherRateLimitStyleHeaders,
    throttled429,
    unavailable503,
  };
}

// ---------------------------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------------------------

const REQUISITION_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
// A printable user name without ":" (Basic sign-in splits the user name from the password there).
const USER_SHAPE = /^[^\s:\p{Cc}][^:\p{Cc}]{0,199}$/u;

/**
 * Runs the nine steps and returns the report object. `fetch` and `lookup` (the name lookup of
 * node:dns/promises) can be swapped for tests. `confirmTestPod` is the operator's word that the
 * address is the TEST environment, and `knownLabels` the labels the operator expects, both as
 * typed. `allowLoopbackForTests` may be set only by the test file.
 */
export async function runProbe(options = {}) {
  const { baseUrl, user, password, requisition, allowLoopbackForTests = false } = options;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const lookup = options.lookup ?? dnsLookup;
  const max = clampMaxApplications(options.maxApplications);
  const knownLabels = parseKnownLabels(options.knownLabels);
  const report = {
    probe: 'oracle-probe',
    reportVersion: 1,
    frameworkVersion: FRAMEWORK_VERSION,
    resourceVersion: BASE_PATH.split('/').pop(),
    target: null,
    hostLabel: null,
    operatorConfirmedTestPod: false,
    maxApplications: max,
    knownLabelsListed: knownLabels ? knownLabels.size : 0,
    notCovered: NOT_COVERED,
    partlyCovered: PARTLY_COVERED,
    ok: false,
    requests: 0,
    steps: [],
  };
  const skipped = (step, why) => ({ step, ok: false, status: null, note: `skipped_${why}` });

  const allowed = allowedOrigin(baseUrl, allowLoopbackForTests);
  const inputsFit =
    typeof user === 'string' &&
    USER_SHAPE.test(user) &&
    typeof password === 'string' &&
    password.length > 0 &&
    typeof requisition === 'string' &&
    REQUISITION_SHAPE.test(requisition) &&
    knownLabels !== null &&
    typeof lookup === 'function' &&
    typeof fetchImpl === 'function';
  if (!allowed || !inputsFit) {
    const why = allowed ? 'settings_not_valid' : 'address_not_allowed';
    report.steps = STEP_NAMES.map((step) => skipped(step, why));
    return report;
  }
  report.target = allowed.target;

  const origin = allowed.origin;
  const onOracle = allowed.target === 'oracle_cloud_host';
  if (onOracle) {
    // Nothing is sent until the operator has confirmed the TEST environment (see the header).
    const confirmation = testPodConfirmation(new URL(origin).hostname, options.confirmTestPod);
    report.hostLabel = confirmation.hostLabel;
    report.operatorConfirmedTestPod = confirmation.ok;
    if (!confirmation.ok) {
      report.steps = STEP_NAMES.map((step) => skipped(step, 'test_pod_not_confirmed'));
      return report;
    }
  }

  const sensitive = createSensitive([user, password, requisition, origin, new URL(origin).host]);
  const authorization = `Basic ${Buffer.from(`${user}:${password}`, 'utf8').toString('base64')}`;
  // The stand-in used by the tests is on 127.0.0.1, so the public-address check is left out there.
  const checkAddress = onOracle ? createAddressCheck(lookup) : undefined;
  const client = createClient({ origin, authorization, fetchImpl, checkAddress });
  const ctx = {
    origin,
    requisition,
    max,
    sensitive,
    knownLabels,
    get: client.get,
    seen: client.seen,
  };
  const state = { requisitionId: null, applications: [], candidate: null, fieldList: 'not_tried' };

  const run = async (step, blockedBy, action) => {
    let record;
    if (client.seen.halted) record = skipped(step, 'stopped_after_401');
    else if (blockedBy) record = skipped(step, blockedBy);
    else {
      const startedAt = performance.now();
      try {
        record = await action();
      } catch {
        // The error text is not used: it could repeat something Oracle sent.
        record = { step, ok: false, status: null, note: 'probe_error' };
      }
      record.elapsedMs = Math.round(performance.now() - startedAt);
    }
    report.steps.push(record);
    return record;
  };

  const signIn = await run('sign_in', null, () => stepSignIn(ctx));
  const noSignIn = signIn.ok ? null : 'not_signed_in';
  await run('find_requisition', noSignIn, () => stepFindRequisition(ctx, state));
  const noRequisition = noSignIn ?? (state.requisitionId ? null : 'no_requisition');
  await run('estimate', noRequisition, () => stepEstimate(ctx, state));
  await run('list_rowmatch', noRequisition, () => stepListRowMatch(ctx, state));
  await run('list_semicolon', noRequisition, () => stepListSemicolon(ctx, state));
  await run('list_offset', noRequisition, () => stepListOffset(ctx, state));
  const noApplications = noRequisition ?? (state.applications.length ? null : 'no_applications');
  await run('attachments', noApplications, () => stepAttachments(ctx, state));
  await run('download', noApplications, () => stepDownload(ctx, state));
  report.steps.push(stepSignals(ctx));

  report.requests = client.seen.requests;
  report.ok = REQUIRED_STEPS.every(
    (name) => report.steps.find((s) => s.step === name)?.ok === true,
  );
  return report;
}

// ---------------------------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------------------------

export const renderJson = (report) => `${JSON.stringify(report, null, 2)}\n`;

const yesNo = (value) => (value === true ? 'yes' : value === false ? 'no' : 'not known');
const pairs = (tally) =>
  Object.entries(tally ?? {})
    .map(([name, count]) => `${name} ${count}`)
    .join(', ') || 'none';

function detail(record) {
  switch (record.step) {
    case 'sign_in':
      if (record.status === 401) return 'user name + password refused; OAuth is not tried';
      return record.ok ? `sees vacancies: ${yesNo(record.seesRequisitions)}` : '';
    case 'find_requisition':
      return record.found
        ? `found: ${record.found}; fields missing: ${record.fieldsMissing.join(', ') || 'none'}`
        : '';
    case 'estimate':
      return record.ok ? `Oracle's estimate: ${record.totalResults}` : '';
    case 'list_rowmatch':
      return record.count === undefined
        ? ''
        : `${record.count} rows; more to come: ${yesNo(record.hasMore)}; ` +
            `flag filter accepted as: ${record.flagFilterAccepted.join(', ') || 'neither form'}; ` +
            `states: ${pairs(record.stateNames)}`;
    case 'list_offset':
      return record.repeated === undefined ? '' : `a row repeated: ${yesNo(record.repeated)}`;
    case 'attachments':
      return record.statuses === undefined
        ? ''
        : `${record.applicationsRead} applications read, ${record.applicationsWithoutFile} without a file; ` +
            `extensions: ${pairs(record.extensions)}`;
    case 'download':
      return record.routes
        ? `routes that delivered the file: ${record.delivered.join(', ') || 'none'}`
        : '';
    case 'signals':
      return record.headerNames?.length ? `headers: ${record.headerNames.join(', ')}` : '';
    default:
      return '';
  }
}

function targetLine(report) {
  if (report.target === 'test_loopback') return 'Target: the stand-in used by the tests.';
  if (report.target !== 'oracle_cloud_host') return 'Target: none. Nothing was sent.';
  if (!report.operatorConfirmedTestPod) {
    return 'Target: NOT confirmed as the TEST environment. Nothing was sent.';
  }
  const word = 'The operator confirmed it is the TEST environment and the vacancy is synthetic';
  if (report.hostLabel === 'test_style') {
    return `Target: an Oracle host whose name carries a test-style word. ${word}.`;
  }
  return (
    `Target: an Oracle host whose name carries NO test-style word. ${word}, in the second ` +
    'step. CHECK THIS before the report is used.'
  );
}

/** The short summary for the operator. It is built from the report alone. */
export function renderSummary(report) {
  const lines = [
    'Oracle probe: counts only. No name, e-mail, file name, identifier or link is printed. ' +
      'A label is shown only if it is listed in ORACLE_PROBE_KNOWN_LABELS.',
    targetLine(report),
  ];
  report.steps.forEach((record, i) => {
    const skippedStep = String(record.note).startsWith('skipped_');
    const result = record.ok ? 'ok' : skippedStep ? 'skipped' : 'FAILED';
    const extra = detail(record);
    lines.push(
      `${String(i + 1).padStart(2)} ${record.step.padEnd(17)} ${result.padEnd(8)} ` +
        `${String(record.status ?? '-').padEnd(4)} ${record.note ?? ''}${extra ? ` (${extra})` : ''}`,
    );
  });
  const verdict = report.ok
    ? 'PASS: steps 1, 2, 4 and 7 succeeded.'
    : 'NOT COMPLETE: steps 1, 2, 4 and 7 must all succeed.';
  lines.push(
    `${verdict} Requests sent: ${report.requests}. The full report is the JSON on standard output.`,
  );
  lines.push(
    'Not settled by this probe: sign-in by OAuth and region. Only in part: withdrawn and purged ' +
      'applicants, CVs kept only on the candidate profile. See the header of the script.',
  );
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------------------------

const REQUIRED_VARIABLES = [
  'ORACLE_PROBE_URL',
  'ORACLE_PROBE_USER',
  'ORACLE_PROBE_PASSWORD',
  'ORACLE_PROBE_REQUISITION',
  'ORACLE_PROBE_CONFIRM_TEST_POD',
];
const USAGE =
  `usage: set ${REQUIRED_VARIABLES.join(', ')} ` +
  '(and, if wanted, ORACLE_PROBE_MAX_APPLICATIONS and ORACLE_PROBE_KNOWN_LABELS) in the ' +
  'environment, then run "node scripts/oracle-probe.mjs" with no arguments; for the Oracle TEST ' +
  'environment and a synthetic vacancy only, never production';

/** Reads the settings from the environment. Values are never repeated in a message. */
export function readConfig(env) {
  const value = (name) => (typeof env[name] === 'string' ? env[name] : '');
  const missing = REQUIRED_VARIABLES.filter((name) => value(name).trim() === '');
  if (missing.length) return { error: `${USAGE} (missing: ${missing.join(', ')})` };

  const baseUrl = normaliseAddress(value('ORACLE_PROBE_URL'));
  if (!baseUrl || !isAllowedAddress(baseUrl)) {
    return {
      error:
        'ORACLE_PROBE_URL is not an Oracle address: it must start with https://, use the ' +
        'standard port, its host must end with .oraclecloud.com, and it must not hold a user ' +
        'name or password',
    };
  }
  const confirmTestPod = value('ORACLE_PROBE_CONFIRM_TEST_POD').trim();
  const confirmation = testPodConfirmation(new URL(baseUrl).hostname, confirmTestPod);
  if (!confirmation.ok) {
    const never = 'The probe must never be pointed at production or at real applicants.';
    return {
      error:
        confirmation.hostLabel === 'test_style'
          ? `ORACLE_PROBE_CONFIRM_TEST_POD must be "${CONFIRM_TEST_POD}": set it only after you ` +
            'have checked that the address is the Oracle TEST environment and that the vacancy ' +
            `holds invented applicants only. ${never}`
          : 'The host name in ORACLE_PROBE_URL carries no test-style word (such as -test or ' +
            `-dev), so "${CONFIRM_TEST_POD}" is not enough. ${never} If the Oracle team has ` +
            'confirmed in writing that this address is their TEST environment, set ' +
            `ORACLE_PROBE_CONFIRM_TEST_POD to "${CONFIRM_UNLABELLED_TEST_POD}"`,
    };
  }
  const user = value('ORACLE_PROBE_USER').trim();
  if (!USER_SHAPE.test(user)) {
    return { error: 'ORACLE_PROBE_USER is not usable: a user name cannot hold ":" or line breaks' };
  }
  const requisition = value('ORACLE_PROBE_REQUISITION').trim();
  if (!REQUISITION_SHAPE.test(requisition)) {
    return {
      error:
        'ORACLE_PROBE_REQUISITION is not usable: letters, digits, ".", "-" and "_" only, ' +
        'at most 64 characters',
    };
  }
  const rawMax = value('ORACLE_PROBE_MAX_APPLICATIONS').trim();
  if (rawMax !== '' && !/^[1-9]\d{0,8}$/.test(rawMax)) {
    return {
      error:
        'ORACLE_PROBE_MAX_APPLICATIONS must be a whole number, 1 or more ' +
        `(anything above ${MAX_APPLICATIONS_CEILING} is read as ${MAX_APPLICATIONS_CEILING})`,
    };
  }
  const knownLabels = value('ORACLE_PROBE_KNOWN_LABELS');
  if (parseKnownLabels(knownLabels) === null) {
    return {
      error:
        'ORACLE_PROBE_KNOWN_LABELS is not usable: label names separated by "|", each at most 60 ' +
        `characters with no "@", no long number and no odd characters, at most ${MAX_KNOWN_LABELS} names`,
    };
  }
  return {
    baseUrl,
    user,
    password: value('ORACLE_PROBE_PASSWORD'),
    requisition,
    confirmTestPod,
    knownLabels,
    maxApplications: clampMaxApplications(rawMax === '' ? undefined : rawMax),
  };
}

/** Returns the exit code. The JSON report goes to `stdout`, the short summary to `stderr`. */
export async function main({
  env = process.env,
  argv = process.argv.slice(2),
  fetch: fetchImpl = globalThis.fetch,
  lookup = dnsLookup,
  stdout = (text) => process.stdout.write(text),
  stderr = (text) => process.stderr.write(text),
} = {}) {
  if (argv.length > 0) {
    stderr(`${USAGE}\n`);
    return 2;
  }
  const config = readConfig(env);
  if (config.error) {
    stderr(`${config.error}\n`);
    return 2;
  }
  let report;
  try {
    report = await runProbe({
      baseUrl: config.baseUrl,
      user: config.user,
      password: config.password,
      requisition: config.requisition,
      confirmTestPod: config.confirmTestPod,
      knownLabels: config.knownLabels,
      maxApplications: config.maxApplications,
      fetch: fetchImpl,
      lookup,
    });
  } catch {
    stderr('oracle-probe: stopped on an unexpected error; no report was printed\n');
    return 1;
  }
  stdout(renderJson(report));
  stderr(renderSummary(report));
  return report.ok ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // exitCode, not exit(): the report must be flushed when standard output is a pipe or a file.
  process.exitCode = await main();
}
