import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type AdminUser, type AiProvider, type Role } from '../api';
import {
  btnDanger,
  btnPrimary,
  btnSecondary,
  Card,
  errMsg,
  Field,
  input,
  Notice,
  when,
} from '../ui';

const ROLE_LABEL: Record<string, string> = {
  TA_PARTNER: 'Recruiter',
  TA_LEAD: 'Recruiting lead',
  GOVERNANCE: 'Governance (read-only)',
  ADMIN: 'Administrator',
};

interface Created {
  user: { id: string; email: string; displayName: string };
  emailSent: boolean;
  temporaryPassword?: string;
}

export function Users({ meId }: { meId: string }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<Created | null>(null);
  const [form, setForm] = useState({ email: '', displayName: '', role: 'TA_PARTNER' as Role });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setUsers(await api.get<AdminUser[]>('/admin/users'));
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);
  useEffect(() => void load(), [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setCreated(null);
    try {
      setCreated(await api.post<Created>('/admin/users', form));
      setForm({ email: '', displayName: '', role: form.role });
      await load();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  const act = async (fn: () => Promise<unknown>) => {
    setError('');
    setCreated(null);
    try {
      const r = await fn();
      if (r && typeof r === 'object' && 'emailSent' in r) setCreated(r as Created);
      await load();
    } catch (e) {
      setError(errMsg(e));
    }
  };

  return (
    <div className="space-y-4">
      <Card title="Add a user">
        <form onSubmit={create} className="grid gap-3 sm:grid-cols-4">
          <Field label="Email">
            <input
              className={input}
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label="Name">
            <input
              className={input}
              required
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            />
          </Field>
          <Field label="Role">
            <select
              className={input}
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
            >
              {Object.entries(ROLE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex items-end">
            <button className={`${btnPrimary} w-full`} disabled={busy}>
              Create and email credentials
            </button>
          </div>
        </form>
        <p className="mt-2 text-xs text-slate-500">
          The system generates a password and emails it with the sign-in link. The user must choose
          their own password at first sign-in.
        </p>
        {error && (
          <div className="mt-3">
            <Notice kind="error">{error}</Notice>
          </div>
        )}
        {created && (
          <div className="mt-3">
            {created.emailSent ? (
              <Notice kind="ok">Credentials were emailed to {created.user.email}.</Notice>
            ) : (
              <Notice kind="warn">
                Email could not be sent (check the email settings). Give this temporary password to{' '}
                {created.user.email} through a secure channel. It is shown only once:{' '}
                <code className="select-all rounded bg-white px-1.5 py-0.5 font-mono text-base">
                  {created.temporaryPassword}
                </code>
              </Notice>
            )}
          </div>
        )}
      </Card>

      <Card title="Users">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Users</caption>
            <thead className="border-b text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 pr-3">Name</th>
                <th className="pr-3">Email</th>
                <th className="pr-3">Roles</th>
                <th className="pr-3">Status</th>
                <th className="pr-3">Last seen</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users
                .filter((u) => u.issuer !== 'system')
                .map((u) => (
                  <tr key={u.id} className="border-b border-slate-100 align-top">
                    <td className="py-2 pr-3 font-medium">{u.displayName}</td>
                    <td className="pr-3">{u.email}</td>
                    <td className="pr-3">
                      {u.roles.map((r) => ROLE_LABEL[r] ?? r).join(', ') || 'No access'}
                    </td>
                    <td className="pr-3">
                      {u.status === 'disabled'
                        ? 'Disabled'
                        : u.mustChangePassword
                          ? 'Invited'
                          : 'Active'}
                    </td>
                    <td className="pr-3 text-xs text-slate-500">{when(u.lastSeenAt)}</td>
                    <td className="space-x-2 whitespace-nowrap py-1">
                      <button
                        className={btnSecondary}
                        onClick={() => act(() => api.post(`/admin/users/${u.id}/reset-password`))}
                      >
                        Reset password
                      </button>
                      {u.id !== meId && (
                        <button
                          className={u.status === 'active' ? btnDanger : btnSecondary}
                          onClick={() =>
                            act(() =>
                              api.post(`/admin/users/${u.id}/status`, {
                                status: u.status === 'active' ? 'disabled' : 'active',
                              }),
                            )
                          }
                        >
                          {u.status === 'active' ? 'Disable' : 'Enable'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

const PROVIDER_LABEL: Record<string, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI',
  gemini: 'Google (Gemini)',
};

export function AiSettings() {
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      setProviders(await api.get<AiProvider[]>('/admin/ai'));
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);
  useEffect(() => void load(), [load]);
  const active = providers.find((p) => p.isActive);

  return (
    <div className="space-y-4">
      <Notice kind={active ? 'ok' : 'warn'}>
        {active
          ? `Active provider: ${PROVIDER_LABEL[active.provider]} (${active.model}). Screening runs through it.`
          : 'No provider is active. Add a key and select one; until then uploaded CVs wait in the queue.'}
      </Notice>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="grid gap-4 lg:grid-cols-3">
        {providers.map((p) => (
          <ProviderCard key={p.provider} p={p} onChanged={load} />
        ))}
      </div>
      <Notice kind="info">
        Keys are encrypted on the server and are never shown again or sent to the browser. CV text
        is sent to the active provider for assessment, so choose providers your data-protection
        review has approved.
      </Notice>
    </div>
  );
}

function ProviderCard({ p, onChanged }: { p: AiProvider; onChanged: () => void }) {
  const [key, setKey] = useState('');
  const [model, setModel] = useState(p.model);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setMsg({ kind: 'error', text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={PROVIDER_LABEL[p.provider]}>
      <div className="space-y-3">
        <Field label="Model">
          <input className={input} value={model} onChange={(e) => setModel(e.target.value)} />
        </Field>
        <Field
          label="API key"
          hint={
            p.hasKey
              ? `A key ending …${p.keyHint} is stored. Enter a new one to replace it.`
              : 'No key stored.'
          }
        >
          <input
            className={input}
            type="password"
            autoComplete="off"
            placeholder={p.hasKey ? '••••••••' : 'Paste key'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <button
            className={btnPrimary}
            disabled={busy || (!key && model === p.model)}
            onClick={() =>
              run(async () => {
                await api.put(`/admin/ai/${p.provider}`, {
                  ...(key ? { apiKey: key } : {}),
                  ...(model !== p.model ? { model } : {}),
                });
                setKey('');
                setMsg({ kind: 'ok', text: 'Saved.' });
              })
            }
          >
            Save
          </button>
          <button
            className={btnSecondary}
            disabled={busy || !p.hasKey}
            onClick={() =>
              run(async () => {
                const r = await api.post<{ ok: boolean; ms: number; error?: string }>(
                  `/admin/ai/${p.provider}/test`,
                );
                setMsg(
                  r.ok
                    ? { kind: 'ok', text: `Works (${r.ms} ms).` }
                    : { kind: 'error', text: r.error ?? 'Test failed' },
                );
              })
            }
          >
            Test
          </button>
          <button
            className={btnSecondary}
            disabled={busy || !p.hasKey || p.isActive}
            onClick={() =>
              run(async () => void (await api.put('/admin/ai/active', { provider: p.provider })))
            }
          >
            {p.isActive ? 'Active' : 'Make active'}
          </button>
          {p.hasKey && (
            <button
              className={btnDanger}
              disabled={busy}
              onClick={() => run(async () => void (await api.del(`/admin/ai/${p.provider}/key`)))}
            >
              Remove key
            </button>
          )}
        </div>
        {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      </div>
    </Card>
  );
}
