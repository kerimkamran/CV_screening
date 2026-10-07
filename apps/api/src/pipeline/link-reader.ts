import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

/**
 * Reads the text of a public vacancy page (design spec 6.1.3, "Vacancy link").
 *
 * The server fetches, never the browser. Because the address comes from a person, it is treated as
 * hostile: only http and https on the normal ports, no credentials in the address, no private,
 * loopback, link-local or reserved destinations (checked on the address actually connected to, so a
 * name that later points inside the network does not help, and again after every redirect), a
 * timeout, a size limit, no cookies, and the site's robots.txt is respected. Scripts are dropped.
 * Only the extracted text is returned; nothing is stored here.
 */

export class LinkProblem extends Error {
  constructor(
    readonly kind: 'invalid' | 'blocked' | 'unreadable',
    message: string,
  ) {
    super(message);
  }
}

export interface LinkOptions {
  /** Tests only: allow loopback so a local server can stand in for a job board. */
  allowLoopback?: boolean;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  userAgent?: string;
}

const UA = 'AzerconnectVacancyReader/1.0 (+reads one public vacancy page for the person who asked)';
export const MAX_TEXT = 20_000;
export const MIN_WORDS = 40;

// ----------------------------------------------------------------------------- addresses

const V4_BLOCKED: [string, number][] = [
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
const v4 = (ip: string) => ip.split('.').reduce((n, o) => (n * 256 + Number(o)) >>> 0, 0) >>> 0;
const inV4 = (ip: string, [base, bits]: [string, number]) => {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (v4(ip) & mask) >>> 0 === (v4(base) & mask) >>> 0;
};

/** True when the address must never be fetched on a person's behalf. */
export function isBlockedAddress(ip: string, allowLoopback = false): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) {
    if (allowLoopback && ip.startsWith('127.')) return false;
    return V4_BLOCKED.some((r) => inV4(ip, r));
  }
  if (kind === 6) {
    const a = ip.toLowerCase();
    if (a === '::1') return !allowLoopback;
    if (a === '::') return true;
    // IPv4 inside IPv6 (::ffff:1.2.3.4, NAT64): judge the embedded address.
    const mapped = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(a);
    if (mapped) return isBlockedAddress(mapped[1]!, allowLoopback);
    const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(a);
    if (hex) {
      const n = (parseInt(hex[1]!, 16) << 16) | parseInt(hex[2]!, 16);
      const dotted = [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');
      return isBlockedAddress(dotted, allowLoopback);
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

/** `net` calls this to resolve the name; refusing here covers the address really connected to. */
function guardedLookup(allowLoopback: boolean) {
  return (
    host: string,
    options: dns.LookupOptions | number | undefined,
    cb: (err: Error | null, address?: unknown, family?: number) => void,
  ) => {
    dns.lookup(host, { all: true, verbatim: true }, (err, addrs) => {
      if (err) return cb(err);
      if (!addrs.length || addrs.some((a) => isBlockedAddress(a.address, allowLoopback))) {
        return cb(new LinkProblem('blocked', 'That address is not allowed'));
      }
      const wantAll = typeof options === 'object' && options?.all;
      if (wantAll) return cb(null, addrs);
      cb(null, addrs[0]!.address, addrs[0]!.family);
    });
  };
}

// ----------------------------------------------------------------------------- fetching

function checkUrl(raw: string, allowLoopback: boolean): URL {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new LinkProblem('invalid', 'Enter a full web address that starts with https://');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:')
    throw new LinkProblem('invalid', 'Only web addresses (http or https) can be read');
  if (u.username || u.password)
    throw new LinkProblem('invalid', 'Leave the user name and password out of the address');
  const port = u.port || (u.protocol === 'https:' ? '443' : '80');
  if (port !== '80' && port !== '443' && !allowLoopback)
    throw new LinkProblem('blocked', 'That address is not allowed');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && isBlockedAddress(host, allowLoopback))
    throw new LinkProblem('blocked', 'That address is not allowed');
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host) && !allowLoopback)
    throw new LinkProblem('blocked', 'That address is not allowed');
  return u;
}

interface Got {
  status: number;
  location?: string;
  type: string;
  body: Buffer;
}

