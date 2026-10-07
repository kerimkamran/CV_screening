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
  NONE: 'Report viewer only (no other access)',
};

interface Created {
  user: { id: string; email: string; displayName: string };
  /** Absent when the admin only asked for a link (nothing was emailed). */
  emailSent?: boolean;
  setupToken: string;
  expiresAt: string;
}

/** Built from the address the admin is using, so it always points at this very site. */
export const inviteLink = (token: string) =>
  `${window.location.origin}/#/set-password?token=${encodeURIComponent(token)}`;

/** The one-time link an administrator sends to a user, who opens it and chooses a password. */
function InviteLink({ created }: { created: Created }) {
  const [copied, setCopied] = useState<'yes' | 'no' | ''>('');
  const link = inviteLink(created.setupToken);
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied('yes');
    } catch {
      setCopied('no'); // clipboard blocked: the field below is pre-selected for a manual copy
    }
  }
  const who = created.user.email;
  return (
    <div className="space-y-2">
      {created.emailSent === true ? (
        <Notice kind="ok">
          Credentials were emailed to {who}. You can also send an invitation link yourself.
        </Notice>
      ) : (
        <Notice kind="warn">
          {created.emailSent === false
            ? 'Email could not be sent (check the email settings). '
            : ''}
          Copy this link and send it to {who} by any channel. When they open it they choose their
          own password. It works once and expires {when(created.expiresAt)}. It is shown only once.
        </Notice>
      )}
      <div className="flex flex-wrap gap-2">
        <input
          readOnly
          aria-label="Invitation link"
          className={`${input} min-w-0 flex-1 font-mono text-xs`}
          value={link}
          onFocus={(e) => e.currentTarget.select()}
        />
        <button type="button" className={btnPrimary} onClick={() => void copy()}>
          Copy link
        </button>
      </div>
      {copied === 'yes' && <p className="text-xs text-green-800">Link copied.</p>}
      {copied === 'no' && (
        <p className="text-xs text-warn-text">
          Your browser blocked copying. The link is selected above: press Ctrl+C (Cmd+C on Mac).
        </p>
      )}
    </div>
  );
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
      if (r && typeof r === 'object' && 'setupToken' in r) setCreated(r as Created);
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
              Create user
            </button>
          </div>
        </form>
        <p className="mt-2 text-xs text-ink-3">
          The user gets an email with a one-time link to choose their own password. If email is not
          set up, or fails, you get the link to copy and send yourself.
        </p>
        {error && (
          <div className="mt-3">
            <Notice kind="error">{error}</Notice>
          </div>
        )}
        {created && (
          <div className="mt-3">
            <InviteLink created={created} />
          </div>
        )}
      </Card>

      <Card title="Users">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Users</caption>
            <thead className="border-b text-xs uppercase text-ink-3">
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
                  <tr key={u.id} className="border-b border-line align-top">
                    <td className="py-2 pr-3 font-medium">{u.displayName}</td>
                    <td className="pr-3">{u.email}</td>
                    <td className="pr-3">
                      {u.roles.map((r) => ROLE_LABEL[r] ?? r).join(', ') || 'Report viewer only'}
                    </td>
                    <td className="pr-3">
                      {u.status === 'disabled'
                        ? 'Disabled'
                        : u.mustChangePassword
                          ? 'Invited'
                          : 'Active'}
                    </td>
                    <td className="pr-3 text-xs text-ink-3">{when(u.lastSeenAt)}</td>
                    <td className="space-x-2 whitespace-nowrap py-1">
                      {u.status === 'active' && (
                        <button
                          className={btnSecondary}
                          onClick={() => act(() => api.post(`/admin/users/${u.id}/setup-link`))}
                        >
                          Copy invite link
                        </button>
                      )}
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
          <h3 className="text-sm font-semibold text-ink">1. Company</h3>
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
          <p className="text-xs text-ink-2">{company.dataNote}</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-ink">2. Model</h3>
          <p className="text-xs text-ink-2">
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
            className="max-h-56 divide-y divide-line overflow-auto rounded-md border border-line"
            aria-label="Models"
          >
            {shown.length === 0 && (
              <li className="px-3 py-2 text-sm text-ink-3">Nothing more to add.</li>
            )}
            {shown.map((m) => (
              <li key={m.id}>
                <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-page">
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
                  {m.label !== m.id && <span className="text-ink-3">{m.label}</span>}
                  {m.note && <span className="text-xs text-warn-text">({m.note})</span>}
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
          <h3 className="text-sm font-semibold text-ink">3. API key</h3>
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
          <span className="text-xs text-ink-3">
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
    <Card title={c.name} actions={<span className="text-xs text-ink-3">key …{c.keyHint}</span>}>
      <div className="space-y-4">
        <div>
          <h3 className="mb-1 text-sm font-medium text-ink-2">Models you can use</h3>
          {c.models.length === 0 ? (
            <p className="text-sm text-ink-3">None yet. Add one above.</p>
          ) : (
            <ul className="divide-y divide-line rounded-md border border-line">
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
                    <span className="rounded bg-ok px-2 py-1 text-xs font-medium text-ok-ink">
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
          <summary className="cursor-pointer font-medium text-ink-2">Key and settings</summary>
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

// ---------------------------------------------------------------- assistant (design spec 6.6.6)

interface AssistantSettingsData {
  enabled: boolean;
  name: string;
  modelRowId: string | null;
  features: { challenge: boolean; compare: boolean; interview: boolean; challengeRecruiter: boolean };
  unavailableMessage: string;
  regionAllowed: string;
  dataTerms: 'unknown' | 'no_retention' | 'retained_no_training' | 'retained_may_train';
  attestedByName: string | null;
  attestedAt: string | null;
  dailyCap: number | null;
  monthlyCap: number | null;
  warnPct: number;
}
interface AssistantOverview {
  settings: AssistantSettingsData;
  models: { id: string; modelId: string; label: string; provider: string }[];
  activeModel: { provider: string; model: string } | null;
  usage: { today: number; month: number };
  warn: boolean;
  testFresh: boolean;
  log: { at: string; by: string | null; action: string; after: unknown }[];
}

const TERMS_LABEL: Record<AssistantSettingsData['dataTerms'], string> = {
  unknown: 'Not recorded yet',
  no_retention: 'Provider keeps nothing and does not train on it',
  retained_no_training: 'Provider keeps it for a time but does not train on it',
  retained_may_train: 'Provider may train on it (cannot be used)',
};
const LOG_LABEL: Record<string, string> = {
  'assistant.setting_changed': 'Settings changed',
  'assistant.tested': 'Connection tested',
};

/** On or off, name, model, feature switches, data terms, limits, and who changed what. */
export function AssistantSettings() {
  const [data, setData] = useState<AssistantOverview | null>(null);
  const [form, setForm] = useState<AssistantSettingsData | null>(null);
  const [attest, setAttest] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<
    { at: string; user: string | null; label: string | null; flags: string[]; model: string | null; kind: string | null }[]
  >([]);

  const load = useCallback(async () => {
    try {
      const d = await api.get<AssistantOverview>('/admin/assistant');
      setData(d);
      setForm(d.settings);
      setAttest(false);
      setTurns((await api.get<{ turns: typeof turns }>('/admin/assistant/audit')).turns);
    } catch (e) {
      setMsg({ kind: 'error', text: errMsg(e) });
    }
  }, []);
  useEffect(() => void load(), [load]);

  if (!data || !form) return msg ? <Notice kind="error">{msg.text}</Notice> : <p className="text-sm text-ink-3">Loading…</p>;
  const set = <K extends keyof AssistantSettingsData>(k: K, v: AssistantSettingsData[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));
  const num = (v: string) => (v.trim() === '' ? null : Math.max(0, Math.floor(Number(v) || 0)));

  async function test() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.post<{ ok: boolean; detail: string }>('/admin/assistant/test', {
        modelRowId: form!.modelRowId,
      });
      setMsg({ kind: r.ok ? 'ok' : 'error', text: r.detail });
      await load();
    } catch (e) {
      setMsg({ kind: 'error', text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const { attestedByName: _a, attestedAt: _b, ...body } = form!;
      void _a;
      void _b;
      const d = await api.put<AssistantOverview>('/admin/assistant', { ...body, attest });
      setData(d);
      setForm(d.settings);
      setAttest(false);
      setMsg({ kind: 'ok', text: 'Saved.' });
    } catch (err) {
      setMsg({ kind: 'error', text: errMsg(err) });
    } finally {
      setBusy(false);
    }
  }

  const usageLine = (n: number, cap: number | null) => (cap === null ? `${n} (no limit)` : `${n} of ${cap}`);
  return (
    <form className="space-y-4" onSubmit={save}>
      <Notice kind={data.settings.enabled ? 'ok' : 'info'}>
        {data.settings.enabled
          ? `${data.settings.name} is on for recruiters.`
          : `${data.settings.name} is off. Recruiters do not see it. It explains stored matches; it never scores, ranks or decides.`}
      </Notice>
      {data.warn && <Notice kind="warn">Usage has passed {data.settings.warnPct}% of a limit.</Notice>}
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}

      <Card title="Assistant">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} />
            Turn the assistant on
          </label>
          <Field label="Name (working name, can change any time)">
            <input className={input} maxLength={30} value={form.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Model" hint="Leave on the scoring model, or pick another. A model is only used after a passing test.">
            <select
              className={input}
              value={form.modelRowId ?? ''}
              onChange={(e) => set('modelRowId', e.target.value || null)}
            >
              <option value="">
                Same as scoring{data.activeModel ? ` (${data.activeModel.provider} · ${data.activeModel.model})` : ''}
              </option>
              {data.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.provider} · {m.label}
                </option>
              ))}
            </select>
          </Field>
          <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
            <button type="button" className={btnSecondary} disabled={busy} onClick={() => void test()}>
              Test connection
            </button>
            <span className="text-sm text-ink-3">
              {data.testFresh ? 'Passed within the last hour.' : 'Not tested in the last hour.'}
            </span>
          </div>
          <Field label="Message when it is unavailable">
            <input
              className={input}
              maxLength={300}
              value={form.unavailableMessage}
              onChange={(e) => set('unavailableMessage', e.target.value)}
            />
          </Field>
        </div>
      </Card>

      <Card title="Functions">
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          {(
            [
              ['challenge', 'Challenge this match'],
              ['compare', 'Compare candidates'],
              ['interview', 'Interview questions'],
              ['challengeRecruiter', 'Say when a question contradicts the record'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.features[k]}
                onChange={(e) => set('features', { ...form.features, [k]: e.target.checked })}
              />
              {label}
            </label>
          ))}
        </div>
      </Card>

      <Card title="Data terms">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="What the provider does with the data">
            <select
              className={input}
              value={form.dataTerms}
              onChange={(e) => set('dataTerms', e.target.value as AssistantSettingsData['dataTerms'])}
            >
              {(Object.keys(TERMS_LABEL) as (keyof typeof TERMS_LABEL)[]).map((k) => (
                <option key={k} value={k}>
                  {TERMS_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Region where data may be processed">
            <input
              className={input}
              maxLength={200}
              value={form.regionAllowed}
              onChange={(e) => set('regionAllowed', e.target.value)}
            />
          </Field>
          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} />
            <span>
              I checked these terms with the provider’s own documentation.
              {data.settings.attestedAt && (
                <span className="block text-xs text-ink-3">
                  Last confirmed by {data.settings.attestedByName ?? 'an administrator'} · {when(data.settings.attestedAt)}
                </span>
              )}
            </span>
          </label>
        </div>
      </Card>

      <Card title="Limits and usage">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Answers per day" hint="Empty means no limit">
            <input
              className={input}
              inputMode="numeric"
              value={form.dailyCap ?? ''}
              onChange={(e) => set('dailyCap', num(e.target.value))}
            />
          </Field>
          <Field label="Answers per month" hint="Empty means no limit">
            <input
              className={input}
              inputMode="numeric"
              value={form.monthlyCap ?? ''}
              onChange={(e) => set('monthlyCap', num(e.target.value))}
            />
          </Field>
          <Field label="Warn me at (%)">
            <input
              className={input}
              inputMode="numeric"
              value={form.warnPct}
              onChange={(e) => set('warnPct', Math.min(100, Math.max(1, num(e.target.value) ?? 80)))}
            />
          </Field>
        </div>
        <p className="mt-2 text-sm text-ink-2">
          Today: {usageLine(data.usage.today, form.dailyCap)} · This month: {usageLine(data.usage.month, form.monthlyCap)}.
          Only answers a model wrote are counted.
        </p>
      </Card>

      <div className="flex gap-2">
        <button type="submit" className={btnPrimary} disabled={busy}>
          Save
        </button>
      </div>

      <Card title="Changes">
        {data.log.length === 0 ? (
          <p className="text-sm text-ink-3">Nothing yet.</p>
        ) : (
          <ul className="space-y-1 text-sm text-ink-2">
            {data.log.map((l, i) => (
              <li key={i}>
                {LOG_LABEL[l.action] ?? l.action} · {l.by ?? 'unknown'} · {when(l.at)}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Recent answers (for review)">
        {turns.length === 0 ? (
          <p className="text-sm text-ink-3">No questions yet.</p>
        ) : (
          <ul className="max-h-72 space-y-1 overflow-y-auto text-sm text-ink-2">
            {turns.slice(0, 50).map((t, i) => (
              <li key={i}>
                {when(t.at)} · {t.user ?? 'unknown'} · {t.label ?? ''} · {t.kind ?? ''}
                {t.flags.length > 0 && ` · ${t.flags.join(', ')}`}
                {t.model ? ` · ${t.model}` : ' · no model'}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </form>
  );
}
