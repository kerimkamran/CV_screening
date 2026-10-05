import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type AdminUser, type AiConnection, type AiOverview, type Role } from '../api';
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

const KIND_LABEL: Record<AiConnection['kind'], string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI',
  gemini: 'Google (Gemini)',
  openai_compatible: 'Other company (OpenAI-compatible)',
};

export function AiSettings() {
  const [data, setData] = useState<AiOverview>({ active: null, connections: [] });
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      setData(await api.get<AiOverview>('/admin/ai'));
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);
  useEffect(() => void load(), [load]);

  return (
    <div className="space-y-4">
      <Notice kind={data.active ? 'ok' : 'warn'}>
        {data.active
          ? `Screening uses ${data.active.provider} · ${data.active.model}. You can switch to any other model below at any time; each assessment records the model that produced it.`
          : 'No model is active. Add a company with its API key, choose models from its list, and make one active. Until then uploaded CVs wait in the queue.'}
      </Notice>
      {error && <Notice kind="error">{error}</Notice>}
      <AddCompany onAdded={load} />
      <div className="grid gap-4 lg:grid-cols-2">
        {data.connections.map((c) => (
          <CompanyCard key={c.id} c={c} onChanged={load} />
        ))}
      </div>
      <Notice kind="info">
        Each company needs one API key; the key gives access to all of that company&apos;s models.
        Keys are encrypted on the server and are never shown again or sent to the browser. CV text
        is sent to the active company for assessment, so choose companies your data-protection
        review has approved.
      </Notice>
    </div>
  );
}

