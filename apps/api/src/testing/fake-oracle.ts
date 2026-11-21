/**
 * Stage 3 (plan 18.2): THE fake Oracle. One implementation, used by the API specs, the browser-test
 * stack (`e2e/fullstack/fake-oracle.mjs` compiles this file in memory) and the gate launcher. It
 * imports only Node built-ins, makes every ID and byte from a seed number, and holds no real CV.
 *
 * The factory returns `fetch` (goes into `OracleHcmClient.fetcher`), `lookup` (stands in for DNS),
 * `state` (requisitions, applications, attachments and switches) and `calls` (the call log).
 */
import { crc32 } from 'node:zlib';

export const FAKE_ORIGIN = 'https://parallax-test.fa.em2.oraclecloud.com';
export const FAKE_FOREIGN = 'https://elsewhere.fa.em2.oraclecloud.com';
export const FAKE_TOKEN_URL = 'https://idcs-parallax.identity.oraclecloud.com/oauth2/v1/token';
const BASE = '/hcmRestApi/resources/11.13.18.05';
const CONTENT = '/content/conn/FusionAppsContentRepository';
/** The plan's field list (a copy: this file imports nothing from the app). */
const ALLOWED = new Set([
  'RequisitionId',
  'RequisitionNumber',
  'Title',
  'StateName',
  'PhaseName',
  'JobApplicationId',
  'CandidatePersonId',
  'ConfirmedFlag',
  'DisqualifiedFlag',
  'InternalFlag',
  'JobApplicationDate',
  'LastUpdateDate',
  'AttachedDocumentId',
  'CategoryName',
  'DatatypeCode',
  'FileName',
  'UploadedFileLength',
  'DmDocumentId',
  'FileUrl',
  'FileContents',
]);

export type FileKind =
  'txt' | 'pdf' | 'docx' | 'doc' | 'docAsPdf' | 'noExtension' | 'oversize' | 'docxBomb';

export interface FakeAttachment {
  id: string;
  category: string;
  fileName: string;
  kind: FileKind;
  sizeBytes?: number;
  version: number;
  lastUpdate: string;
  datatype: 'FILE' | 'TEXT' | 'URL';
}
export interface FakeApplication {
  id: string;
  personId: string;
  confirmed: boolean;
  disqualified: boolean;
  internal: boolean;
  stateName: string;
  appliedAt: string;
  purged?: boolean;
  attachments: FakeAttachment[];
  /** The candidate name written inside the CV text (the scripted model reads it back). */
  name: string;
}
export interface FakeRequisition {
  id: string;
  number: string;
  title: string;
  state: string;
  /** What `totalResults` answers; defaults to the true count. */
  estimate?: number;
  applications: FakeApplication[];
}

export interface FakeSwitches {
  user: string;
  password: string;
  /** 401 on the API host: for every call, or from call n on. */
  auth: false | true | { fromCall: number };
  emptyScope: boolean;
  throttle: { times: number; retryAfter: number | string } | null;
  unavailable: { times: number } | 'until_lifted' | null;
  hang: 'headers' | 'body' | null;
  redirect: 'foreign' | 'same' | null;
  schemaChanged: boolean;
  download: 'fileUrl' | 'fileContents';
  /** A file link stops working after this many milliseconds (401 on the content path only). */
  fileUrlTtlMs: number;
  pageSize: number | null;
  pace: { secondsPerPage: number; bytesPerSecond: number } | null;
  /** OAuth: the client secret the token route accepts, and how long a token lives. */
  clientSecret: string;
  tokenSeconds: number;
}

export interface CallEntry {
  at: number;
  host: string;
  resource: string;
  queryKeys: string[];
  version: string | null;
  auth: 'basic' | 'bearer' | 'none';
  status: number;
  aborted: boolean;
  inFlight: number;
  overCollection: boolean;
  semicolon: boolean;
}

export interface SeedFile {
  kind?: FileKind;
  sizeBytes?: number;
}
export interface SeedRequisition {
  number: string;
  title?: string;
  applications: number;
  estimate?: number;
  /** Files per application, in order; a missing entry means one text CV. `null`: no file. */
  files?: (SeedFile | null)[];
}

// ------------------------------------------------------------------ seeded bytes

