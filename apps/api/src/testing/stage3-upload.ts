/**
 * Small helpers shared by the Stage 3 upload specs (S3-UP-*): a ready vacancy, an announced batch,
 * one file sent to one item, and live-CV counts.
 */
import { cv, JD, type Api, type Harness } from './app-harness';

/* eslint-disable @typescript-eslint/no-explicit-any */

export const ready = async (api: Api, title = 'Senior Network Engineer') => {
  const vid = (await api.post('/vacancies', { title, jdText: JD })).json().id as string;
  await api.post(`/vacancies/${vid}/criteria/extract`);
  await api.post(`/vacancies/${vid}/criteria/freeze`);
  await api.post(`/vacancies/${vid}/notice-confirm`);
  return vid;
};

export type TestFile = { name: string; type: string; data: Buffer };

export const textFile = (name: string, lines: string[] = ['BGP routing.']): TestFile => ({
  name: `${name.replace(/\s/g, '_')}.txt`,
  type: 'text/plain',
  data: Buffer.from(cv(name, lines)),
});

export const announce = async (api: Api, vid: string, files: { name: string; size: number }[]) =>
  api.post(`/vacancies/${vid}/upload-batches`, { files });

export const sendItem = (api: Api, vid: string, itemId: string, f: TestFile) =>
  api.upload(`/vacancies/${vid}/documents?item=${itemId}`, [f]);

export const liveCount = async (h: Harness, vid: string) =>
  Number(
    (
      await h.db.owner.query(
        `SELECT count(*) AS n FROM cv_document WHERE vacancy_id = $1 AND erased_at IS NULL`,
        [vid],
      )
    ).rows[0].n,
  );

export const itemRow = async (h: Harness, itemId: string) =>
  (
    await h.db.owner.query(
      `SELECT outcome, code, message, document_id, filename, client_path FROM upload_item WHERE id = $1`,
      [itemId],
    )
  ).rows[0] as any;
