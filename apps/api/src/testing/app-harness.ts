/**
 * A booted API against a real Postgres with a scripted model, for the integration suites of the
 * newer features (stop, marks, adjustments, sharing, assistant). Same shape as the pipeline suite.
 */
import { randomBytes } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AiGateway } from '../ai/ai-gateway.service';
import { createAdapter } from '../app.factory';
import { AppModule } from '../app.module';
import { EmailService } from '../auth/email.service';
import { ProcessorService } from '../pipeline/processor.service';
import { createDb } from './pg-harness';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Res {
  statusCode: number;
  body: string;
  headers: Record<string, unknown>;
  json: () => any;
}
export interface Api {
  get(url: string): Promise<Res>;
  post(url: string, payload?: object): Promise<Res>;
  put(url: string, payload: object): Promise<Res>;
  patch(url: string, payload: object): Promise<Res>;
  del(url: string): Promise<Res>;
  upload(url: string, files: { name: string; type: string; data: Buffer }[]): Promise<Res>;
}
export interface Harness {
  app: NestFastifyApplication;
  db: Awaited<ReturnType<typeof createDb>>;
  admin: Api;
  adminToken: string;
  as: (token: string) => Api;
  recruiter: (
    email: string,
    role?: 'TA_PARTNER' | 'TA_LEAD' | 'NONE',
  ) => Promise<{ token: string; userId: string; api: Api }>;
  scenario: (who: Api, cvs: { name: string; lines: string[] }[], title?: string) => Promise<string>;
  sent: { to: string; text: string }[];
  modelCalls: { system: string; user: string }[];
  setModel: (m: (system: string, user: string) => string) => void;
  close: () => Promise<void>;
}

export const JD =
  'Senior Network Engineer. You will run the carrier core. Required: BGP routing experience, Kubernetes experience. Nice to have: Python scripting.';

/** The scripted model: extracts three requirements, and judges a CV by the words it contains. */
export const scriptedModel = (system: string, user: string): string => {
  if (system.includes('convert a job description')) {
    return JSON.stringify({
      requirements: [
        { text: 'BGP routing', classification: 'mandatory', weight: 10, confidence: 'high' },
        { text: 'Kubernetes', classification: 'mandatory', weight: 10, confidence: 'high' },
        { text: 'Python scripting', classification: 'preferred', weight: 5, confidence: 'medium' },
      ],
    });
  }
  const criteria = JSON.parse(
    user.slice(user.indexOf('['), user.indexOf('\n\n<<<CV_START>>>')),
  ) as { id: string; text: string }[];
  const cv = user.slice(user.indexOf('<<<CV_START>>>'));
  const name = /Name: ([A-Za-z ]+)/.exec(cv)?.[1]?.trim() ?? 'Unknown Person';
  return JSON.stringify({
    candidate: { name },
    summary: `Candidate summary for ${name}.`,
    assessments: criteria.map((c) => {
      const key = c.text.split(' ')[0]!;
      const line = new RegExp(`[^\\n]*${key}[^\\n]*`).exec(cv)?.[0]?.trim();
      return line
        ? { id: c.id, status: 'met', confidence: 'high', evidence: [line], rationale: 'Stated.' }
        : { id: c.id, status: 'not_found', confidence: 'high', evidence: [], rationale: 'Absent.' };
    }),
  });
};

export function multipart(files: { name: string; type: string; data: Buffer }[]) {
  const boundary = `----t${randomBytes(6).toString('hex')}`;
  const parts: Buffer[] = [];
  for (const f of files) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${f.name}"\r\nContent-Type: ${f.type}\r\n\r\n`,
      ),
      f.data,
      Buffer.from('\r\n'),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(parts),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

export const cv = (name: string, lines: string[]) =>
  `Name: ${name}\n${lines.join('\n')}\n${'Padding text for length. '.repeat(10)}`;