export class LinkReader {
  private readonly o: Required<LinkOptions>;
  constructor(o: LinkOptions = {}) {
    this.o = {
      allowLoopback: o.allowLoopback ?? false,
      timeoutMs: o.timeoutMs ?? 10_000,
      maxBytes: o.maxBytes ?? 1_500_000,
      maxRedirects: o.maxRedirects ?? 4,
      userAgent: o.userAgent ?? UA,
    };
  }

  private get(u: URL, maxBytes: number): Promise<Got> {
    return new Promise((resolve, reject) => {
      const lib = u.protocol === 'https:' ? https : http;
      let done = false;
      const finish = (fn: () => void) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        fn();
      };
      const req = lib.request(
        {
          protocol: u.protocol,
          hostname: u.hostname.replace(/^\[|\]$/g, ''),
          port: u.port || undefined,
          path: `${u.pathname}${u.search}`,
          method: 'GET',
          // No cookies, no credentials, no compression to unpack.
          headers: {
            'user-agent': this.o.userAgent,
            accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.1',
            'accept-encoding': 'identity',
          },
          lookup: guardedLookup(this.o.allowLoopback) as never,
          agent: false,
        },
        (res) => {
          const chunks: Buffer[] = [];
          let n = 0;
          res.on('data', (c: Buffer) => {
            n += c.length;
            chunks.push(c);
            if (n > maxBytes) {
              res.destroy();
              finish(() =>
                resolve({
                  status: res.statusCode ?? 0,
                  location: res.headers.location,
                  type: String(res.headers['content-type'] ?? ''),
                  body: Buffer.concat(chunks).subarray(0, maxBytes),
                }),
              );
            }
          });
          res.on('end', () =>
            finish(() =>
              resolve({
                status: res.statusCode ?? 0,
                location: res.headers.location,
                type: String(res.headers['content-type'] ?? ''),
                body: Buffer.concat(chunks),
              }),
            ),
          );
          res.on('error', (e) => finish(() => reject(e)));
        },
      );
      const timer = setTimeout(() => {
        req.destroy();
        finish(() => reject(new LinkProblem('unreadable', 'The page took too long')));
      }, this.o.timeoutMs);
      req.on('error', (e) => finish(() => reject(e)));
      req.end();
    });
  }

  /** Respect robots.txt where practical: a missing or unreadable file means "allowed". */
  private async robotsAllows(u: URL): Promise<boolean> {
    try {
      const r = await this.get(new URL('/robots.txt', u), 100_000);
      if (r.status !== 200) return true;
      return robotsAllow(r.body.toString('utf8'), u.pathname + u.search);
    } catch (e) {
      if (e instanceof LinkProblem && e.kind === 'blocked') throw e;
      return true;
    }
  }

  async read(raw: string): Promise<{
    host: string;
    title: string | null;
    text: string;
    words: number;
    truncated: boolean;
  }> {
    let u = checkUrl(raw, this.o.allowLoopback);
    try {
      for (let hop = 0; hop <= this.o.maxRedirects; hop++) {
        if (!(await this.robotsAllows(u)))
          throw new LinkProblem('unreadable', 'The site asks not to be read automatically');
        const r = await this.get(u, this.o.maxBytes);
        if ([301, 302, 303, 307, 308].includes(r.status) && r.location) {
          u = checkUrl(new URL(r.location, u).toString(), this.o.allowLoopback);
          continue;
        }
        if (r.status !== 200) throw new LinkProblem('unreadable', `The page answered ${r.status}`);
        if (!/^(text\/html|application\/xhtml\+xml|text\/plain)/i.test(r.type))
          throw new LinkProblem('unreadable', 'That is not a web page');
        const html = r.body.toString('utf8');
        const extracted = /^text\/plain/i.test(r.type)
          ? { title: null, text: tidy(html) }
          : extractVacancy(html);
        const words = extracted.text.split(/\s+/).filter(Boolean).length;
        if (words < MIN_WORDS) throw new LinkProblem('unreadable', 'Not enough text on the page');
        const truncated = extracted.text.length > MAX_TEXT;
        const text = truncated ? extracted.text.slice(0, MAX_TEXT) : extracted.text;
        return {
          host: u.hostname,
          title: extracted.title,
          text,
          words: text.split(/\s+/).filter(Boolean).length,
          truncated,
        };
      }
      throw new LinkProblem('unreadable', 'Too many redirects');
    } catch (e) {
      if (e instanceof LinkProblem) throw e;
      const err = e as Error & { cause?: unknown };
      if (err.cause instanceof LinkProblem) throw err.cause;
      throw new LinkProblem('unreadable', err.message || 'The page could not be reached');
    }
  }
}

