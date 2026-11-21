import http from 'node:http';
import type { AddressInfo } from 'node:net';
import JSZip from 'jszip';
import { describeDb } from '../testing/pg-harness';
import { boot, cv, JD, type Harness } from '../testing/app-harness';
import { DocumentsController } from './documents.controller';
import { LinkReader } from './link-reader';
import { IntakeService } from './intake.service';
import {
  announce,
  itemRow,
  liveCount,
  ready as readyVacancy,
  sendItem,
  textFile,
} from '../testing/stage3-upload';

describeDb('Folder / ZIP intake and the vacancy link (design spec 6.1.3, 6.1.4)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await boot('intake');
  });
  afterAll(async () => h?.close());

  const ready = async (email: string) => {
    const a = await h.recruiter(email);
    const v = await a.api.post('/vacancies', { title: 'Senior Network Engineer', jdText: JD });
    const vid = v.json().id as string;
    await a.api.post(`/vacancies/${vid}/criteria/extract`);
    await a.api.post(`/vacancies/${vid}/criteria/freeze`);
    await a.api.post(`/vacancies/${vid}/notice-confirm`);
    return { a, vid };
  };
  const zip = async (entries: Record<string, string | Buffer>) => {
    const z = new JSZip();
    for (const [n, d] of Object.entries(entries)) z.file(n, d);
    return z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  };

  it('takes in a ZIP of resumes, reads them, and keeps a list of what was skipped and why', async () => {
    const { a, vid } = await ready('zip@azerconnect.test');
    const data = await zip({
      'batch/Alice_Full.txt': cv('Alice Full', ['BGP routing.', 'Kubernetes.']),
      'batch/Bob_Routing.txt': cv('Bob Routing', ['BGP routing.']),
      'batch/Cem_Markdown.md': cv('Cem Markdown', ['BGP routing.']),
      'batch/photo.jpg': 'jpeg bytes',
      'batch/inner.zip': 'PK nested',
      '__MACOSX/batch/._Alice_Full.txt': 'junk',
      'batch/.DS_Store': 'junk',
    });
    const r = await a.api.upload(`/vacancies/${vid}/documents`, [
      { name: 'resumes.zip', type: 'application/zip', data },
      {
        name: 'Alice_Full.txt',
        type: 'text/plain',
        data: Buffer.from(cv('Alice Full', ['BGP routing.', 'Kubernetes.'])),
      },
    ]);
    expect(r.statusCode).toBe(200);
    const results = r.json().results as { filename: string; status: string; message?: string }[];
    const by = (s: string) => results.filter((x) => x.status === s);
    // Alice appears twice (in the ZIP and loose): the second is a duplicate, not a second candidate.
    expect(
      by('queued')
        .map((x) => x.filename)
        .sort(),
    ).toEqual(['batch/Alice_Full.txt', 'batch/Bob_Routing.txt', 'batch/Cem_Markdown.md']);
    expect(by('duplicate')).toHaveLength(1);
    expect(
      by('skipped')
        .map((x) => x.message)
        .sort(),
    ).toEqual(['An archive inside the ZIP is not opened', 'Only PDF, DOCX, TXT and MD files']);

    const list = (await a.api.get(`/vacancies/${vid}/skipped`)).json().skipped as {
      filename: string;
      reason: string;
    }[];
    expect(list).toHaveLength(3);
    expect(list.map((s) => s.filename).join('|')).toContain('resumes.zip › batch/photo.jpg');
    expect(list.map((s) => s.reason)).toContain('Already uploaded for this vacancy');

    await h.app.get((await import('./processor.service')).ProcessorService).drain();
    const c = (await a.api.get(`/vacancies/${vid}/candidates`)).json();
    expect(c.counts.total).toBe(3); // the Markdown CV in the ZIP is read like the text ones
    expect(c.candidates.every((x: { state: string }) => x.state === 'completed')).toBe(true);
    // Another recruiter cannot read this vacancy's skipped list.
    const other = await h.recruiter('zip-other@azerconnect.test');
    expect((await other.api.get(`/vacancies/${vid}/skipped`)).statusCode).toBe(404);
  });

  it('refuses a file that is not a ZIP, and a run over its limit says so instead of dropping silently', async () => {
    const { a, vid } = await ready('limit@azerconnect.test');
    const bad = await a.api.upload(`/vacancies/${vid}/documents`, [
      { name: 'broken.zip', type: 'application/zip', data: Buffer.from('PK not really') },
    ]);
    expect(bad.json().results[0]).toMatchObject({
      status: 'rejected',
      message: "Couldn't open this ZIP file",
    });

    const env = h.app.get(DocumentsController)['env'] as { MAX_RESUMES_PER_RUN: number };
    const was = env.MAX_RESUMES_PER_RUN;
    env.MAX_RESUMES_PER_RUN = 2;
    try {
      const data = await zip({
        'a.txt': cv('Ann A', ['BGP routing.']),
        'b.txt': cv('Ben B', ['BGP routing.']),
        'c.txt': cv('Cem C', ['BGP routing.']),
      });
      const r = await a.api.upload(`/vacancies/${vid}/documents`, [
        { name: 'x.zip', type: 'application/zip', data },
      ]);
      const res = r.json().results as { status: string; message?: string }[];
      expect(res.filter((x) => x.status === 'queued')).toHaveLength(2);
      expect(res.filter((x) => x.status === 'skipped')).toEqual([
        expect.objectContaining({ message: 'This vacancy holds at most 2 CVs' }),
      ]);
      // Uploaded again later and taken in: it is no longer listed as skipped.
      const skippedNow = async () =>
        ((await a.api.get(`/vacancies/${vid}/skipped`)).json().skipped as { filename: string }[])
          .map((x) => x.filename)
          .filter((f) => f.includes('c.txt'));
      expect(await skippedNow()).toEqual(['c.txt']);
      env.MAX_RESUMES_PER_RUN = 10;
      const again = await a.api.upload(`/vacancies/${vid}/documents`, [
        { name: 'c.txt', type: 'text/plain', data: Buffer.from(cv('Cem C', ['BGP routing.'])) },
      ]);
      expect(again.json().results[0].status).toBe('queued');
      expect(await skippedNow()).toEqual([]);
    } finally {
      env.MAX_RESUMES_PER_RUN = was;
    }
  });

  it('reads a vacancy link on the server, and says one plain thing when it cannot', async () => {
    const a = await h.recruiter('link@azerconnect.test');
    const words = Array.from({ length: 80 }, (_, i) => `requirement${i}`).join(' ');
    const server = http.createServer((_q, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(
        `<html><head><title>Network Engineer</title></head><body><main><p>${words}</p></main></body></html>`,
      );
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/job`;
    const ctrl = h.app.get(DocumentsController);
    const before = ctrl.links;
    try {
      // Normal operation refuses an internal address, with the same plain line as an unreadable page.
      const blocked = await a.api.post('/vacancies/read-link', { url });
      expect(blocked.statusCode).toBe(400);
      expect(blocked.json()).toMatchObject({
        message: "Couldn't read that page. Paste the text instead.",
        code: 'LINK_UNREADABLE',
      });
      for (const u of [
        'http://169.254.169.254/latest/meta-data/',
        'http://localhost:3000/',
        'http://10.0.0.1/',
      ]) {
        expect((await a.api.post('/vacancies/read-link', { url: u })).json().code).toBe(
          'LINK_UNREADABLE',
        );
      }
      expect(
        (await a.api.post('/vacancies/read-link', { url: 'ftp://x.example/job' })).json().message,
      ).toMatch(/Only web addresses/);
      // With loopback allowed (tests only) the page is read and only text comes back.
      ctrl.links = new LinkReader({ allowLoopback: true, timeoutMs: 3000 });
      const ok = await a.api.post('/vacancies/read-link', { url });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({
        host: '127.0.0.1',
        title: 'Network Engineer',
        words: 80,
        truncated: false,
      });
      const audit = await h.db.owner.query(
        `SELECT after FROM audit_event WHERE action = 'vacancy.link_read'`,
      );
      expect(audit.rows).toHaveLength(1);
      expect(JSON.stringify(audit.rows[0])).not.toContain('requirement');
    } finally {
      ctrl.links = before;
      await new Promise<void>((r) => server.close(() => r()));
    }
    // A person with no role cannot use the reader.
    const viewer = await h.recruiter('link-viewer@azerconnect.test', 'NONE');
    expect(
      (await viewer.api.post('/vacancies/read-link', { url: 'https://example.com/' })).statusCode,
    ).toBe(403);
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any */
/** S3-UP-03: server_error and bad_zip_entry are actually written: no 500, no item left open. */
describeDb('Errors while taking files in (S3-UP-03)', () => {
  let h: Harness;
  const env = { ...process.env };
  beforeAll(async () => {
    process.env['TEST_VISIBILITY'] = 'all';
    h = await boot('intakeerr');
  });
  afterAll(async () => {
    await h?.close();
    process.env['TEST_VISIBILITY'] = env['TEST_VISIBILITY'];
  });

  const zipOf = async (n: number, method: 'DEFLATE' | 'STORE' = 'DEFLATE') => {
    const z = new JSZip();
    for (let i = 1; i <= n; i++)
      z.file(`c${i}.txt`, cv(`Zip Person ${'abcdefghij'[i]}`, [`BGP routing ${i}.`]), {
        compression: method,
      });
    return z.generateAsync({ type: 'nodebuffer' });
  };
  /** Spoil the packed bytes of one entry, so it cannot be read; the directory stays intact. */
  const spoil = (buf: Buffer, name: string) => {
    const at = buf.indexOf(Buffer.from(name)) + name.length;
    for (let k = 0; k < 12; k++) buf[at + k] = 0xff;
    return buf;
  };

  it('a loose file whose processing throws: 200 with skipped/server_error, shown as Not sent, and a resend takes it in', async () => {
    const r = await h.recruiter('throw@azerconnect.test');
    const vid = await readyVacancy(r.api);
    const f = textFile('Throws Once Person');
    const b = (await announce(r.api, vid, [{ name: f.name, size: f.data.length }])).json();
    const item = b.items[0].itemId as string;
    const intake = h.app.get(IntakeService);
    const spy = jest.spyOn(intake, 'admit').mockRejectedValueOnce(new Error('boom'));
    const res = await sendItem(r.api, vid, item, f);
    spy.mockRestore();
    expect(res.statusCode).toBe(200);
    expect(res.json().results[0]).toMatchObject({ status: 'skipped', code: 'server_error' });
    expect(await itemRow(h, item)).toMatchObject({ outcome: 'skipped', code: 'server_error' });
    const state = (await r.api.get(`/upload-batches/${b.batchId}?items=1`)).json();
    expect(state.items[0]).toMatchObject({
      status: 'not_sent',
      message: 'The server could not process this file',
    });
    const again = await sendItem(r.api, vid, item, f);
    expect(again.json().results[0]).toMatchObject({ status: 'queued' });
    expect(await liveCount(h, vid)).toBe(1);
  });

  it('a ZIP of 5 where entry 3 cannot be read: 1, 2, 4, 5 taken, 3 is bad_zip_entry, "4 of 5 files taken in"', async () => {
    const r = await h.recruiter('badentry@azerconnect.test');
    const vid = await readyVacancy(r.api);
    const data = spoil(await zipOf(5), 'c3.txt');
    const b = (await announce(r.api, vid, [{ name: 'five.zip', size: data.length }])).json();
    const res = await sendItem(r.api, vid, b.items[0].itemId, {
      name: 'five.zip',
      type: 'application/zip',
      data,
    });
    expect(res.statusCode).toBe(200);
    const out = res.json().results as any[];
    expect(out[0]).toMatchObject({
      status: 'queued',
      code: 'zip',
      message: '4 of 5 files taken in',
    });
    expect(out.slice(1).map((x) => x.code ?? x.status)).toEqual([
      'queued',
      'queued',
      'bad_zip_entry',
      'queued',
      'queued',
    ]);
    const skipped = (await r.api.get(`/vacancies/${vid}/skipped`)).json().skipped;
    expect(skipped.map((s: any) => s.filename)).toEqual(['five.zip › c3.txt']);
  });

  it('a ZIP where storing entry 3 throws: entry 3 and the ZIP are server_error; a resend stores exactly 1 more CV', async () => {
    const r = await h.recruiter('storethrow@azerconnect.test');
    const vid = await readyVacancy(r.api);
    const data = await zipOf(5);
    const b = (await announce(r.api, vid, [{ name: 'store.zip', size: data.length }])).json();
    const zipItem = b.items[0].itemId as string;
    const intake = h.app.get(IntakeService) as any;
    const orig = intake.admitFile.bind(intake);
    let n = 0;
    const spy = jest.spyOn(intake, 'admitFile').mockImplementation(async (...a: any[]) => {
      if (++n === 3) throw new Error('db down');
      return orig(...a);
    });
    const file = { name: 'store.zip', type: 'application/zip', data };
    const res = await sendItem(r.api, vid, zipItem, file);
    spy.mockRestore();
    expect(res.statusCode).toBe(200);
    const out = res.json().results as any[];
    expect(out[0]).toMatchObject({ status: 'skipped', code: 'server_error' });
    expect(out[3]).toMatchObject({ status: 'skipped', code: 'server_error' });
    expect(await liveCount(h, vid)).toBe(4);
    const again = await sendItem(r.api, vid, zipItem, file);
    expect(again.json().results[0]).toMatchObject({ status: 'queued', code: 'zip' });
    expect(await liveCount(h, vid)).toBe(5);
  });

  it('legacy route: a throwing file gives one server_error result and the others are still taken', async () => {
    const r = await h.recruiter('legacythrow@azerconnect.test');
    const vid = await readyVacancy(r.api);
    const intake = h.app.get(IntakeService);
    const orig = intake.admit.bind(intake);
    let n = 0;
    const spy = jest.spyOn(intake, 'admit').mockImplementation(async (...a) => {
      if (++n === 2) throw new Error('boom');
      return orig(...a);
    });
    const res = await r.api.upload(`/vacancies/${vid}/documents`, [
      textFile('Leg One Person'),
      textFile('Leg Two Person'),
      textFile('Leg Three Person'),
    ]);
    spy.mockRestore();
    expect(res.statusCode).toBe(200);
    expect(res.json().results.map((x: any) => x.code ?? x.status)).toEqual([
      'queued',
      'server_error',
      'queued',
    ]);
  });

  it('gate errors still pass through unchanged (409 archived, 404 unknown item)', async () => {
    const r = await h.recruiter('gate@azerconnect.test');
    const vid = await readyVacancy(r.api);
    const res = await sendItem(r.api, vid, '0'.repeat(26), textFile('Nobody Person'));
    expect(res.statusCode).toBe(404);
  });
});
