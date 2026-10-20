import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeDb } from '../testing/pg-harness';
import { boot, type Harness } from '../testing/app-harness';
import * as converter from './docx-convert';
import { IntakeService } from './intake.service';
import { memoryShare, RenditionService } from './rendition.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const fx = (n: string) => readFileSync(join(__dirname, '../testing/fixtures', n));
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('memoryShare', () => {
  it('reads the cgroup limit and leaves out the file cache', () => {
    const files: Record<string, string> = {
      '/sys/fs/cgroup/memory.max': '1000\n',
      '/sys/fs/cgroup/memory.current': '700\n',
      '/sys/fs/cgroup/memory.stat': 'anon 1\ninactive_file 300\nfile 400\n',
    };
    const read = (p: string) => {
      if (!(p in files)) throw new Error('ENOENT');
      return files[p]!;
    };
    expect(memoryShare(read)).toBeCloseTo(0.4, 5);
  });
  it('falls back to cgroup v1, then to the host', () => {
    const v1: Record<string, string> = {
      '/sys/fs/cgroup/memory/memory.limit_in_bytes': '2000',
      '/sys/fs/cgroup/memory/memory.usage_in_bytes': '500',
    };
    expect(
      memoryShare((p) => {
        if (!(p in v1)) throw new Error('ENOENT');
        return v1[p]!;
      }),
    ).toBeCloseTo(0.25, 5);
    const s = memoryShare(() => {
      throw new Error('ENOENT');
    });
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThanOrEqual(1);
  });
});

