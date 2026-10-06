import http from 'node:http';
import type { AddressInfo } from 'node:net';
import JSZip from 'jszip';
import { describeDb } from '../testing/pg-harness';
import { boot, cv, JD, type Harness } from '../testing/app-harness';
import { DocumentsController } from './documents.controller';
import { LinkReader } from './link-reader';

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
    ).toEqual(['batch/Alice_Full.txt', 'batch/Bob_Routing.txt']);
    expect(by('duplicate')).toHaveLength(1);
    expect(
      by('skipped')
        .map((x) => x.message)
        .sort(),
    ).toEqual(['An archive inside the ZIP is not opened', 'Only PDF, DOCX and TXT files']);

    const list = (await a.api.get(`/vacancies/${vid}/skipped`)).json().skipped as {
      filename: string;
      reason: string;
    }[];
    expect(list).toHaveLength(3);
    expect(list.map((s) => s.filename).join('|')).toContain('resumes.zip › batch/photo.jpg');
    expect(list.map((s) => s.reason)).toContain('Already uploaded for this vacancy');

    await h.app.get((await import('./processor.service')).ProcessorService).drain();
    const c = (await a.api.get(`/vacancies/${vid}/candidates`)).json();
    expect(c.counts.total).toBe(2);
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
        expect.objectContaining({ message: 'A run holds at most 2 resumes' }),
      ]);
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