// ----------------------------------------------------------------------------- robots.txt

/** Minimal robots.txt: our agent or "*", Disallow/Allow by prefix, longest match wins. */
export function robotsAllow(
  body: string,
  path: string,
  agent = 'azerconnectvacancyreader',
): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([a-zA-Z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const val = m[2]!.trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) groups.push((cur = { agents: [], rules: [] }));
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (cur && (key === 'disallow' || key === 'allow') && val) {
      cur.rules.push({ allow: key === 'allow', path: val });
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && agent.includes(a))) || [];
  const use = mine.length ? mine : groups.filter((g) => g.agents.includes('*'));
  let best: { allow: boolean; len: number } | null = null;
  for (const g of use) {
    for (const r of g.rules) {
      const re = new RegExp(
        '^' +
          r.path
            .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
            .replace(/\*/g, '.*')
            .replace(/\\\$$/, '$'),
      );
      if (
        re.test(path) &&
        (!best || r.path.length > best.len || (r.path.length === best.len && r.allow))
      ) {
        best = { allow: r.allow, len: r.path.length };
      }
    }
  }
  return best ? best.allow : true;
}

// ----------------------------------------------------------------------------- text

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  bull: '•',
  middot: '·',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
};
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code =
        e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Whitespace tidy: single spaces, at most one blank line. */
const tidy = (t: string) =>
  t
    .replace(/\r/g, '')
    .replace(/[ \t\f\v\u00a0]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** HTML to readable text: scripts and styles dropped, block ends become line breaks, lists keep dashes. */
export function htmlToText(html: string): string {
  const t = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(
      /<(script|style|noscript|svg|template|iframe|canvas|select|button)\b[\s\S]*?<\/\1\s*>/gi,
      ' ',
    )
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(
      /<\/(p|div|section|article|h[1-6]|tr|ul|ol|table|header|footer|blockquote)\s*>/gi,
      '\n',
    )
    .replace(/<(p|h[1-6]|tr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return tidy(decodeEntities(t));
}

function jobPosting(html: string): { title: string | null; text: string } | null {
  const blocks = [
    ...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
  ];
  const found: Record<string, unknown>[] = [];
  const walk = (x: unknown) => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (!x || typeof x !== 'object') return;
    const o = x as Record<string, unknown>;
    const t = o['@type'];
    if (t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'))) found.push(o);
    if (o['@graph']) walk(o['@graph']);
  };
  for (const b of blocks) {
    try {
      walk(JSON.parse(b[1]!));
    } catch {
      /* not every block is valid JSON */
    }
  }
  const j = found[0];
  if (!j) return null;
  const str = (v: unknown): string =>
    typeof v === 'string'
      ? htmlToText(v)
      : Array.isArray(v)
        ? v.map(str).filter(Boolean).join('\n')
        : '';
  const title = typeof j.title === 'string' ? decodeEntities(j.title).trim() : null;
  const parts = [
    title,
    str(j.description),
    str(j.responsibilities) && `Responsibilities:\n${str(j.responsibilities)}`,
    str(j.qualifications) && `Qualifications:\n${str(j.qualifications)}`,
    str(j.skills) && `Skills:\n${str(j.skills)}`,
    str(j.experienceRequirements) && `Experience:\n${str(j.experienceRequirements)}`,
  ].filter(Boolean);
  return { title, text: tidy(parts.join('\n\n')) };
}

const wc = (t: string) => t.split(/\s+/).filter(Boolean).length;

export function extractVacancy(html: string): { title: string | null; text: string } {
  const ld = jobPosting(html);
  const pageTitle = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const title = ld?.title ?? (pageTitle ? tidy(decodeEntities(pageTitle)) : null);
  if (ld && wc(ld.text) >= MIN_WORDS) return { title, text: ld.text };
  const body = /<body\b[\s\S]*<\/body>/i.exec(html)?.[0] ?? html;
  const main =
    /<main\b[\s\S]*?<\/main>/i.exec(body)?.[0] ?? /<article\b[\s\S]*?<\/article>/i.exec(body)?.[0];
  const stripped = body.replace(/<(nav|header|footer|aside|form)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  const a = main ? htmlToText(main) : '';
  const text = wc(a) >= MIN_WORDS ? a : htmlToText(stripped);
  return { title, text };
}
