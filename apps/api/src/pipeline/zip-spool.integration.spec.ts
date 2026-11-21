import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import JSZip from 'jszip';
import { describeDb } from '../testing/pg-harness';
import { boot, cv, type Harness } from '../testing/app-harness';
import { announce, itemRow, liveCount, ready, sendItem, textFile } from '../testing/stage3-upload';
import { IntakeService } from './intake.service';
import { iterateZip, unpackZip } from './zip-intake';
import { removeSpool, SPOOL_PREFIX, spoolToTemp, sweepSpools } from './zip-spool';

/* eslint-disable @typescript-eslint/no-explicit-any */

const FIX = join(__dirname, '../testing/fixtures/zips');
const LIMITS = {
  maxEntries: 1000,
  maxEntryBytes: 10 * 1024 * 1024,
  maxTotalBytes: 200 * 1024 * 1024,
  maxRatio: 200,
};
const mine = async () =>
  (await readdir(tmpdir())).filter((d) => d.startsWith(`${SPOOL_PREFIX}${process.pid}-`));

describe('ZIP spool and streaming reader (S3-UP-06, no database)', () => {
  it('spools a 90 MB stream with little memory, keeps at most the cap, and removes its folder', async () => {
    const mb = 1024 * 1024;
    global.gc?.();
    const before = process.memoryUsage();
    let peak = 0;
    const src = Readable.from(
      (function* () {
        for (let i = 0; i < 90; i++) {
          const m = process.memoryUsage();
          peak = Math.max(
            peak,
            m.heapUsed + m.arrayBuffers - before.heapUsed - before.arrayBuffers,
          );
          yield Buffer.alloc(mb, i);
        }
      })(),
    );
    const sp = await spoolToTemp(src, 100 * mb);
    expect(sp.bytes).toBe(90 * mb);
    expect(sp.tooLarge).toBe(false);
    expect((await stat(sp.path)).size).toBe(90 * mb);
    expect(peak).toBeLessThan(30 * mb);
    expect((await stat(sp.dir)).mode & 0o777).toBe(0o700);
    expect((await stat(sp.path)).mode & 0o777).toBe(0o600);
    await removeSpool(sp.dir);
    expect(await mine()).toEqual([]);

    // Over the cap: counted, never more than the cap on disk.
    const big = await spoolToTemp(
      Readable.from(Array.from({ length: 5 }, () => Buffer.alloc(mb, 1))),
      3 * mb,
    );
    expect(big).toMatchObject({ bytes: 5 * mb, tooLarge: true });
    expect((await stat(big.path)).size).toBe(3 * mb);
    await removeSpool(big.dir);

    // A stream that fails part-way leaves nothing behind.
    const broken = new Readable({
      read() {
        this.destroy(new Error('connection reset'));
      },
    });
    await expect(spoolToTemp(broken, mb)).rejects.toThrow(/reset/);
    expect(await mine()).toEqual([]);
  });

  it('the boot sweep removes folders of this process and of dead ones, and keeps those of live ones', async () => {
    const base = join(tmpdir(), `sweep-test-${process.pid}`);
    await mkdir(base, { recursive: true });
    await mkdir(join(base, `${SPOOL_PREFIX}${process.pid}-own`));
    await mkdir(join(base, `${SPOOL_PREFIX}999999-dead`));
    await mkdir(join(base, `${SPOOL_PREFIX}1-live`)); // pid 1 is always alive
    await mkdir(join(base, `unrelated`));
    expect(await sweepSpools(base)).toBe(2);
    expect((await readdir(base)).sort()).toEqual([`${SPOOL_PREFIX}1-live`, 'unrelated']);
    await rm(base, { recursive: true, force: true });
  });

  it('reads ZIPs made by Finder, Windows Explorer, 7-Zip and a stream writer', async () => {
    const finder = await unpackZip(join(FIX, 'finder.zip'), LIMITS);
    expect(finder.files.map((f) => f.name).sort()).toEqual([
      'CVs/Aysel_Huseynova.txt',
      'CVs/Rəşad_Quliyev.txt',
    ]);
    expect(finder.skipped).toEqual([]);
    const win = await unpackZip(join(FIX, 'windows.zip'), LIMITS);
    expect(win.files.map((f) => f.name).sort()).toEqual([
      'CVs/Elchin_Mammadov.txt',
      'CVs/Leyla_Aliyeva.txt',
    ]);
    const seven = await unpackZip(join(FIX, 'sevenzip.zip'), LIMITS);
    expect(seven.files.map((f) => f.name)).toEqual(['Farid_Huseynli.txt', 'Nigar_Rzayeva.md']);
    const streamed = await unpackZip(join(FIX, 'streamed.zip'), LIMITS);
    expect(streamed.files.map((f) => f.name)).toEqual(['Stream_One.txt', 'Stream_Two.txt']);
    expect(streamed.files[0]!.data.toString()).toContain('Name: Stream One');
  });

  it('a password-protected ZIP and a "PK" that is not a ZIP are refused whole', async () => {
    await expect(unpackZip(join(FIX, 'password.zip'), LIMITS)).rejects.toThrow(/password/);
    await expect(unpackZip(join(FIX, 'pk-not-really.zip'), LIMITS)).rejects.toThrow(
      /Couldn't open this ZIP/,
    );
  });

  it('gives the same entries, order and positions as the earlier in-memory reader', async () => {
    const z = new JSZip();
    z.file('a/one.txt', 'one');
    z.file('a/photo.jpg', 'jpg');
    z.file('a/inner.zip', 'PK');
    z.file('two.md', 'two');
    z.file('__MACOSX/a/._one.txt', 'x');
    const buf = await z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const seen: [number, string, string][] = [];
    for await (const e of iterateZip(buf, LIMITS))
      seen.push([e.index, e.name, e.kind === 'file' ? 'file' : e.code]);
    expect(seen).toEqual([
      [0, 'a/one.txt', 'file'],
      [1, 'a/photo.jpg', 'wrong_type'],
      [2, 'a/inner.zip', 'nested_archive'],
      [3, 'two.md', 'file'],
    ]);
  });

  it('100,000 entries: at most 1,000 examined plus one row, quickly', async () => {
    const z = new JSZip();
    for (let i = 0; i < 100_000; i++) z.file(`f${i}.txt`, '');
    const buf = await z.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
    const t0 = Date.now();
    let n = 0;
    let over = 0;
    for await (const e of iterateZip(buf, LIMITS)) {
      n++;
      if (e.kind === 'skipped' && e.code === 'too_many_entries') over++;
    }
    expect(n).toBe(1001);
    expect(over).toBe(1);
    expect(Date.now() - t0).toBeLessThan(60_000);
  }, 120_000);
});

