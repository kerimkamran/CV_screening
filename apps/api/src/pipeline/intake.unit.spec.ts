import http from 'node:http';
import type { AddressInfo } from 'node:net';
import JSZip from 'jszip';
import {
  decodeEntities,
  extractVacancy,
  htmlToText,
  isBlockedAddress,
  LinkProblem,
  LinkReader,
  robotsAllow,
} from './link-reader';
import { unpackZip } from './zip-intake';

const LIMITS = {
  maxEntries: 50,
  maxEntryBytes: 1024 * 1024,
  maxTotalBytes: 4 * 1024 * 1024,
  maxRatio: 100,
};
const zipOf = async (entries: Record<string, string | Buffer | null>) => {
  const z = new JSZip();
  for (const [name, data] of Object.entries(entries)) {
    if (data === null) z.folder(name);
    else z.file(name, data, { createFolders: false });
  }
  return z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
};

/** JSZip tidies names when it writes, so the unsafe names are swapped in afterwards, same length. */
const unsafe = (buf: Buffer, from: string, to: string) => {
  const a = Buffer.from(from);
  const b = Buffer.from(to);
  let i = buf.indexOf(a);
  while (i >= 0) {
    b.copy(buf, i);
    i = buf.indexOf(a, i + a.length);
  }
  return buf;
};

describe('safe ZIP unpacking (spec 6.1.4)', () => {
  it('unpacks resumes, ignores operating-system litter, and reports everything else', async () => {
    const buf = await zipOf({
      'batch/': null,
      'batch/alice.txt': 'Alice CV',
      'batch/bob.pdf': Buffer.from('%PDF-1.4 bob'),
      'batch/carol.docx': 'PK docx',
      '__MACOSX/batch/._alice.txt': 'junk',
      'batch/.DS_Store': 'junk',
      'batch/~$carol.docx': 'lock',
      'batch/photo.jpg': 'jpeg',
      'batch/inner.zip': 'PK nested',
      'xx/evil.pdf': 'x',
      'xetc/passwd.txt': 'x',
      'Cx/win.txt': 'x',
    });
    unsafe(buf, 'xx/evil.pdf', '../evil.pdf');
    unsafe(buf, 'xetc/passwd.txt', '/etc/passwd.txt');
    unsafe(buf, 'Cx/win.txt', 'C:/win.txt');
    const u = await unpackZip(buf, LIMITS);
    expect(u.files.map((f) => f.name).sort()).toEqual([
      'batch/alice.txt',
      'batch/bob.pdf',
      'batch/carol.docx',
      // The reader (JSZip) already flattens "../"; names are only labels, so it is harmless.
      'evil.pdf',
    ]);
    const why = Object.fromEntries(u.skipped.map((s) => [s.name, s.reason]));
    expect(why['batch/photo.jpg']).toBe('Only PDF, DOCX and TXT files');
    expect(why['batch/inner.zip']).toMatch(/archive inside the ZIP/);
    expect(Object.values(why).filter((r) => r === 'Unsafe file path')).toHaveLength(2);
    // Nothing is silently dropped except litter.
    expect(u.skipped).toHaveLength(4);
  });

  it('refuses a decompression bomb, an oversize file, too many files and a bad archive', async () => {
    const bomb = await zipOf({ 'a.txt': Buffer.alloc(8 * 1024 * 1024, 0), 'ok.txt': 'fine' });
    const u = await unpackZip(bomb, {
      ...LIMITS,
      maxEntryBytes: 16 * 1024 * 1024,
      maxTotalBytes: 64 * 1024 * 1024,
    });
    expect(u.files.map((f) => f.name)).toEqual(['ok.txt']);
    expect(u.skipped[0]).toMatchObject({
      name: 'a.txt',
      reason: 'Unusually compressed, not opened',
    });

    const big = await zipOf({
      'big.txt': Buffer.from(Array.from({ length: 300_000 }, (_, i) => String(i)).join(' ')),
    });
    expect((await unpackZip(big, { ...LIMITS, maxEntryBytes: 1000 })).skipped[0]!.reason).toBe(
      'Over the size limit',
    );

    const many = await zipOf(
      Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`f${i}.txt`, `cv ${i}`])),
    );
    const m = await unpackZip(many, { ...LIMITS, maxEntries: 4 });
    expect(m.files).toHaveLength(4);
    expect(m.skipped.map((s) => s.reason)).toEqual([
      'Too many files in the ZIP',
      'Too many files in the ZIP',
    ]);

    const total = await zipOf({ 'a.txt': 'x'.repeat(600), 'b.txt': 'y'.repeat(600) });
    const t = await unpackZip(total, { ...LIMITS, maxTotalBytes: 1000 });
    expect(t.files).toHaveLength(1);
    expect(t.skipped[0]!.reason).toBe('The ZIP is larger than the limit');

    await expect(unpackZip(Buffer.from('not a zip at all'), LIMITS)).rejects.toThrow(
      /Couldn't open this ZIP/,
    );
  });
});

