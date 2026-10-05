import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  api,
  type AdminUser,
  type AiCompany,
  type AiConnection,
  type AiModelChoice,
  type AiOverview,
  type Role,
} from '../api';
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

type Msg = { kind: 'ok' | 'error' | 'info'; text: string };

export function AiSettings() {
  const [data, setData] = useState<AiOverview>({ active: null, connections: [] });
  const [catalog, setCatalog] = useState<AiCompany[]>([]);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const [overview, cat] = await Promise.all([
        api.get<AiOverview>('/admin/ai'),
        api.get<{ companies: AiCompany[] }>('/admin/ai/catalog'),
      ]);
      setData(overview);
      setCatalog(cat.companies);
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
          : 'No model is active. Choose a company, choose a model, add the API key, then press "Use this". Until then uploaded CVs wait in the queue.'}
      </Notice>
      {error && <Notice kind="error">{error}</Notice>}
      {catalog.length > 0 && (
        <AddModel catalog={catalog} connections={data.connections} onDone={load} />
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {data.connections.map((c) => (
          <CompanyCard
            key={c.id}
            c={c}
            company={catalog.find((x) => x.id === c.company)}
            onChanged={load}
          />
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

/** Three steps: company, model, API key (plus any extra options the company needs). */
function AddModel({
  catalog,
  connections,
  onDone,
}: {
  catalog: AiCompany[];
  connections: AiConnection[];
  onDone: () => void;
}) {
  const [companyId, setCompanyId] = useState(catalog[0]!.id);
  const [list, setList] = useState<AiModelChoice[] | null>(null); // live list, once loaded
  const [live, setLive] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [typed, setTyped] = useState('');
  const [filter, setFilter] = useState('');
  const [key, setKey] = useState('');
  const [options, setOptions] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Msg | null>(null);
  const [busy, setBusy] = useState(false);

  const company = catalog.find((c) => c.id === companyId)!;
  const existing = connections.find((c) => c.company === companyId);
  const have = new Set(existing?.models.map((m) => m.modelId));
  const shown = (list ?? company.knownModels)
    .filter((m) => !have.has(m.id))
    .filter((m) => `${m.id} ${m.label}`.toLowerCase().includes(filter.toLowerCase()));
  const toAdd = [...picked, ...(typed.trim() ? [typed.trim()] : [])];
  const labelOf = (id: string) =>
    (list ?? company.knownModels).find((m) => m.id === id)?.label ?? id;
  const settings = Object.fromEntries(Object.entries(options).filter(([, v]) => v !== ''));
  const canLoad = Boolean(key.trim().length >= 8 || existing);

  const chooseCompany = (id: string) => {
    setCompanyId(id);
    setList(null);
    setLive(false);
    setPicked(new Set());
    setTyped('');
    setFilter('');
    setKey('');
    setOptions({});
    setMsg(null);
  };

  const loadAll = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r =
        key.trim().length >= 8
          ? await api.post<{ live: boolean; models: AiModelChoice[]; error?: string }>(
              '/admin/ai/discover',
              { company: companyId, apiKey: key.trim(), settings },
            )
          : await api.get<{ live: boolean; models: AiModelChoice[]; error?: string }>(
              `/admin/ai/connections/${existing!.id}/available-models`,
            );
      setList(r.models);
      setLive(r.live);
      setMsg(
        r.live
          ? { kind: 'ok', text: `${r.models.length} models available to this key.` }
          : { kind: 'info', text: r.error ?? 'Showing the documented models.' },
      );
    } catch (e) {
      setMsg({ kind: 'error', text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const models = toAdd.map((modelId) => ({ modelId, label: labelOf(modelId) }));
      if (!existing) {
        await api.post('/admin/ai/connections', {
          company: companyId,
          apiKey: key.trim(),
          ...(Object.keys(settings).length ? { settings } : {}),
          models,
        });
      } else {
        if (key.trim() || Object.keys(settings).length) {
          await api.put(`/admin/ai/connections/${existing.id}`, {
            ...(key.trim() ? { apiKey: key.trim() } : {}),
            ...(Object.keys(settings).length ? { settings } : {}),
          });
        }
        if (models.length)
          await api.post(`/admin/ai/connections/${existing.id}/models`, { models });
      }
      setPicked(new Set());
      setTyped('');
      setKey('');
      setMsg({
        kind: 'ok',
        text: `Saved. Press "Test" on the model below, then "Use this" to make it the screening model.`,
      });
      onDone();
    } catch (err) {
      setMsg({ kind: 'error', text: errMsg(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Add a model">
      <form className="space-y-5" onSubmit={submit}>
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-800">1. Company</h3>
          <Field label="Company">
            <select
              className={input}
              value={companyId}
              onChange={(e) => chooseCompany(e.target.value)}
            >
              {catalog.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {connections.some((x) => x.company === c.id) ? ' (key added)' : ''}
                </option>
              ))}
            </select>
          </Field>
          <p className="text-xs text-slate-600">{company.dataNote}</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-800">2. Model</h3>
          <p className="text-xs text-slate-600">
            {live
              ? `All ${company.name} models this key can use. Tick one or more.`
              : `${company.name} models from its documentation. After you add the key, load the full list from ${company.name} itself.`}
          </p>
          {(list ?? company.knownModels).length > 8 && (
            <input
              className={input}
              placeholder="Filter models"
              aria-label="Filter models"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          )}
          <ul
            className="max-h-56 divide-y divide-slate-100 overflow-auto rounded-md border border-slate-200"
            aria-label="Models"
          >
            {shown.length === 0 && (
              <li className="px-3 py-2 text-sm text-slate-500">Nothing more to add.</li>
            )}
            {shown.map((m) => (
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
                  {m.note && <span className="text-xs text-amber-700">({m.note})</span>}
                </label>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-end gap-3">
            <button
              type="button"
              className={btnSecondary}
              disabled={busy || !canLoad}
              title={canLoad ? undefined : 'Add the API key first (step 3)'}
              onClick={() => void loadAll()}
            >
              Load all {company.name} models
            </button>
            <div className="min-w-48 flex-1">
              <Field label="Other model ID" hint="For a model that is not in the list.">
                <input
                  className={input}
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder="model-id"
                />
              </Field>
            </div>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-800">3. API key</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <Field
              label="API key"
              hint={
                existing
                  ? `Key ending …${existing.keyHint} is on file. Leave empty to keep it.`
                  : company.keyHelp
              }
            >
              <input
                className={input}
                type="password"
                autoComplete="off"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                required={!existing}
                minLength={8}
              />
            </Field>
            {company.extraFields.map((f) => (
              <Field key={f.key} label={f.label} hint={f.hint}>
                <select
                  className={input}
                  value={options[f.key] ?? existing?.settings[f.key] ?? ''}
                  required={f.required && !existing}
                  onChange={(e) => setOptions({ ...options, [f.key]: e.target.value })}
                >
                  {!f.required && <option value="">Default</option>}
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <button
            className={btnPrimary}
            disabled={
              busy ||
              (!existing && toAdd.length === 0) ||
              (existing && toAdd.length === 0 && !key.trim())
            }
            type="submit"
          >
            {existing ? 'Save' : 'Save company and model'}
            {toAdd.length ? ` (${toAdd.length} model${toAdd.length > 1 ? 's' : ''})` : ''}
          </button>
          <span className="text-xs text-slate-500">
            The key is sent over HTTPS, encrypted on the server, and never shown again.
          </span>
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

function CompanyCard({
  c,
  company,
  onChanged,
}: {
  c: AiConnection;
  company: AiCompany | undefined;
  onChanged: () => void;
}) {
  const [key, setKey] = useState('');
  const [options, setOptions] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Msg | null>(null);
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

  const changed = Object.entries(options).filter(([k, v]) => v !== (c.settings[k] ?? ''));

  return (
    <Card title={c.name} actions={<span className="text-xs text-slate-500">key …{c.keyHint}</span>}>
      <div className="space-y-4">
        <div>
          <h3 className="mb-1 text-sm font-medium text-slate-700">Models you can use</h3>
          {c.models.length === 0 ? (
            <p className="text-sm text-slate-500">None yet. Add one above.</p>
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

        <details className="text-sm">
          <summary className="cursor-pointer font-medium text-slate-700">Key and settings</summary>
          <div className="mt-2 space-y-2">
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
            {company?.extraFields.map((f) => (
              <Field key={f.key} label={f.label} hint={f.hint}>
                <select
                  className={input}
                  value={options[f.key] ?? c.settings[f.key] ?? ''}
                  onChange={(e) => setOptions({ ...options, [f.key]: e.target.value })}
                >
                  {!f.required && <option value="">Default</option>}
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
            <div className="flex flex-wrap gap-2">
              <button
                className={btnPrimary}
                disabled={busy || (!key && changed.length === 0)}
                onClick={() =>
                  run(async () => {
                    await api.put(`/admin/ai/connections/${c.id}`, {
                      ...(key ? { apiKey: key } : {}),
                      ...(changed.length
                        ? { settings: { ...c.settings, ...Object.fromEntries(changed) } }
                        : {}),
                    });
                    setKey('');
                    setOptions({});
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