function AddCompany({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AiConnection['kind']>('openai');
  const [baseUrl, setBaseUrl] = useState('');
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api.post('/admin/ai/connections', {
        name,
        kind,
        apiKey: key,
        ...(kind === 'openai_compatible' ? { baseUrl } : {}),
      });
      setName('');
      setKey('');
      setBaseUrl('');
      setMsg({ kind: 'ok', text: 'Company added. Load its models to choose which to use.' });
      onAdded();
    } catch (err) {
      setMsg({ kind: 'error', text: errMsg(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Add an AI company">
      <form className="grid gap-3 md:grid-cols-2" onSubmit={submit}>
        <Field label="Type">
          <select
            className={input}
            value={kind}
            onChange={(e) => {
              const k = e.target.value as AiConnection['kind'];
              setKind(k);
              if (!name && k !== 'openai_compatible') setName(KIND_LABEL[k].split(' (')[0]!);
            }}
          >
            {(Object.keys(KIND_LABEL) as AiConnection['kind'][]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Name shown to administrators">
          <input
            className={input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            required
          />
        </Field>
        {kind === 'openai_compatible' && (
          <Field
            label="Base URL"
            hint="The company's OpenAI-style address, ending in /v1 (see its API documentation). Must be https and public. Works for Mistral, DeepSeek, Groq, xAI, OpenRouter and similar."
          >
            <input
              className={input}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
              required
            />
          </Field>
        )}
        <Field label="API key" hint="One key for all of this company's models.">
          <input
            className={input}
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            required
            minLength={8}
          />
        </Field>
        <div className="flex items-end">
          <button className={btnPrimary} disabled={busy} type="submit">
            Add company
          </button>
        </div>
      </form>
      {msg && (
        <div className="mt-3">
          <Notice kind={msg.kind}>{msg.text}</Notice>
        </div>
      )}
    </Card>
  );
}

function CompanyCard({ c, onChanged }: { c: AiConnection; onChanged: () => void }) {
  const [key, setKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(c.baseUrl ?? '');
  const [available, setAvailable] = useState<{ id: string; label: string }[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [typed, setTyped] = useState('');
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

  const have = new Set(c.models.map((m) => m.modelId));
  const choices = (available ?? [])
    .filter((m) => !have.has(m.id))
    .filter((m) => `${m.id} ${m.label}`.toLowerCase().includes(filter.toLowerCase()));
  const toAdd = [...picked, ...(typed.trim() ? [typed.trim()] : [])];

  return (
    <Card
      title={c.name}
      actions={<span className="text-xs text-slate-500">{KIND_LABEL[c.kind]}</span>}
    >
      <div className="space-y-4">
        <div>
          <h3 className="mb-1 text-sm font-medium text-slate-700">Models you can use</h3>
          {c.models.length === 0 ? (
            <p className="text-sm text-slate-500">None chosen yet. Load the list below.</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
              {c.models.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs" title={m.label}>
                    {m.modelId}
                  </span>
                  <button
                    className={btnSecondary}
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const r = await api.post<{ ok: boolean; ms: number; error?: string }>(
                          `/admin/ai/models/${m.id}/test`,
                        );
                        setMsg(
                          r.ok
                            ? { kind: 'ok', text: `${m.modelId} works (${r.ms} ms).` }
                            : { kind: 'error', text: `${m.modelId}: ${r.error ?? 'test failed'}` },
                        );
                      })
                    }
                  >
                    Test
                  </button>
                  {m.isActive ? (
                    <span className="rounded bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-900">
                      Active
                    </span>
                  ) : (
                    <button
                      className={btnPrimary}
                      disabled={busy}
                      title="Runs a test call first and switches only if it works"
                      onClick={() =>
                        run(async () => {
                          const r = await api.post<{ ok: boolean; error?: string }>(
                            `/admin/ai/models/${m.id}/test`,
                          );
                          if (!r.ok) throw new Error(r.error ?? 'Test failed; not switched.');
                          await api.put('/admin/ai/active', { modelId: m.id });
                        })
                      }
                    >
                      Use this
                    </button>
                  )}
                  <button
                    className={btnSecondary}
                    disabled={busy}
                    aria-label={`Remove ${m.modelId}`}
                    onClick={() =>
                      run(async () => void (await api.del(`/admin/ai/models/${m.id}`)))
                    }
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              className={btnSecondary}
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const r = await api.get<{
                    models: { id: string; label: string }[];
                    error?: string;
                  }>(`/admin/ai/connections/${c.id}/available-models`);
                  setAvailable(r.models);
                  setPicked(new Set());
                  setMsg(
                    r.models.length
                      ? { kind: 'ok', text: `${r.models.length} models available to this key.` }
                      : {
                          kind: 'error',
                          text: `${(r.error ?? 'The company returned no models.').replace(/\.?$/, '.')} You can still type a model id below.`,
                        },
                  );
                })
              }
            >
              {available ? 'Reload list' : `Load ${c.name} models`}
            </button>
          </div>
          {available && available.length > 0 && (
            <>
              <input
                className={input}
                placeholder="Filter models"
                aria-label="Filter models"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <ul className="max-h-48 divide-y divide-slate-100 overflow-auto rounded-md border border-slate-200">
                {choices.length === 0 && (
                  <li className="px-3 py-2 text-sm text-slate-500">Nothing to add.</li>
                )}
                {choices.map((m) => (
                  <li key={m.id}>
                    <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={picked.has(m.id)}
                        onChange={(e) => {
                          const next = new Set(picked);
                          if (e.target.checked) next.add(m.id);
                          else next.delete(m.id);
                          setPicked(next);
                        }}
                      />
                      <span className="font-mono text-xs">{m.id}</span>
                      {m.label !== m.id && <span className="text-slate-500">{m.label}</span>}
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
          <Field label="Or type a model id" hint="For a model that is not in the list.">
            <input
              className={input}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="model-id"
            />
          </Field>
          <button
            className={btnPrimary}
            disabled={busy || toAdd.length === 0}
            onClick={() =>
              run(async () => {
                await api.post(`/admin/ai/connections/${c.id}/models`, {
                  models: toAdd.map((modelId) => ({
                    modelId,
                    label: available?.find((a) => a.id === modelId)?.label,
                  })),
                });
                setPicked(new Set());
                setTyped('');
                setMsg({ kind: 'ok', text: `Added ${toAdd.length}.` });
              })
            }
          >
            Add selected models{toAdd.length ? ` (${toAdd.length})` : ''}
          </button>
        </div>

        <details className="text-sm">
          <summary className="cursor-pointer font-medium text-slate-700">
            Key and settings (key ending …{c.keyHint})
          </summary>
          <div className="mt-2 space-y-2">
            {c.kind === 'openai_compatible' && (
              <Field label="Base URL">
                <input
                  className={input}
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
              </Field>
            )}
            <Field label="Replace API key" hint="The stored key is never shown.">
              <input
                className={input}
                type="password"
                autoComplete="off"
                placeholder="••••••••"
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <button
                className={btnPrimary}
                disabled={busy || (!key && baseUrl === (c.baseUrl ?? ''))}
                onClick={() =>
                  run(async () => {
                    await api.put(`/admin/ai/connections/${c.id}`, {
                      ...(key ? { apiKey: key } : {}),
                      ...(c.kind === 'openai_compatible' && baseUrl !== c.baseUrl
                        ? { baseUrl }
                        : {}),
                    });
                    setKey('');
                    setMsg({ kind: 'ok', text: 'Saved.' });
                  })
                }
              >
                Save
              </button>
              <button
                className={btnDanger}
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      `Remove ${c.name}, its key and its models? If one of them is active, no model will be active until you choose another.`,
                    )
                  )
                    void run(async () => void (await api.del(`/admin/ai/connections/${c.id}`)));
                }}
              >
                Remove company
              </button>
            </div>
          </div>
        </details>
        {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      </div>
    </Card>
  );
}