describeDb('Word rendition queue (Stage 2, S2-BE7)', () => {
  let h: Harness;
  let svc: RenditionService;
  beforeAll(async () => {
    h = await boot('rendition');
    svc = h.app.get(RenditionService);
    // Looking at a CV nudges the queue in the real app; here each run is started by the test.
    jest.spyOn(svc, 'nudge').mockImplementation(() => undefined);
    // The loop is off in tests; these tests drive it by hand. Pretend it is switched on.
    (svc as any).env.RENDITION_ENABLED = 'true';
    (svc as any).found = await converter.converterAvailable();
  });
  afterAll(async () => {
    (svc as any).env.RENDITION_ENABLED = 'false';
    await h?.close();
  });
  const soffice = () => (svc as any).found as boolean;
  /** The queue is shared by every test here: leave only this CV waiting. */
  const only = (...ids: string[]) =>
    h.db.owner.query(
      `UPDATE cv_document SET rendition_state = 'ready', rendition_priority = false
        WHERE id <> ALL($1::text[]) AND erased_at IS NULL
          AND (rendition_state IN ('pending', 'processing')
               OR (rendition_state IS NULL AND lower(filename) LIKE '%.docx'))`,
      [ids],
    );

  async function upload(email: string, files: { name: string; data: Buffer }[]) {
    const r = await h.recruiter(email);
    const vid = await h.scenario(r.api, [{ name: 'Seed Person', lines: ['BGP routing.'] }]);
    const res = await r.api.upload(
      `/vacancies/${vid}/documents`,
      files.map((f) => ({ name: f.name, type: DOCX, data: f.data })),
    );
    expect(res.statusCode).toBe(200);
    const docs = (
      await h.db.owner.query(
        `SELECT id, filename FROM cv_document WHERE vacancy_id = $1 AND filename = ANY($2)`,
        [vid, files.map((f) => f.name)],
      )
    ).rows as { id: string; filename: string }[];
    const idOf = (name: string) =>
      docs.find(
        (d) => d.filename.replace(/_/g, ' ') === name.replace(/_/g, ' ') || d.filename === name,
      )!.id;
    return { r, vid, idOf };
  }
  const state = async (id: string) =>
    (
      await h.db.owner.query(
        `SELECT rendition_state AS state, rendition_pdf IS NOT NULL AS pdf, rendition_error AS error,
                rendition_attempts AS attempts, rendition_priority AS priority
           FROM cv_document WHERE id = $1`,
        [id],
      )
    ).rows[0] as {
      state: string | null;
      pdf: boolean;
      error: string | null;
      attempts: number;
      priority: boolean;
    };

  it('marks a Word upload as waiting, converts it, and shows its pages with the right audit', async () => {
    if (!soffice()) return console.warn('soffice missing: skipped');
    const { r, idOf } = await upload('word1@azerconnect.test', [
      { name: 'az.docx', data: fx('cv-az-fonts.docx') },
    ]);
    const id = idOf('az.docx');
    expect((await state(id)).state).toBe('pending');
    // Before it is ready the screen is told the pages are on their way, and /view says so.
    const before = (await r.api.get(`/documents/${id}`)).json();
    expect(before.original).toMatchObject({ view: 'pending', source: 'rendition' });
    expect((await r.api.get(`/documents/${id}`)).statusCode).toBe(200);
    const early = await r.api.get(`/documents/${id}/view`);
    expect(early.statusCode).toBe(409);
    expect(early.json().code).toBe('RENDITION_PENDING');
    expect((await state(id)).priority).toBe(true); // someone looked: front of the line

    await only(id);
    expect(await svc.runOnce(true)).toBe('ready');
    const s = await state(id);
    expect(s).toMatchObject({ state: 'ready', pdf: true, priority: false });
    const after = (await r.api.get(`/documents/${id}`)).json();
    expect(after.original).toMatchObject({ view: 'pdf', source: 'rendition', available: true });
    const view = await r.api.get(`/documents/${id}/view`);
    expect(view.statusCode).toBe(200);
    expect(view.headers['content-type']).toBe('application/pdf');
    expect(String(view.headers['content-disposition'])).toContain('.pdf');
    expect(view.body.startsWith('%PDF-')).toBe(true);
    // The download is still the Word file itself.
    const file = await r.api.get(`/documents/${id}/file`);
    expect(file.statusCode).toBe(200);
    expect(String(file.headers['content-disposition'])).toContain('.docx');
    const audit = (
      await h.db.owner.query(
        `SELECT after FROM audit_event WHERE action = 'document.opened' AND entity_id = $1`,
        [id],
      )
    ).rows;
    expect(audit).toHaveLength(1); // the early 409 was not an open
    expect(audit[0].after).toMatchObject({ as: 'pdf', rendition: true });
  }, 120_000);

  it('does the ones a person is waiting for first, then the oldest', async () => {
    if (!soffice()) return console.warn('soffice missing: skipped');
    const { idOf } = await upload('word2@azerconnect.test', [
      { name: 'first.docx', data: fx('cv-dilara.docx') },
      { name: 'second.docx', data: Buffer.concat([fx('cv-az-fonts.docx')]) },
    ]);
    const a = idOf('first.docx');
    const b = idOf('second.docx');
    await h.db.owner.query(`UPDATE cv_document SET rendition_priority = true WHERE id = $1`, [b]);
    await only(a, b);
    expect(await svc.runOnce(true)).toBe('ready');
    expect((await state(b)).state).toBe('ready');
    expect((await state(a)).state).toBe('pending');
    expect(await svc.runOnce(true)).toBe('ready');
    expect((await state(a)).state).toBe('ready');
    expect(await svc.runOnce(true)).toBe('idle');
  }, 180_000);

  it('picks up a Word file an older instance stored without a state', async () => {
    if (!soffice()) return console.warn('soffice missing: skipped');
    const { idOf } = await upload('word3@azerconnect.test', [
      { name: 'old.docx', data: fx('cv-dilara.docx') },
    ]);
    const id = idOf('old.docx');
    await h.db.owner.query(`UPDATE cv_document SET rendition_state = NULL WHERE id = $1`, [id]);
    await only(id);
    expect(await svc.runOnce(true)).toBe('ready');
    expect((await state(id)).state).toBe('ready');
  }, 120_000);

  it('fails a file that is not really Word, at once and with a plain reason', async () => {
    if (!soffice()) return console.warn('soffice missing: skipped');
    const { r, idOf } = await upload('word4@azerconnect.test', [
      { name: 'fake.docx', data: fx('renamed-odt.docx') },
    ]);
    const id = idOf('fake.docx');
    await only(id);
    expect(await svc.runOnce(true)).toBe('failed');
    const s = await state(id);
    expect(s).toMatchObject({ state: 'failed', pdf: false });
    expect(s.error).toContain('not a Word document');
    expect((await r.api.get(`/documents/${id}`)).json().original.view).toBe('failed');
    expect((await r.api.get(`/documents/${id}/view`)).json().code).toBe('RENDITION_FAILED');
  }, 120_000);

  it('puts a stalled conversion back, and fails it for good after two tries', async () => {
    const { idOf } = await upload('word5@azerconnect.test', [
      { name: 'stuck.docx', data: fx('cv-dilara.docx') },
    ]);
    const id = idOf('stuck.docx');
    await h.db.owner.query(
      `UPDATE cv_document SET rendition_state = 'processing', rendition_attempts = 1, rendition_started_at = now() - interval '10 minutes' WHERE id = $1`,
      [id],
    );
    expect(await svc.recover()).toBeGreaterThanOrEqual(1);
    expect((await state(id)).state).toBe('pending');
    await h.db.owner.query(
      `UPDATE cv_document SET rendition_state = 'processing', rendition_attempts = 2, rendition_started_at = now() - interval '10 minutes' WHERE id = $1`,
      [id],
    );
    await svc.recover();
    expect(await state(id)).toMatchObject({
      state: 'failed',
      error: 'The conversion did not finish.',
    });
  });

  it('never starts while uploads are being read, and never writes into an erased CV', async () => {
    const { r, idOf } = await upload('word6@azerconnect.test', [
      { name: 'guard.docx', data: fx('cv-dilara.docx') },
    ]);
    const id = idOf('guard.docx');
    const release = await h.app.get(IntakeService).permits.acquire(1);
    try {
      expect(await svc.runOnce()).toBe('blocked');
    } finally {
      release();
    }
    // The CV is erased while its pages are being made: nothing is written, nothing comes back.
    const spy = jest.spyOn(converter, 'convertDocxToPdf').mockImplementation(async () => {
      expect((await r.api.post(`/documents/${id}/erase`)).statusCode).toBe(200);
      return { pdf: Buffer.from('%PDF-1.4 late'), pages: 1 };
    });
    try {
      await only(id);
      expect(await svc.runOnce(true)).toBe('stopped');
    } finally {
      spy.mockRestore();
    }
    expect(await state(id)).toMatchObject({ state: null, pdf: false, error: null });
  });

  it('erasing a CV clears its pages and its state', async () => {
    if (!soffice()) return console.warn('soffice missing: skipped');
    const { r, idOf } = await upload('word7@azerconnect.test', [
      { name: 'erase.docx', data: fx('cv-dilara.docx') },
    ]);
    const id = idOf('erase.docx');
    await only(id);
    expect(await svc.runOnce(true)).toBe('ready');
    expect((await state(id)).pdf).toBe(true);
    expect((await r.api.post(`/documents/${id}/erase`)).statusCode).toBe(200);
    expect(await state(id)).toMatchObject({ state: null, pdf: false });
    expect((await r.api.get(`/documents/${id}/view`)).statusCode).toBe(404);
  }, 120_000);

  it('shows text only (unavailable) when the converter is switched off or missing', async () => {
    const { r, idOf } = await upload('word8@azerconnect.test', [
      { name: 'off.docx', data: fx('cv-dilara.docx') },
    ]);
    const id = idOf('off.docx');
    (svc as any).env.RENDITION_ENABLED = 'false';
    try {
      expect((await r.api.get(`/documents/${id}`)).json().original.view).toBe('unavailable');
      expect((await r.api.get(`/documents/${id}/view`)).json().code).toBe('RENDITION_FAILED');
    } finally {
      (svc as any).env.RENDITION_ENABLED = 'true';
    }
  });
});