function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cvText = (name: string, extra = '') =>
  `Name: ${name}\nBGP routing in a carrier network.\nKubernetes operator for five years.\n${extra}\n${'Padding text for length. '.repeat(10)}`;

/** A small PDF with one page of text (offsets computed, so pdftotext reads it). */
export function makePdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const content = `BT /F1 10 Tf 50 760 Td ${lines.map((l, i) => `${i ? '0 -14 Td ' : ''}(${esc(l)}) Tj`).join(' ')} ET`;
  const objs = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    `<</Length ${Buffer.byteLength(content)}>>\nstream\n${content}\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];
  let out = '%PDF-1.4\n';
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** A ZIP with stored (uncompressed) entries, built with Node only. */
export function makeZip(entries: { name: string; data: Buffer }[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let off = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const crc = crc32(e.data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(e.data.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, e.data);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(e.data.length, 20);
    cen.writeUInt32LE(e.data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(off, 42);
    central.push(cen, name);
    off += 30 + name.length + e.data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}

/** A Word file of about the size asked for: the padding is an extra part Word never reads. */
export function makeDocxPadded(lines: string[], padding: Buffer): Buffer {
  const base = makeDocx(lines);
  return makeZip([...unzipStored(base), { name: 'customXml/padding.bin', data: padding }]);
}

/** Reads back the entries of a ZIP made by makeZip (stored entries only). */
function unzipStored(zip: Buffer): { name: string; data: Buffer }[] {
  const out: { name: string; data: Buffer }[] = [];
  let p = 0;
  while (p + 30 <= zip.length && zip.readUInt32LE(p) === 0x04034b50) {
    const size = zip.readUInt32LE(p + 18);
    const nameLen = zip.readUInt16LE(p + 26);
    const name = zip.subarray(p + 30, p + 30 + nameLen).toString('utf8');
    out.push({ name, data: zip.subarray(p + 30 + nameLen, p + 30 + nameLen + size) });
    p += 30 + nameLen + size;
  }
  return out;
}

export function makeDocx(lines: string[]): Buffer {
  const body = lines
    .map((l) => `<w:p><w:r><w:t xml:space="preserve">${l.replace(/[<&>]/g, ' ')}</w:t></w:r></w:p>`)
    .join('');
  return makeZip([
    {
      name: '[Content_Types].xml',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
    },
    {
      name: '_rels/.rels',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
    },
    {
      name: 'word/document.xml',
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
      ),
    },
  ]);
}

/** 0 -> A, 25 -> Z, 26 -> AA: names the scripted model can read back. */
const letters = (n: number) => {
  let out = '';
  for (let k = n; k >= 0; k = Math.floor(k / 26) - 1)
    out = String.fromCharCode(65 + (k % 26)) + out;
  return out;
};

const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

// ------------------------------------------------------------------ the factory

export interface FakeOracle {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  lookup: (host: string) => Promise<string[]>;
  state: {
    requisitions: Map<string, FakeRequisition>;
    switches: FakeSwitches;
    served: Map<string, number>;
  };
  calls: CallEntry[];
  seed(list: SeedRequisition[]): void;
  addRequisition(r: SeedRequisition): FakeRequisition;
  set(s: Partial<FakeSwitches>): void;
  reset(): void;
  bytesOf(att: FakeAttachment, app: FakeApplication): Buffer;
  replaceCv(applicationId: string): void;
  withdraw(applicationId: string): void;
  purge(applicationId: string): void;
  restore(applicationId: string): void;
  /** Holds every answer until `release()` (the gate pattern). */
  hold(): void;
  release(): void;
  inFlight(): number;
  maxInFlight: number;
  downloads(): number;
}

const DEFAULTS = (): FakeSwitches => ({
  user: 'parallax.integration',
  password: 'fake-oracle-password',
  auth: false,
  emptyScope: false,
  throttle: null,
  unavailable: null,
  hang: null,
  redirect: null,
  schemaChanged: false,
  download: 'fileUrl',
  fileUrlTtlMs: 5 * 60_000,
  pageSize: null,
  pace: null,
  clientSecret: 'fake-client-secret',
  tokenSeconds: 3600,
});

export function createFakeOracle(seedNumber = 1): FakeOracle {
  const rnd = prng(seedNumber);
  const requisitions = new Map<string, FakeRequisition>();
  let switches = DEFAULTS();
  const calls: CallEntry[] = [];
  const served = new Map<string, number>();
  const tokens = new Map<string, number>();
  let nextId = 300_000_000_000 + Math.floor(rnd() * 1000) * 1000;
  const id = () => String(++nextId);
  let inFlight = 0;
  let people = seedNumber * 1000;
  let held: (() => void)[] | null = null;
  let throttled = 0;
  let outages = 0;
  let apiCalls = 0;
  const fake: FakeOracle = {
    maxInFlight: 0,
  } as FakeOracle;

  const bytesOf = (att: FakeAttachment, app: FakeApplication): Buffer => {
    const lines = cvText(app.name, `Version ${att.version}.`).split('\n');
    let b: Buffer;
    switch (att.kind) {
      case 'pdf':
      case 'noExtension':
        b = makePdf(lines);
        break;
      case 'docx':
        b = makeDocx(lines);
        break;
      case 'doc':
      case 'docAsPdf':
        b = Buffer.concat([OLE, Buffer.alloc(512, 0)]);
        break;
      case 'docxBomb': {
        const many = Array.from({ length: 2_100 }, (_, i) => ({
          name: `x/${i}.xml`,
          data: Buffer.from('<a/>'),
        }));
        b = makeZip([{ name: 'word/document.xml', data: Buffer.from('<w:document/>') }, ...many]);
        break;
      }
      case 'oversize':
        b = Buffer.alloc(11 * 1024 * 1024, 0x41);
        break;
      default:
        b = Buffer.from(lines.join('\n'));
    }
    if (att.sizeBytes && att.sizeBytes > b.length) {
      // Seeded random padding Postgres cannot compress (the disk gate reads true), in a place each
      // format ignores: after the text, after a PDF's end marker, or in an extra Word package part.
      const r = prng(Number(att.id.slice(-9)) || 7);
      const pad = (n: number) => {
        const out = Buffer.alloc(Math.max(0, n));
        for (let i = 0; i < out.length; i++) out[i] = 32 + Math.floor(r() * 90);
        return out;
      };
      if (att.kind === 'txt')
        b = Buffer.concat([b, Buffer.from('\n'), pad(att.sizeBytes - b.length - 1)]);
      else if (att.kind === 'pdf' || att.kind === 'noExtension')
        b = Buffer.concat([b, Buffer.from('%'), pad(att.sizeBytes - b.length - 1)]);
      else if (att.kind === 'docx') b = makeDocxPadded(lines, pad(att.sizeBytes - b.length - 120));
    }
    return b;
  };

  const attachment = (app: FakeApplication, f: SeedFile | undefined, n: number): FakeAttachment => {
    const kind = f?.kind ?? 'txt';
    const ext =
      kind === 'pdf' || kind === 'docAsPdf'
        ? '.pdf'
        : kind === 'docx' || kind === 'docxBomb'
          ? '.docx'
          : kind === 'doc'
            ? '.doc'
            : kind === 'noExtension'
              ? ''
              : '.txt';
    return {
      id: id(),
      category: 'Resume',
      fileName:
        kind === 'noExtension'
          ? 'Resume'
          : `${app.name.replace(/\s/g, '_')}_CV${n > 1 ? `_${n}` : ''}${ext}`,
      kind,
      sizeBytes: f?.sizeBytes,
      version: 1,
      lastUpdate: new Date(Date.UTC(2026, 9, 1) + n * 1000).toISOString(),
      datatype: 'FILE',
    };
  };

  fake.addRequisition = (r: SeedRequisition) => {
    const req: FakeRequisition = {
      id: id(),
      number: r.number,
      title: r.title ?? `Synthetic vacancy ${r.number}`,
      state: 'Open',
      estimate: r.estimate,
      applications: [],
    };
    for (let k = 0; k < r.applications; k++) {
      const app: FakeApplication = {
        id: id(),
        personId: id(),
        confirmed: true,
        disqualified: false,
        internal: false,
        stateName: 'Active',
        appliedAt: new Date(Date.UTC(2026, 6, 1) + k * 3_600_000).toISOString(),
        name: `Applicant ${letters(++people)}`,
        attachments: [],
      };
      const f = r.files?.[k];
      if (f !== null) app.attachments.push(attachment(app, f ?? undefined, 1));
      req.applications.push(app);
    }
    requisitions.set(r.number, req);
    return req;
  };
  fake.seed = (list) => {
    requisitions.clear();
    for (const r of list) fake.addRequisition(r);
  };
  fake.set = (s) => {
    switches = { ...switches, ...s };
    if ('throttle' in s) throttled = 0;
    if ('unavailable' in s) outages = 0;
    if ('auth' in s) apiCalls = 0;
  };
  fake.reset = () => {
    switches = DEFAULTS();
    calls.length = 0;
    throttled = outages = apiCalls = 0;
  };
  fake.bytesOf = bytesOf;
  const findApp = (appId: string) => {
    for (const r of requisitions.values()) {
      const a = r.applications.find((x) => x.id === appId);
      if (a) return a;
    }
    return undefined;
  };
  fake.replaceCv = (appId) => {
    const a = findApp(appId)!;
    const old = a.attachments[0]!;
    a.attachments[0] = {
      ...old,
      id: id(),
      version: old.version + 1,
      lastUpdate: new Date().toISOString(),
    };
  };
  fake.withdraw = (appId) => {
    findApp(appId)!.stateName = 'Withdrawn';
  };
  fake.purge = (appId) => {
    findApp(appId)!.purged = true;
  };
  fake.restore = (appId) => {
    const a = findApp(appId)!;
    a.purged = false;
    a.stateName = 'Active';
  };
  fake.hold = () => {
    held ??= [];
  };
  fake.release = () => {
    const h = held;
    held = null;
    h?.forEach((go) => go());
  };
  fake.inFlight = () => inFlight;
  fake.downloads = () => calls.filter((c) => c.resource === 'file' && c.status === 200).length;
  fake.state = { requisitions, switches, served };
  Object.defineProperty(fake.state, 'switches', { get: () => switches });
  fake.calls = calls;

  fake.lookup = async (host: string) => {
    if (host.endsWith('.oraclecloud.com')) return ['129.146.10.20'];
    if (host === 'localhost') return ['127.0.0.1'];
    throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
  };

  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  const pick = (o: Record<string, unknown>, fields: string[] | null) =>
    fields ? Object.fromEntries(fields.filter((f) => f in o).map((f) => [f, o[f]])) : o;

  fake.fetch = async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const headers = new Headers(init.headers as ConstructorParameters<typeof Headers>[0]);
    const authz = headers.get('authorization') ?? '';
    const q = u.searchParams.get('q') ?? '';
    const fields = u.searchParams.get('fields')?.split(',').filter(Boolean) ?? null;
    const entry: CallEntry = {
      at: Date.now(),
      host: u.host,
      resource: resourceOf(u.pathname),
      queryKeys: [...u.searchParams.keys()],
      version: headers.get('rest-framework-version'),
      auth: authz.startsWith('Basic ') ? 'basic' : authz.startsWith('Bearer ') ? 'bearer' : 'none',
      status: 0,
      aborted: false,
      inFlight: 0,
      overCollection: Boolean(fields?.some((f) => !ALLOWED.has(f))),
      semicolon: q.includes(';'),
    };
    calls.push(entry);
    inFlight++;
    fake.maxInFlight = Math.max(fake.maxInFlight, inFlight);
    entry.inFlight = inFlight;
    const signal = init.signal ?? undefined;
    const abortable = <T>(p: Promise<T>) =>
      new Promise<T>((res, rej) => {
        if (signal?.aborted) {
          entry.aborted = true;
          return rej(new DOMException('aborted', 'AbortError'));
        }
        signal?.addEventListener('abort', () => {
          entry.aborted = true;
          rej(new DOMException('aborted', 'AbortError'));
        });
        p.then(res, rej);
      });
    try {
      if (held) await abortable(new Promise<void>((r) => held!.push(r)));
      const res = await abortable(route(u, entry, authz, fields, init));
      entry.status = res.status;
      return res;
    } finally {
      inFlight--;
    }
  };

  function resourceOf(path: string) {
    if (path.startsWith(CONTENT)) return 'file';
    if (path.includes('/oauth2/')) return 'token';
    if (path.includes('/child/attachments/')) return 'attachment';
    if (path.includes('/child/attachments')) return 'attachments';
    if (path.includes('recruitingJobApplications')) return 'recruitingJobApplications';
    if (path.includes('recruitingJobRequisitions')) return 'recruitingJobRequisitions';
    return path;
  }

  async function route(
    u: URL,
    entry: CallEntry,
    authz: string,
    fields: string[] | null,
    init: RequestInit,
  ): Promise<Response> {
    const s = switches;
    // The OAuth token route.
    if (u.origin + u.pathname === FAKE_TOKEN_URL) {
      const [, cred] = authz.split(' ');
      const secret = Buffer.from(cred ?? '', 'base64')
        .toString()
        .split(':')[1];
      if (secret !== s.clientSecret) return json(401, { error: 'invalid_client' });
      const t = `tok-${id()}`;
      tokens.set(t, Date.now() + s.tokenSeconds * 1000);
      void init;
      return json(200, { access_token: t, token_type: 'Bearer', expires_in: s.tokenSeconds });
    }
    if (u.origin === FAKE_FOREIGN) return json(200, { items: [] });
    if (u.origin !== FAKE_ORIGIN) return new Response('no such host', { status: 502 });
    if (s.hang === 'headers') await new Promise(() => undefined);
    // Sign-in.
    const isFile = u.pathname.startsWith(CONTENT);
    if (!isFile) apiCalls++;
    const authOk = (() => {
      if (authz.startsWith('Bearer ')) return (tokens.get(authz.slice(7)) ?? 0) > Date.now();
      const [user, pw] = Buffer.from(authz.replace(/^Basic /, ''), 'base64')
        .toString()
        .split(':');
      return user === s.user && pw === s.password;
    })();
    const forced =
      s.auth === true || (typeof s.auth === 'object' && s.auth && apiCalls >= s.auth.fromCall);
    if (!isFile && (!authOk || forced))
      return json(401, { title: 'Unauthorized', detail: 'MARKER-401-BODY' });
    if (s.throttle && throttled < s.throttle.times) {
      throttled++;
      return json(
        429,
        { title: 'Too Many Requests', detail: 'MARKER-429-BODY' },
        { 'retry-after': String(s.throttle.retryAfter) },
      );
    }
    if (s.unavailable === 'until_lifted' || (s.unavailable && outages < s.unavailable.times)) {
      outages++;
      return json(503, { title: 'Service Unavailable', detail: 'MARKER-503-BODY' });
    }
    if (s.redirect && !u.searchParams.has('redirected')) {
      const to = new URL(u.toString());
      to.searchParams.set('redirected', '1');
      const loc =
        s.redirect === 'foreign'
          ? `${FAKE_FOREIGN}${to.pathname}${to.search}`
          : `${to.pathname}${to.search}`;
      return new Response(null, { status: 302, headers: { location: loc } });
    }
    if (entry.version !== '4' && !isFile) entry.overCollection ||= false;
    const pace = s.pace;
    if (isFile) return file(u);
    const rest = u.pathname.slice(BASE.length + 1);
    // Requisitions.
    if (rest === 'recruitingJobRequisitions') {
      if (s.emptyScope) return json(200, { items: [], hasMore: false, count: 0 });
      const finder = u.searchParams.get('finder');
      const all = [...requisitions.values()];
      const hits = finder
        ? all.filter((r) => r.number === /RequisitionNumber=([^;&]+)/.exec(finder)?.[1])
        : all.slice(0, 1);
      return json(200, {
        items: hits.map((r) =>
          pick(
            s.schemaChanged
              ? { ReqId: r.id, RequisitionNumber: r.number, Title: r.title, StateName: r.state }
              : {
                  RequisitionId: r.id,
                  RequisitionNumber: r.number,
                  Title: r.title,
                  StateName: r.state,
                },
            fields,
          ),
        ),
        hasMore: false,
        count: hits.length,
      });
    }
    // Applications.
    if (rest === 'recruitingJobApplications') {
      const q = u.searchParams.get('q') ?? '';
      if (q.includes(';') && Number(entry.version) >= 2)
        return json(400, {
          title: 'Bad Request',
          'o:errorDetails': [{ detail: 'MARKER-400-BODY' }],
        });
      const reqId = /RequisitionId=(\d+)/.exec(q)?.[1];
      const after = /JobApplicationId > (\d+)/.exec(q)?.[1];
      const req = [...requisitions.values()].find((r) => r.id === reqId);
      if (s.emptyScope || !req)
        return json(200, { items: [], hasMore: false, count: 0, totalResults: 0 });
      const visible = req.applications
        .filter((a) => !a.purged)
        .sort((a, b) => a.id.localeCompare(b.id));
      const from = after ? visible.filter((a) => a.id > after) : visible;
      const limit = Math.min(s.pageSize ?? Number(u.searchParams.get('limit') ?? 25), 100);
      const offset = Number(u.searchParams.get('offset') ?? 0);
      const page = from.slice(offset, offset + limit);
      if (pace?.secondsPerPage) await new Promise((r) => setTimeout(r, pace.secondsPerPage * 1000));
      return json(200, {
        items: page.map((a) =>
          pick(
            {
              [s.schemaChanged ? 'ApplicationId' : 'JobApplicationId']: a.id,
              CandidatePersonId: a.personId,
              ConfirmedFlag: a.confirmed,
              DisqualifiedFlag: a.disqualified,
              InternalFlag: a.internal,
              StateName: a.stateName,
              PhaseName: 'Review',
              JobApplicationDate: a.appliedAt,
              LastUpdateDate: a.appliedAt,
            },
            fields,
          ),
        ),
        count: page.length,
        limit,
        offset,
        hasMore: offset + limit < from.length,
        ...(u.searchParams.get('totalResults') === 'true'
          ? { totalResults: req.estimate ?? visible.length }
          : {}),
      });
    }
    // Attachments of one application, and one attachment.
    const m = /^recruitingJobApplications\/([^/]+)\/child\/attachments(?:\/([^/?]+))?$/.exec(rest);
    if (m) {
      const app = findApp(decodeURIComponent(m[1]!));
      if (!app || app.purged) return json(404, { title: 'Not Found' });
      if (!m[2])
        return json(200, {
          items: app.attachments.map((t) =>
            pick(
              {
                AttachedDocumentId: t.id,
                CategoryName: t.category,
                DatatypeCode: t.datatype,
                FileName: t.fileName,
                UploadedFileLength: t.kind === 'oversize' ? 1200 : bytesOf(t, app).length,
                DmDocumentId: `DM${t.id}`,
                LastUpdateDate: t.lastUpdate,
              },
              fields,
            ),
          ),
          hasMore: false,
        });
      const att = app.attachments.find((t) => t.id === decodeURIComponent(m[2]!));
      if (!att) return json(404, { title: 'Not Found' });
      if (s.download === 'fileContents' || fields?.includes('FileContents'))
        return json(
          200,
          pick(
            { FileContents: bytesOf(att, app).toString('base64'), FileName: att.fileName },
            fields,
          ),
        );
      const exp = Date.now() + s.fileUrlTtlMs;
      return json(
        200,
        pick(
          { FileUrl: `${CONTENT}/${att.id}?app=${app.id}&exp=${exp}`, FileName: att.fileName },
          fields,
        ),
      );
    }
    return json(404, { title: 'Not Found' });
  }

  async function file(u: URL): Promise<Response> {
    const attId = u.pathname.slice(CONTENT.length + 1);
    const app = findApp(u.searchParams.get('app') ?? '');
    const att = app?.attachments.find((t) => t.id === attId);
    if (!app || !att) return new Response('gone', { status: 404 });
    if (Number(u.searchParams.get('exp')) < Date.now())
      return new Response('expired', { status: 401 });
    const bytes = bytesOf(att, app);
    served.set(att.id, (served.get(att.id) ?? 0) + bytes.length);
    const s = switches;
    if (s.hang === 'body' || att.kind === 'oversize' || s.pace?.bytesPerSecond) {
      // Chunks: the client must abort an oversize file as soon as it passes the cap.
      let sent = 0;
      const chunk = 256 * 1024;
      const stream = new ReadableStream<Uint8Array>({
        async pull(ctl) {
          if (sent >= bytes.length) return ctl.close();
          if (s.hang === 'body' && sent > 0) return new Promise(() => undefined);
          const part = bytes.subarray(sent, sent + chunk);
          sent += part.length;
          if (s.pace?.bytesPerSecond)
            await new Promise((r) => setTimeout(r, (part.length / s.pace!.bytesPerSecond) * 1000));
          ctl.enqueue(new Uint8Array(part));
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
      });
    }
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
    });
  }

  return fake;
}