describeDb('ZIP intake through the temp file (S3-UP-06)', () => {
  let h: Harness;
  const env = { ...process.env };
  beforeAll(async () => {
    process.env['TEST_VISIBILITY'] = 'all';
    process.env['MAX_ZIP_MB'] = '2';
    h = await boot('spool');
  });
  afterAll(async () => {
    await h?.close();
    process.env['TEST_VISIBILITY'] = env['TEST_VISIBILITY'];
    process.env['MAX_ZIP_MB'] = env['MAX_ZIP_MB'];
  });
  const zipOf = async (n: number, prefix: string) => {
    const z = new JSZip();
    for (let i = 0; i < n; i++)
      z.file(
        `${prefix}${i}.txt`,
        cv(`${prefix} Person ${'abcdefghijklmnop'[i]}`, ['BGP routing.']),
      );
    return z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  };

  it('a ZIP holds one permit: two loose files sent meanwhile are answered before the ZIP ends', async () => {
    const r = await h.recruiter('permit@azerconnect.test');
    const vid = await ready(r.api);
    const data = await zipOf(6, 'Zp');
    const loose = [textFile('Loose One Person'), textFile('Loose Two Person')];
    const b = (
      await announce(r.api, vid, [
        { name: 'slow.zip', size: data.length },
        ...loose.map((f) => ({ name: f.name, size: f.data.length })),
      ])
    ).json();
    const intake = h.app.get(IntakeService) as any;
    const orig = intake.admitFile.bind(intake);
    let inUseDuringZip = 0;
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const spy = jest.spyOn(intake, 'admitFile').mockImplementation(async (...a: any[]) => {
      if (a[3] === true) {
        // An entry of the ZIP: the ZIP holds exactly one permit; wait until the loose files are in.
        inUseDuringZip = Math.max(inUseDuringZip, intake.permits.inUse);
        await gate;
      }
      return orig(...a);
    });
    const order: string[] = [];
    const zipDone = sendItem(r.api, vid, b.items[0].itemId, {
      name: 'slow.zip',
      type: 'application/zip',
      data,
    }).then(() => order.push('zip'));
    await new Promise((res) => setTimeout(res, 150));
    await Promise.all(
      loose.map((f, k) =>
        sendItem(r.api, vid, b.items[k + 1].itemId, f).then(() => order.push(`loose${k}`)),
      ),
    );
    release();
    await zipDone;
    spy.mockRestore();
    expect(inUseDuringZip).toBe(1);
    expect(order.indexOf('zip')).toBe(2);
    expect(await liveCount(h, vid)).toBe(8);
    expect(await mine()).toEqual([]);
  });

  it('a ZIP over the limit is too_large and never more than the limit reaches the disk', async () => {
    const r = await h.recruiter('bigzip@azerconnect.test');
    const vid = await ready(r.api);
    const z = new JSZip();
    z.file('pad.txt', Buffer.alloc(3 * 1024 * 1024, 7), { compression: 'STORE' });
    const data = await z.generateAsync({ type: 'nodebuffer' });
    const b = (await announce(r.api, vid, [{ name: 'big.zip', size: 100 }])).json();
    const res = await sendItem(r.api, vid, b.items[0].itemId, {
      name: 'big.zip',
      type: 'application/zip',
      data,
    });
    expect(res.json().results[0]).toMatchObject({ status: 'rejected', code: 'too_large' });
    expect(await mine()).toEqual([]);
  });

  it('a password-protected ZIP is bad_zip with nothing stored; a "PK not really" is bad_zip', async () => {
    const r = await h.recruiter('pwzip@azerconnect.test');
    const vid = await ready(r.api);
    for (const name of ['password.zip', 'pk-not-really.zip']) {
      const data = await readFile(join(FIX, name));
      const b = (await announce(r.api, vid, [{ name, size: data.length }])).json();
      const res = await sendItem(r.api, vid, b.items[0].itemId, {
        name,
        type: 'application/zip',
        data,
      });
      expect(res.json().results).toEqual([
        expect.objectContaining({ status: 'rejected', code: 'bad_zip' }),
      ]);
    }
    expect(await liveCount(h, vid)).toBe(0);
  });

  it('too little free temp space: the ZIP is server_error, nothing written, and it may be sent again', async () => {
    const r = await h.recruiter('nospace@azerconnect.test');
    const vid = await ready(r.api);
    const data = await zipOf(2, 'Sp');
    const b = (await announce(r.api, vid, [{ name: 'tight.zip', size: data.length }])).json();
    const fs = jest.requireActual('./zip-spool') as typeof import('./zip-spool');
    const spy = jest.spyOn(fs, 'freeTempBytes').mockResolvedValueOnce(1024);
    const res = await sendItem(r.api, vid, b.items[0].itemId, {
      name: 'tight.zip',
      type: 'application/zip',
      data,
    });
    spy.mockRestore();
    expect(res.json().results[0]).toMatchObject({ status: 'skipped', code: 'server_error' });
    expect(await liveCount(h, vid)).toBe(0);
    expect(await itemRow(h, b.items[0].itemId)).toMatchObject({ code: 'server_error' });
    const again = await sendItem(r.api, vid, b.items[0].itemId, {
      name: 'tight.zip',
      type: 'application/zip',
      data,
    });
    expect(again.json().results[0]).toMatchObject({ status: 'queued', code: 'zip' });
    expect(await liveCount(h, vid)).toBe(2);
  });
});

