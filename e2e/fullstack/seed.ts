import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  ACCOUNTS_FILE,
  api,
  CONTROL,
  login,
  tempPasswordFor,
  type Account,
  type AccountKey,
} from './stack';

/**
 * Global setup of the full-stack journeys (plan 2.4): the accounts, all with invented names, and
 * the fake AI connected and active. Idempotent: a second run reuses what exists.
 */
export default async function seed() {
  const secrets = (await (await fetch(`${CONTROL}/secrets`)).json()) as Record<string, string>;
  const adminEmail = secrets.BOOTSTRAP_ADMIN_EMAIL!;
  // The bootstrap admin must change the temporary password at first sign-in.
  let adminToken: string;
  try {
    adminToken = await login({ email: adminEmail, password: secrets.ADMIN_PASSWORD! });
  } catch {
    const t = await login({ email: adminEmail, password: secrets.BOOTSTRAP_ADMIN_PASSWORD! });
    const c = await api(t).post('/auth/change-password', {
      currentPassword: secrets.BOOTSTRAP_ADMIN_PASSWORD,
      newPassword: secrets.ADMIN_PASSWORD,
    });
    if (c.status >= 300)
      throw new Error(`admin password change: ${c.status} ${JSON.stringify(c.body)}`);
    adminToken = c.body.token;
  }
  const admin = api(adminToken);
  const pw = secrets.PASSWORD!;
  const want: {
    key: AccountKey;
    email: string;
    name: string;
    role: string;
    extra?: string[];
    keepTemp?: boolean;
  }[] = [
    {
      key: 'adminTa',
      email: 'uat.admin.ta@example.az',
      name: 'Nigar Hasanova',
      role: 'ADMIN',
      extra: ['TA_PARTNER'],
    },
    {
      key: 'recruiter',
      email: 'aysel.recruiter@example.az',
      name: 'Aysel Mammadova',
      role: 'TA_PARTNER',
    },
    {
      key: 'recruiter2',
      email: 'orkhan.recruiter@example.az',
      name: 'Orkhan Guliyev',
      role: 'TA_PARTNER',
    },
    { key: 'lead', email: 'samira.lead@example.az', name: 'Samira Aliyeva', role: 'TA_LEAD' },
    { key: 'governance', email: 'tural.gov@example.az', name: 'Tural Babayev', role: 'GOVERNANCE' },
    { key: 'viewer', email: 'leyla.viewer@example.az', name: 'Leyla Ismayilova', role: 'NONE' },
    {
      key: 'mustChange',
      email: 'kamal.new@example.az',
      name: 'Kamal Rzayev',
      role: 'TA_PARTNER',
      keepTemp: true,
    },
  ];
  const users = (await admin.get('/admin/users')).body as {
    id: string;
    email: string;
    roles: string[];
  }[];
  const out: Partial<Record<AccountKey, Account>> = {
    admin: {
      key: 'admin',
      email: adminEmail,
      password: secrets.ADMIN_PASSWORD!,
      displayName: 'Bootstrap admin',
      roles: ['ADMIN'],
    },
  };
  for (const w of want) {
    let u = users.find((x) => x.email === w.email);
    let password = pw;
    if (!u) {
      const r = await admin.post('/admin/users', {
        email: w.email,
        displayName: w.name,
        role: w.role,
      });
      if (r.status !== 201)
        throw new Error(`create ${w.email}: ${r.status} ${JSON.stringify(r.body)}`);
      u = { id: r.body.user.id, email: w.email, roles: [w.role] };
      const temp = await tempPasswordFor(w.email);
      if (w.keepTemp) password = temp;
      else {
        const t = await login({ email: w.email, password: temp });
        const c = await api(t).post('/auth/change-password', {
          currentPassword: temp,
          newPassword: pw,
        });
        if (c.status >= 300)
          throw new Error(`change ${w.email}: ${c.status} ${JSON.stringify(c.body)}`);
      }
    } else if (w.keepTemp) {
      // Already seeded: give it a fresh temporary password so the forced change can be tested again.
      await admin.post(`/admin/users/${u.id}/reset-password`);
      password = await tempPasswordFor(w.email);
    }
    for (const extra of w.extra ?? [])
      if (!u.roles?.includes(extra)) {
        const g = await admin.post(`/admin/users/${u.id}/roles`, { role: extra });
        if (g.status >= 300)
          throw new Error(`grant ${extra} to ${w.email}: ${g.status} ${JSON.stringify(g.body)}`);
      }
    out[w.key] = {
      key: w.key,
      email: w.email,
      password,
      displayName: w.name,
      roles: [w.role, ...(w.extra ?? [])],
      userId: u.id,
    };
  }

  // The fake AI: one connection, its first model active.
  const ai = (await admin.get('/admin/ai')).body as {
    connections: { models: { id: string }[] }[];
    activeModelId?: string;
  };
  if (!ai.connections?.length) {
    const c = await admin.post('/admin/ai/connections', {
      company: 'anthropic',
      apiKey: 'sk-ant-uat-fake-key-not-real',
      models: [{ modelId: 'claude-fake-1' }],
    });
    if (c.status >= 300) throw new Error(`ai connection: ${c.status} ${JSON.stringify(c.body)}`);
  }
  const models = (
    (await admin.get('/admin/ai')).body as { connections: { models: { id: string }[] }[] }
  ).connections[0]!.models;
  const act = await admin.put('/admin/ai/active', { modelId: models[0]!.id });
  if (act.status >= 300) throw new Error(`ai active: ${act.status} ${JSON.stringify(act.body)}`);

  mkdirSync(dirname(ACCOUNTS_FILE), { recursive: true });
  writeFileSync(ACCOUNTS_FILE, JSON.stringify(out, null, 2));
}
