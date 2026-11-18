import type { Page, Route } from '@playwright/test';
import { AZ } from '../../apps/web/src/i18n/az';
import type { Meta } from '../ux/test';

/**
 * Mocks and helpers for UAT package B (administration AD, SenAI admin SX, security SEC).
 * Every person, company, key and token here is invented.
 */

/** The app's own wording in the run's language (English key → Azerbaijani, as the app does). */
export function wordsB(meta: Pick<Meta, 'lang'>) {
  return (en: string) => (meta.lang === 'az' ? (AZ[en] ?? en) : en);
}

export const ENDED = 'Your session ended. Please sign in again.';

/** The admin signed in for the L1 admin cases. */
export const ADMIN_ME = {
  userId: '01K000000000000000000000AA',
  displayName: 'Admin Test',
  email: 'admin.test@example.az',
  roles: ['ADMIN'],
};

const u = (
  id: string,
  displayName: string,
  email: string,
  roles: string[],
  extra: Partial<{
    status: string;
    mustChangePassword: boolean;
    mfa: boolean;
    issuer: string;
    lastSeenAt: string | null;
  }> = {},
) => ({
  id,
  displayName,
  email,
  roles,
  status: 'active',
  mustChangePassword: false,
  mfa: false,
  issuer: 'local',
  lastSeenAt: '2026-11-10T09:00:00Z',
  ...extra,
});

export const USERS = {
  self: u(ADMIN_ME.userId, 'Admin Test', ADMIN_ME.email, ['ADMIN']),
  recruiter: u('01K000000000000000000000R1', 'Nigar Quliyeva', 'nigar.q@example.az', [
    'TA_PARTNER',
  ]),
  lead: u('01K000000000000000000000L1', 'Tural Hasanli', 'tural.h@example.az', ['TA_LEAD'], {
    mustChangePassword: true,
    lastSeenAt: null,
  }),
  viewer: u('01K000000000000000000000V1', 'Sabina Rzayeva', 'sabina.r@example.az', [], {
    mfa: true,
  }),
  governance: u(
    '01K000000000000000000000G1',
    'Elnur Babayev',
    'elnur.b@example.az',
    ['GOVERNANCE'],
    { status: 'disabled' },
  ),
  system: u('01K000000000000000000000S1', 'Scheduler', 'system@example.az', ['ADMIN'], {
    issuer: 'system',
  }),
};
export const USER_LIST = Object.values(USERS);

/** n invented users, all active recruiters. */
export const manyUsers = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    u(
      `01K0000000000000000000${String(i).padStart(4, '0')}`,
      `Person ${i + 1}`,
      `person${i + 1}@example.az`,
      ['TA_PARTNER'],
    ),
  );

export const TOKEN43 = 'abcdefghijABCDEFGHIJ0123456789_-abcdefghijK';

// ---------------------------------------------------------------- AI models

const known = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `fake-${i + 1}`, label: `Fake model ${i + 1}` }));
export const CATALOG = {
  companies: [
    {
      id: 'fake',
      name: 'Fake AI',
      dataNote: 'Invented company for the tests.',
      keyHelp: 'Paste the invented key.',
      knownModels: known(12),
      extraFields: [
        {
          key: 'region',
          label: 'Region',
          hint: 'Where the calls go.',
          required: false,
          options: [
            { value: 'westeurope', label: 'West Europe' },
            { value: 'northeurope', label: 'North Europe' },
          ],
        },
      ],
    },
    {
      id: 'other',
      name: 'Other AI',
      dataNote: 'Another invented company.',
      keyHelp: 'Other key.',
      knownModels: known(3).map((m) => ({ ...m, id: `other-${m.id}` })),
      extraFields: [],
    },
  ],
};
export const CONN_ID = '01K0000000000000000000CONN';
export const M1 = '01K00000000000000000000MD1';
export const M2 = '01K00000000000000000000MD2';
export const connection = (active: 'fake-1' | 'fake-2' | null = 'fake-1') => ({
  id: CONN_ID,
  company: 'fake',
  name: 'Fake AI',
  keyHint: 'ab12',
  settings: {} as Record<string, string>,
  models: [
    { id: M1, modelId: 'fake-1', label: 'Fake model 1', isActive: active === 'fake-1' },
    { id: M2, modelId: 'fake-2', label: 'Fake model 2', isActive: active === 'fake-2' },
  ],
});
export const aiOverview = (active: 'fake-1' | 'fake-2' | null = 'fake-1') => ({
  active: active ? { provider: 'Fake AI', model: active } : null,
  connections: [connection(active)],
});

// ---------------------------------------------------------------- retention

export const RET_VACS = [
  {
    id: '01K00000000000000000000VA1',
    title: 'Network Engineer',
    legalHold: false,
    matter: null,
    since: null,
    by: null,
    documents: 4,
  },
  {
    id: '01K00000000000000000000VA2',
    title: 'Data Analyst',
    legalHold: true,
    matter: 'HR-2026-01',
    since: '2026-11-01T10:00:00Z',
    by: 'Admin Test',
    documents: 2,
  },
];
export const retention = (over: Record<string, unknown> = {}) => ({
  enabled: false,
  days: 180,
  due: 3,
  heldBack: 1,
  cutoff: '2026-05-16T00:00:00Z',
  certificates: [],
  vacancies: RET_VACS,
  ...over,
});

// ---------------------------------------------------------------- small helpers

export type Handler = (route: Route, url: URL) => Promise<boolean> | boolean;
/** Answers JSON and records the request (method, path, body). */
export const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, json: body }).then(() => true);

/** Requests made by the page matching a method and path regex. */
export function calls(
  seen: { requests: { method: string; url: string; body: unknown }[] },
  method: string,
  path: RegExp,
) {
  return seen.requests.filter((r) => r.method === method && path.test(r.url));
}

/** Whether the page has a horizontal page scroll. */
export const pageScrollsSideways = (page: Page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