/**
 * The three-ZIP memory check (S3-UP-06 check 2). Resident memory rises by no more than 80 MB while
 * three 90 MB ZIPs are read one after another. The 80 MB limit is fixed: it may change only by an
 * owner decision recorded in docs/decisions.md. Run with VOLUME_ZIP=1 (a test switch, not a setting).
 */
(process.env['VOLUME_ZIP'] === '1' ? describe : describe.skip)(
  'three 90 MB ZIPs (VOLUME_ZIP=1)',
  () => {
    it('reads three 90 MB ZIPs one after another with resident memory up by at most 80 MB', async () => {
      const mb = 1024 * 1024;
      const dir = join(tmpdir(), `volume-zip-${process.pid}`);
      await mkdir(dir, { recursive: true });
      const paths: string[] = [];
      for (let k = 0; k < 3; k++) {
        const z = new JSZip();
        // 9 entries of 10 MB of random-ish bytes (stored), so the ZIP is about 90 MB on disk.
        for (let i = 0; i < 9; i++) {
          const b = Buffer.alloc(10 * mb - 1024);
          for (let j = 0; j < b.length; j += 4) b.writeUInt32LE((j * 2654435761 + i + k) >>> 0, j);
          z.file(`cv${k}-${i}.txt`, b, { compression: 'STORE' });
        }
        const p = join(dir, `z${k}.zip`);
        await new Promise<void>((res, rej) =>
          z
            .generateNodeStream({ type: 'nodebuffer', streamFiles: true })
            .pipe(createWriteStream(p))
            .on('finish', () => res())
            .on('error', rej),
        );
        paths.push(p);
      }
      global.gc?.();
      const base = process.memoryUsage().rss;
      let peak = base;
      let entries = 0;
      for (const p of paths) {
        for await (const e of iterateZip(p, { ...LIMITS, maxEntryBytes: 10 * mb })) {
          entries++;
          expect(e.kind).toBe('file');
          peak = Math.max(peak, process.memoryUsage().rss);
        }
      }
      await rm(dir, { recursive: true, force: true });
      expect(entries).toBe(27);
      expect((peak - base) / mb).toBeLessThanOrEqual(80);
    }, 600_000);
  },
);