describe('vacancy link: addresses and text', () => {
  it('blocks private, loopback, link-local, reserved and mapped addresses', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '255.255.255.255',
      '198.18.0.1',
      '::1',
      '::',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      'ff02::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      '::ffff:7f00:1',
      '64:ff9b::a00:1',
      '2001:db8::1',
      '2002:c0a8::1',
    ]) {
      expect(isBlockedAddress(ip)).toBe(true);
    }
    for (const ip of [
      '8.8.8.8',
      '1.1.1.1',
      '172.32.0.1',
      '93.184.216.34',
      '2606:4700:4700::1111',
      '::ffff:8.8.8.8',
    ]) {
      expect(isBlockedAddress(ip)).toBe(false);
    }
    expect(isBlockedAddress('127.0.0.1', true)).toBe(false);
    expect(isBlockedAddress('not-an-ip')).toBe(true);
  });

  it('reads robots.txt rules for our agent or everyone', () => {
    const r = 'User-agent: *\nDisallow: /private\nAllow: /private/jobs\nDisallow: /*.pdf$\n';
    expect(robotsAllow(r, '/jobs/1')).toBe(true);
    expect(robotsAllow(r, '/private/x')).toBe(false);
    expect(robotsAllow(r, '/private/jobs/2')).toBe(true);
    expect(robotsAllow(r, '/a/cv.pdf')).toBe(false);
    expect(robotsAllow('User-agent: AzerconnectVacancyReader\nDisallow: /\n', '/jobs')).toBe(false);
    expect(robotsAllow('User-agent: googlebot\nDisallow: /\n', '/jobs')).toBe(true);
    expect(robotsAllow('', '/anything')).toBe(true);
  });

  it('turns a page into text: no scripts, lists kept, entities decoded', () => {
    const t = htmlToText(
      '<h1>Network Engineer</h1><script>alert(1)</script><style>p{}</style><p>Run the core&nbsp;network &amp; BGP.</p><ul><li>Python</li><li>Kubernetes</li></ul><!-- hidden -->',
    );
    expect(t).toBe('Network Engineer\n\nRun the core network & BGP.\n\n- Python\n- Kubernetes');
    expect(decodeEntities('&#1040;&#x41;&unknown;')).toBe('АA&unknown;');
  });

  it('prefers the structured JobPosting text and otherwise the main content without menus', () => {
    const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
    const ld = `<html><head><title>Jobs | Acme</title><script type="application/ld+json">${JSON.stringify(
      {
        '@context': 'https://schema.org',
        '@type': 'JobPosting',
        title: 'Senior Network Engineer',
        description: `<p>${words(60)}</p><ul><li>BGP</li></ul>`,
      },
    )}</script></head><body><nav>Menu Home About</nav><p>cookie banner</p></body></html>`;
    const a = extractVacancy(ld);
    expect(a.title).toBe('Senior Network Engineer');
    expect(a.text).toContain('word59');
    expect(a.text).not.toContain('Menu Home');

    const plain = `<html><head><title>Role</title></head><body><nav>Menu Home About</nav><main><h1>Engineer</h1><p>${words(70)}</p></main><footer>Copyright</footer></body></html>`;
    const b = extractVacancy(plain);
    expect(b.text).toContain('word69');
    expect(b.text).not.toMatch(/Menu Home|Copyright/);
  });
});

