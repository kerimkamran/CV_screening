import type { Page } from '@playwright/test';
import { ulidOf } from './files';
import { REQS } from './pkg-d';
import { vacApi, vview } from './pkg-c';
import { VID, mockApi } from './api';

/**
 * Stage 3 (plan 18.2): L1 answers for Parallax's own Oracle routes. L1 never uses the fake Oracle;
 * these are the API's answers, kept in one place (UAT-AUTHORING.md). Every name is invented. No
 * Oracle host appears here: the admin answers use a made-up example ending.
 */
export const OVID = VID;
export const RUN = ulidOf('RUN', 1);
export const OBATCH = ulidOf('OBT', 1);
const iso = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString();

export const run = (over: Record<string, unknown> = {}) => ({
  runId: RUN,
  mode: 'import',
  state: 'running',
  phase: 'listing',
  batchId: null,
  listed: 0,
  estimate: 12,
  counts: {},
  waitReason: null,
  errorCode: null,
  confirmReason: null,
  pauseEndsAt: null,
  startedBy: 'Aysel Mammadova',
  createdAt: iso(2),
  finishedAt: null,
  cancelRequested: false,
  ...over,
});
export const LINK = {
  ref: 'REQ-2026-0042',
  state: 'approved',
  linkedBy: 'Aysel Mammadova',
  linkedAt: iso(3),
  canUnlink: false,
};
export const ostate = (over: Record<string, unknown> = {}) => ({
  available: true,
  link: null,
  run: null,
  lastRun: null,
  goneCount: 0,
  staleDays: null,
  linkPolicy: 'open',
  room: 500,
  ...over,
});

export type OracleScript = (poll: number) => Record<string, unknown> | 404;

/**
 * A ready vacancy (criteria frozen, notice confirmed) with the Oracle routes answered by `script`.
 * `lookup` and `start` answer the two POSTs; every request is in `seen`.
 */
export async function oracleVacancy(
  page: Page,
  o: {
    script: OracleScript;
    lookup?: { status?: number; body: Record<string, unknown> };
    start?: { status?: number; body: Record<string, unknown> };
    batch?: (poll: number) => Record<string, unknown>;
  },
) {
  let polls = 0;
  const view = vview({
    id: OVID,
    title: 'Network operations role',
    requirements: REQS.slice(0, 2).map((r) => ({ ...r, rule: null, confidence: 'high' })),
    hasFrozen: true,
    candidateNoticeConfirmedAt: iso(60 * 24),
  });
  const { seen } = await vacApi(page, {
    views: [view],
    extra: async (route, url, method) => {
      const p = url.pathname;
      const json = async (b: unknown, status = 200) => {
        await route.fulfill({ status, json: b });
        return true;
      };
      if (p === `/vacancies/${OVID}/oracle` && method === 'GET') {
        const s = o.script(polls++);
        return s === 404
          ? json({ message: 'Oracle import is not available in this environment.' }, 404)
          : json(s);
      }
      if (p === `/vacancies/${OVID}/oracle/lookup`)
        return json(o.lookup?.body ?? { found: false }, o.lookup?.status ?? 200);
      if (p === `/vacancies/${OVID}/oracle/imports`)
        return json(o.start?.body ?? { runId: RUN }, o.start?.status ?? 202);
      if (p === `/import-runs/${RUN}/cancel`) return json({ cancelled: true });
      if (p === `/import-runs/${RUN}/confirm`) return json({ confirmed: true });
      if (p === `/upload-batches/${OBATCH}` && o.batch) return json(o.batch(polls));
      if (p === `/upload-batches/${OBATCH}/report.csv`)
        return route
          .fulfill({
            status: 200,
            body: '﻿position,label,status,reason,document_id\r\n',
            headers: { 'content-type': 'text/csv' },
          })
          .then(() => true);
      return false;
    },
  });
  return { seen };
}

/** The admin Oracle card: the GET answer, and the answer of each POST. */
export async function oracleAdminApi(
  page: Page,
  o: {
    view: () => Record<string, unknown> | 404;
    activate?: () => Record<string, unknown>;
    runs?: unknown[];
  },
) {
  return mockApi(page, {
    me: { roles: ['ADMIN', 'TA_LEAD'] },
    extra: async (route, url) => {
      const p = url.pathname;
      const method = route.request().method();
      const json = async (b: unknown, status = 200) => {
        await route.fulfill({ status, json: b });
        return true;
      };
      if (p === '/admin/integrations/oracle' && method === 'GET') {
        const v = o.view();
        return v === 404
          ? json({ message: 'Oracle import is not available in this environment.' }, 404)
          : json(v);
      }
      if (p === '/admin/integrations/oracle/runs') return json({ runs: o.runs ?? [] });
      if (p === '/admin/integrations/oracle/activate')
        return json(o.activate?.() ?? { code: 'ok', enabled: true });
      return false;
    },
  });
}

export const ADMIN_BASE = {
  available: true,
  example: 'https://xxxx.fa.em2.example-ending',
  suffix: '.example-ending',
  notOracleAddress: 'x',
  settings: {
    linkPolicy: 'open',
    requireEuAi: true,
    goneInSource: 'flag',
    categories: ['Resume'],
    clientId: null,
    scope: null,
  },
  connection: null,
};
export const ADMIN_ACTIVE = {
  ...ADMIN_BASE,
  connection: {
    address: 'https://pod.fa.em2.example-ending',
    user: 'parallax.integration',
    authMode: 'basic',
    tokenUrl: null,
    enabled: true,
    enabledAt: iso(60),
    authFailedAt: null,
    lastTestAt: iso(5),
    lastTestCode: 'ok',
    passwordSaved: true,
    passwordSetAt: iso(60),
    passwordExpiresOn: null,
    clientSecretSaved: false,
    notice: { by: 'Admin', at: iso(60), effectiveFrom: null },
  },
};