export async function boot(
  tag: string,
  model: (system: string, user: string) => string = scriptedModel,
): Promise<Harness> {
  const ADMIN = 'admin@azerconnect.test';
  const PW = 'Bootstrap-Passw0rd!';
  const NEW_PW = 'A-much-longer-secret-1';
  const db = await createDb(tag);
  Object.assign(process.env, {
    DATABASE_URL: db.apiUrl,
    AUTH_MODE: 'local',
    SESSION_SECRET: 'z'.repeat(48),
    BOOTSTRAP_ADMIN_EMAIL: ADMIN,
    BOOTSTRAP_ADMIN_PASSWORD: PW,
    SETTINGS_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    WORKER_ENABLED: 'false',
    LOG_LEVEL: 'silent',
  });
  const sent: { to: string; text: string }[] = [];
  const modelCalls: { system: string; user: string }[] = [];
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EmailService)
    .useValue({ send: async (m: { to: string; text: string }) => (sent.push(m), true) })
    .compile();
  const app = mod.createNestApplication<NestFastifyApplication>(createAdapter('silent'));
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  app.get(AiGateway).fetcher = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as {
      system: string;
      messages: { content: string }[];
    };
    const user = body.messages[0]!.content;
    modelCalls.push({ system: body.system, user });
    const text = model(body.system, user);
    return new Response(JSON.stringify({ content: [{ type: 'text', text }] }), { status: 200 });
  }) as typeof fetch;

  const signIn = async (email: string, pw: string, newPw?: string) => {
    const l = (
      await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: pw } })
    ).json();
    if (!newPw) return l.token as string;
    const c = await app.inject({
      method: 'POST',
      url: '/auth/change-password',
      headers: { authorization: `Bearer ${l.token}` },
      payload: { currentPassword: pw, newPassword: newPw },
    });
    return c.json().token as string;
  };
  const adminToken = await signIn(ADMIN, PW, NEW_PW);
  const as = (token: string): Api => ({
    get: (url: string) =>
      app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } }),
    post: (url: string, payload?: object) =>
      app.inject({ method: 'POST', url, payload, headers: { authorization: `Bearer ${token}` } }),
    put: (url: string, payload: object) =>
      app.inject({ method: 'PUT', url, payload, headers: { authorization: `Bearer ${token}` } }),
    patch: (url: string, payload: object) =>
      app.inject({ method: 'PATCH', url, payload, headers: { authorization: `Bearer ${token}` } }),
    del: (url: string) =>
      app.inject({ method: 'DELETE', url, headers: { authorization: `Bearer ${token}` } }),
    upload: (url: string, files: Parameters<typeof multipart>[0]) => {
      const m = multipart(files);
      return app.inject({
        method: 'POST',
        url,
        payload: m.payload,
        headers: { ...m.headers, authorization: `Bearer ${token}` },
      });
    },
  });
  const admin: Api = as(adminToken);
  /** A recruiter account; returns its token and user id. */
  async function recruiter(email: string, role: 'TA_PARTNER' | 'TA_LEAD' | 'NONE' = 'TA_PARTNER') {
    const r = await admin.post('/admin/users', { email, displayName: email.split('@')[0], role });
    if (r.statusCode !== 201) throw new Error(`could not create ${email}: ${r.body}`);
    const pw = /Password:\s+(\S+)/.exec(sent.at(-1)!.text)![1]!;
    const token = await signIn(email, pw, NEW_PW);
    const me = (await as(token).get('/me')).json() as { userId: string };
    return { token, userId: me.userId, api: as(token) };
  }
  await admin.post('/admin/ai/connections', {
    company: 'anthropic',
    apiKey: 'sk-ant-testtesttest',
    models: [{ modelId: 'claude-test' }],
  });
  const models = (await admin.get('/admin/ai')).json().connections[0].models;
  await admin.put('/admin/ai/active', { modelId: models[0].id });

  /** A frozen vacancy with the notice confirmed and the given CVs uploaded and fully screened. */
  async function scenario(
    who: Api,
    cvs: { name: string; lines: string[] }[],
    title = 'Senior Network Engineer',
  ) {
    const v = await who.post('/vacancies', { title, jdText: JD });
    const vid = v.json().id as string;
    await who.post(`/vacancies/${vid}/criteria/extract`);
    await who.post(`/vacancies/${vid}/criteria/freeze`);
    await who.post(`/vacancies/${vid}/notice-confirm`);
    if (cvs.length) {
      const up = await who.upload(
        `/vacancies/${vid}/documents`,
        cvs.map((c) => ({
          name: `${c.name.replace(/\s/g, '_')}.txt`,
          type: 'text/plain',
          data: Buffer.from(cv(c.name, c.lines)),
        })),
      );
      if (up.statusCode >= 300) throw new Error(`upload failed: ${up.body}`);
      await app.get(ProcessorService).drain();
    }
    return vid;
  }

  return {
    app,
    db,
    admin,
    adminToken,
    as,
    recruiter,
    scenario,
    sent,
    modelCalls,
    setModel(m: (system: string, user: string) => string) {
      model = m;
    },
    async close() {
      await app.close();
      await db.drop();
    },
  };
}
