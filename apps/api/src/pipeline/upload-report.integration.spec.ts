import JSZip from 'jszip';
import { describeDb } from '../testing/pg-harness';
import { boot, cv, type Harness } from '../testing/app-harness';
import { announce, ready, sendItem, textFile } from '../testing/stage3-upload';
import { batchReportCsv, REPORT_HEADER } from './batch-report';
import { ProcessorService } from './processor.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** A tiny CSV reader for the tests: quoted cells, doubled quotes, CRLF rows. */
const parseCsv = (text: string) => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\r') continue;
    else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  return rows;
};

describe('batch report CSV (S3-UP-09, no database)', () => {
  it('neutralises formulas, keeps commas, quotes and line breaks in one cell, and prints five columns', () => {
    const csv = batchReportCsv([
      {
        id: 'a',
        parentId: null,
        position: 0,
        filename: '=HYPERLINK("http://x","y").pdf',
        clientPath: null,
        status: 'rejected',
        message: 'Not a CV file type',
        documentId: null,
        container: false,
      },
      {
        id: 'b',
        parentId: null,
        position: 1,
        filename: 'Smith, "Jo"\nCV.pdf',
        clientPath: null,
        status: 'analyzed',
        message: null,
        documentId: 'D1',
        container: false,
      },
    ]);
    expect(csv.startsWith('﻿')).toBe(true);
    const rows = parseCsv(csv.slice(1));
    expect(rows[0]!.join(',')).toBe(REPORT_HEADER);
    expect(rows.every((r) => r.length === 5)).toBe(true);
    expect(rows[1]![1]).toBe(`'=HYPERLINK("http://x","y").pdf`);
    expect(rows[2]!).toEqual(['2', 'Smith, "Jo" CV.pdf', 'Analyzed', '', 'D1']);
  });
});

describeDb('Upload outcome report (S3-UP-09)', () => {
  let h: Harness;
  const env = { ...process.env };
  beforeAll(async () => {
    process.env['TEST_VISIBILITY'] = 'all';
    h = await boot('report');
  });
  afterAll(async () => {
    await h?.close();
    process.env['TEST_VISIBILITY'] = env['TEST_VISIBILITY'];
  });

  it('one row per Details row in the same order, ZIP entries in place of their ZIP; no score, name or e-mail; audited first', async () => {
    const r = await h.recruiter('report1@azerconnect.test');
    const vid = await ready(r.api);
    const a = textFile('Report Alpha Person', ['BGP routing.', 'Kubernetes.']);
    const z = new JSZip();
    z.file('Report_Beta.txt', cv('Report Beta Person', ['BGP routing.']));
    z.file('photo.jpg', 'jpg');
    const zip = await z.generateAsync({ type: 'nodebuffer' });
    const c = textFile('Report Gamma Person');
    const b = (
      await announce(r.api, vid, [
        { name: a.name, size: a.data.length },
        { name: 'bundle.zip', size: zip.length },
        { name: c.name, size: c.data.length },
        { name: 'notes.png', size: 100 },
      ])
    ).json();
    await sendItem(r.api, vid, b.items[0].itemId, a);
    await sendItem(r.api, vid, b.items[1].itemId, {
      name: 'bundle.zip',
      type: 'application/zip',
      data: zip,
    });
    await h.app.get(ProcessorService).drain();
    // c is still "not sent": a report taken now shows it as it stands.

    const res = await r.api.get(`/upload-batches/${b.batchId}/report.csv`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="upload-report-${b.batchId}.csv"`,
    );
    expect(res.body.startsWith('﻿')).toBe(true);
    const rows = parseCsv(res.body.slice(1));
    expect(rows[0]!.join(',')).toBe(REPORT_HEADER);
    expect(rows.slice(1).map((x) => [x[0], x[1], x[2]])).toEqual([
      ['1', a.name, 'Analyzed'],
      ['2', 'bundle.zip › Report_Beta.txt', 'Analyzed'],
      ['3', 'bundle.zip › photo.jpg', 'Not accepted'],
      ['4', c.name, 'Not sent'],
      ['5', 'notes.png', 'Not accepted'],
    ]);
    // The same statuses as the batch view at this moment.
    const state = (await r.api.get(`/upload-batches/${b.batchId}?items=1`)).json();
    expect(state.items.filter((i: any) => !i.container)).toHaveLength(5);
    // Never a score, band, candidate name or e-mail, or the uploader's e-mail.
    for (const bad of ['Alpha Person', 'Beta Person', 'strong', 'score', 'report1@', '@'])
      expect(res.body.toLowerCase()).not.toContain(bad.toLowerCase());
    const audit = await h.db.owner.query(
      `SELECT after FROM audit_event WHERE action = 'upload_batch.report_downloaded' AND entity_id = $1`,
      [b.batchId],
    );
    expect(audit.rows).toEqual([{ after: { vacancyId: vid, rows: 5 } }]);
  });

  it('an erased CV is "erased" with no name; read access 200, no access 404, GOVERNANCE and ADMIN 403', async () => {
    const r = await h.recruiter('report2@azerconnect.test');
    const vid = await ready(r.api);
    const f = textFile('Erased In Report');
    const b = (await announce(r.api, vid, [{ name: f.name, size: f.data.length }])).json();
    const sent = (await sendItem(r.api, vid, b.items[0].itemId, f)).json().results[0];
    await r.api.post(`/documents/${sent.documentId}/erase`, {});
    const body = (await r.api.get(`/upload-batches/${b.batchId}/report.csv`)).body;
    expect(body).not.toContain('Erased_In_Report');
    expect(parseCsv(body.slice(1))[1]!.slice(1, 3)).toEqual(['erased', 'Erased']);

    const gov = await h.recruiter('report2gov@azerconnect.test', 'GOVERNANCE');
    expect((await gov.api.get(`/upload-batches/${b.batchId}/report.csv`)).statusCode).toBe(403);
    expect((await h.admin.get(`/upload-batches/${b.batchId}/report.csv`)).statusCode).toBe(403);
    expect((await r.api.get(`/upload-batches/${'0'.repeat(26)}/report.csv`)).statusCode).toBe(404);
  });
});
