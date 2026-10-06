import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { go } from '../route';
import { btnPrimary, Card, errMsg, Field, input, Notice, when } from '../ui';

interface V {
  id: string;
  title: string;
  department: string | null;
  location: string | null;
  createdAt: string;
  documentCount: number;
  scoredCount?: number;
  pendingCount?: number;
  stoppedCount?: number;
  criteriaVersion?: number | null;
}

export function Vacancies({ canCreate }: { canCreate: boolean }) {
  const [list, setList] = useState<V[] | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api.get<V[]>('/vacancies').then(setList, (e) => setError(errMsg(e)));
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Past scans</h1>
          <p className="text-sm text-ink-3">
            Every scan is kept. Open one to see its results again, or change the requirements and
            read the same resumes against them.
          </p>
        </div>
        {canCreate && (
          <button className={btnPrimary} onClick={() => setCreating((c) => !c)}>
            {creating ? 'Cancel' : 'New vacancy'}
          </button>
        )}
      </div>
      {creating && <NewVacancy />}
      {error && <Notice kind="error">{error}</Notice>}
      {list && list.length === 0 && !creating && (
        <Notice kind="info">
          No vacancies yet.{' '}
          {canCreate
            ? 'Create one to get started.'
            : 'Ask a recruiting lead to give you access to one.'}
        </Notice>
      )}
      <ul className="grid gap-3 sm:grid-cols-2" aria-label="Past scans">
        {list?.map((v) => (
          <li
            key={v.id}
            className="rounded-lg border border-line bg-card p-4 shadow-sm focus-within:ring-2 focus-within:ring-focus"
          >
            <a href={`#/vacancies/${v.id}`} className="font-medium text-link hover:underline">
              {v.title}
            </a>
            <div className="text-sm text-ink-3">
              {[v.department, v.location].filter(Boolean).join(' · ') || ' '}
            </div>
            <div className="mt-2 text-sm text-ink-2">
              {v.documentCount === 0
                ? 'No resumes yet'
                : `${v.documentCount} ${v.documentCount === 1 ? 'resume' : 'resumes'} · ${v.scoredCount ?? 0} scored`}
              {!!v.pendingCount && ` · ${v.pendingCount} still being read`}
              {!!v.stoppedCount && ` · stopped with ${v.stoppedCount} not read`}
            </div>
            <div className="mt-1 text-xs text-ink-3">
              {v.criteriaVersion ? `Requirements version ${v.criteriaVersion} · ` : ''}started{' '}
              {when(v.createdAt)}
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-sm">
              <a className="text-link hover:underline" href={`#/vacancies/${v.id}`}>
                Open results
              </a>
              <a className="text-link hover:underline" href={`#/vacancies/${v.id}/report`}>
                Report
              </a>
              <a className="text-link hover:underline" href={`#/vacancies/${v.id}/criteria`}>
                Change requirements and re-run
              </a>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NewVacancy() {
  const [f, setF] = useState({ title: '', department: '', location: '', jdText: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api.post<{ id: string }>('/vacancies', {
        title: f.title,
        department: f.department || null,
        location: f.location || null,
        jdText: f.jdText,
      });
      go(`/vacancies/${r.id}`);
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  }

  return (
    <Card title="New vacancy">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Title">
            <input
              className={input}
              required
              minLength={3}
              value={f.title}
              onChange={(e) => setF({ ...f, title: e.target.value })}
            />
          </Field>
          <Field label="Department">
            <input
              className={input}
              value={f.department}
              onChange={(e) => setF({ ...f, department: e.target.value })}
            />
          </Field>
          <Field label="Location">
            <input
              className={input}
              value={f.location}
              onChange={(e) => setF({ ...f, location: e.target.value })}
            />
          </Field>
        </div>
        <Field
          label="Job description"
          hint="Paste the full text. The AI will propose screening criteria from it, which you review and edit."
        >
          <textarea
            className={`${input} h-48 font-mono`}
            required
            minLength={50}
            value={f.jdText}
            onChange={(e) => setF({ ...f, jdText: e.target.value })}
          />
        </Field>
        {error && <Notice kind="error">{error}</Notice>}
        <button className={btnPrimary} disabled={busy}>
          Create vacancy
        </button>
      </form>
    </Card>
  );
}