describe('vacancy link: fetching safely', () => {
  let server: http.Server;
  let base: string;
  const words = (n: number) => Array.from({ length: n }, (_, i) => `skill${i}`).join(' ');
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = req.url ?? '';
      if (url === '/robots.txt') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        return void res.end('User-agent: *\nDisallow: /secret\n');
      }
      if (url === '/job') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return void res.end(
          `<html><head><title>Role</title></head><body><main><p>${words(80)}</p></main></body></html>`,
        );
      }
      if (url === '/secret') {
        res.writeHead(200, { 'content-type': 'text/html' });
        return void res.end(`<p>${words(80)}</p>`);
      }
      if (url === '/short') {
        res.writeHead(200, { 'content-type': 'text/html' });
        return void res.end('<p>Please sign in</p>');
      }
      if (url === '/pdf') {
        res.writeHead(200, { 'content-type': 'application/pdf' });
        return void res.end('%PDF-1.4');
      }
      if (url === '/to-metadata') {
        res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
        return void res.end();
      }
      if (url === '/loop') {
        res.writeHead(302, { location: '/loop' });
        return void res.end();
      }
      if (url === '/cookie') {
        res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'a=b' });
        return void res.end(`<p>${words(60)} ${JSON.stringify(req.headers.cookie ?? 'none')}</p>`);
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const local = new LinkReader({ allowLoopback: true, timeoutMs: 3000 });
  const kind = async (p: Promise<unknown>) => {
    try {
      await p;
      return 'ok';
    } catch (e) {
      return e instanceof LinkProblem ? e.kind : `other:${(e as Error).message}`;
    }
  };

  it('reads a page and returns only text and the host', async () => {
    const r = await local.read(`${base}/job`);
    expect(r.host).toBe('127.0.0.1');
    expect(r.title).toBe('Role');
    expect(r.words).toBe(80);
    expect(r.truncated).toBe(false);
    const c = await local.read(`${base}/cookie`);
    expect(c.text).toContain('"none"'); // no cookies are sent
  });

  it('never fetches a loopback or internal address in normal operation', async () => {
    const strict = new LinkReader({ timeoutMs: 3000 });
    expect(await kind(strict.read(`${base}/job`))).toBe('blocked');
    for (const u of [
      'http://localhost/job',
      'http://[::1]/',
      'http://10.0.0.5/',
      'http://2130706433/',
      'http://169.254.169.254/latest/',
      'http://foo.internal/',
      'http://example.com:8080/',
    ]) {
      expect(await kind(strict.read(u))).toBe('blocked');
    }
  });

  it('re-checks every redirect, and stops redirect loops', async () => {
    expect(await kind(local.read(`${base}/to-metadata`))).toBe('blocked');
    expect(await kind(local.read(`${base}/loop`))).toBe('unreadable');
  });

  it('refuses odd addresses and unreadable pages with plain kinds', async () => {
    expect(await kind(local.read('ftp://example.com/x'))).toBe('invalid');
    expect(await kind(local.read('https://user:pw@example.com/x'))).toBe('invalid');
    expect(await kind(local.read('not a url'))).toBe('invalid');
    expect(await kind(local.read(`${base}/secret`))).toBe('unreadable'); // robots.txt
    expect(await kind(local.read(`${base}/short`))).toBe('unreadable'); // a login wall, not a vacancy
    expect(await kind(local.read(`${base}/pdf`))).toBe('unreadable');
    expect(await kind(local.read(`${base}/missing`))).toBe('unreadable');
  });
});
