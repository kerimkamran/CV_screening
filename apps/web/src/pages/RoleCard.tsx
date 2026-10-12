import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { VACANCY_STATUSES, type VacancyStatus } from '@cv/shared';
import { api, ApiError, type Criteria } from '../api';
import { useT, tr } from '../i18n';
import {
  ago,
  statusName,
  useLeaveGuard,
  type ExperienceRange,
  type VacancyRequirement,
  type VacancyView,
} from '../pool';
import { btnPrimary, btnSecondary, Card, errMsg, Field, input, Notice } from '../ui';

/**
 * The Role card (Development Plan, Phase 1): everything about the position on one card. Only the
 * title is needed to save. Requirements can be typed, pasted, read from a Word file or from a link;
 * "Read requirements" turns them into skill chips. Save checks the version, an unsaved draft stays
 * in this browser, and leaving with unsaved changes asks first.
 */

const EXPERIENCE: [ExperienceRange, string][] = [
  ['any', 'Any'],
  ['1-3', '1–3 yrs'],
  ['3-5', '3–5 yrs'],
  ['5+', '5+ yrs'],
];
const MIN_READ = 20;

interface Form {
  title: string;
  status: VacancyStatus;
  experience: ExperienceRange;
  text: string;
  department: string;
  location: string;
  openings: string;
  closingDate: string;
  hiringManager: string;
  notes: string;
  reqs: VacancyRequirement[];
  sourceType: 'typed' | 'pasted' | 'file' | 'url';
  sourceFileName: string;
  linkUrl: string;
  linkHash: string;
}

const blank = (): Form => ({
  title: '',
  status: 'draft',
  experience: 'any',
  text: '',
  department: '',
  location: '',
  openings: '',
  closingDate: '',
  hiringManager: '',
  notes: '',
  reqs: [],
  sourceType: 'typed',
  sourceFileName: '',
  linkUrl: '',
  linkHash: '',
});

const asSource = (s: string): Form['sourceType'] =>
  s === 'pasted' || s === 'file' || s === 'url' ? s : 'typed';

const fromView = (v: VacancyView): Form => ({
  title: v.title,
  status: v.status,
  experience: v.experienceRange,
  text: v.description,
  department: v.department ?? '',
  location: v.location ?? '',
  openings: v.openings ? String(v.openings) : '',
  closingDate: v.closingDate ?? '',
  hiringManager: v.hiringManager ?? '',
  notes: v.notes ?? '',
  reqs: v.requirements.map((r) => ({ ...r })),
  sourceType: asSource(v.sourceType),
  sourceFileName: v.sourceFileName ?? '',
  linkUrl: v.link?.url ?? '',
  linkHash: '',
});

const reqKey = (rs: VacancyRequirement[]) =>
  JSON.stringify(rs.map((r) => [r.text, r.classification, r.weight]));
const same = (a: Form, b: Form) =>
  JSON.stringify({ ...a, reqs: reqKey(a.reqs) }) === JSON.stringify({ ...b, reqs: reqKey(b.reqs) });

const plural = (n: number, one: string, many: string) => tr(n === 1 ? one : many, { n });
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const draftKey = (id: string | null) => `cv-vacancy-draft:${id ?? 'new'}`;

interface Similar {
  id: string;
  title: string;
  status: VacancyStatus;
  ownerName: string;
  documents: number;
}

export function RoleCard({
  vacancy,
  onSaved,
  onReload,
  onDirty,
}: {
  /** null: a vacancy that does not exist yet. */
  vacancy: VacancyView | null;
  onSaved: (v: VacancyView) => void;
  onReload: () => Promise<void>;
  onDirty?: (dirty: boolean) => void;
}) {
  const t = useT();
  const id = vacancy?.id ?? null;
  const [saved, setSaved] = useState<Form>(() => (vacancy ? fromView(vacancy) : blank()));
  const [form, setForm] = useState<Form>(saved);
  const [version, setVersion] = useState(vacancy?.version ?? 0);
  const [busy, setBusy] = useState<'' | 'save' | 'read' | 'word' | 'link' | 'again'>('');
  const [error, setError] = useState('');
  const [stale, setStale] = useState('');
  const [info, setInfo] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [similar, setSimilar] = useState<Similar[]>([]);
  const [ignoreSimilar, setIgnoreSimilar] = useState(false);
  const [draftFrom, setDraftFrom] = useState<{ form: Form; at: string } | null>(null);
  const [newSkill, setNewSkill] = useState('');
  const [wordRead, setWordRead] = useState<{ name: string; words: number } | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkInput, setLinkInput] = useState('');
  const [linkRead, setLinkRead] = useState<{ host: string; words: number } | null>(null);
  const [problem, setProblem] = useState('');
  const [readText, setReadText] = useState<string | null>(
    vacancy?.requirements.length ? vacancy.description : null,
  );
  const manual = useRef(new Set<string>());
  const wordRef = useRef<HTMLInputElement>(null);

  const locked = vacancy ? !vacancy.canEdit || vacancy.archived : false;
  const dirty = !same(form, saved);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  // A newer version of the vacancy arrived (reload, or another tab): show it, unless there are edits.
  useEffect(() => {
    if (!vacancy) return;
    const next = fromView(vacancy);
    setVersion(vacancy.version);
    setSaved(next);
    setForm((cur) => (same(cur, saved) ? next : cur));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vacancy?.version, vacancy?.requirementsVersion]);

  // The browser draft: written while there are unsaved changes, offered on the next visit.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey(id));
      if (!raw) return;
      const d = JSON.parse(raw) as { form: Form; at: string };
      if (d?.form && !same(d.form, saved)) setDraftFrom(d);
    } catch {
      /* a draft is a convenience only */
    }
    // Only when the page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    if (locked) return;
    const h = setTimeout(() => {
      try {
        if (dirty)
          localStorage.setItem(
            draftKey(id),
            JSON.stringify({ form, at: new Date().toISOString() }),
          );
        else if (!draftFrom) localStorage.removeItem(draftKey(id));
      } catch {
        /* storage can be blocked */
      }
    }, 400);
    return () => clearTimeout(h);
  }, [form, dirty, id, locked, draftFrom]);
  const clearDraft = () => {
    try {
      localStorage.removeItem(draftKey(id));
    } catch {
      /* ignore */
    }
    setDraftFrom(null);
  };

  useEffect(() => onDirty?.(dirty && !locked), [dirty, locked, onDirty]);
  const leaving = useRef(false);
  useLeaveGuard(dirty && !locked, t('You have unsaved changes. Leave without saving?'), leaving);

  // ---------------------------------------------------------------- similar titles
  const checkSimilar = useCallback(
    async (title: string) => {
      if (vacancy || title.trim().length < 3) return setSimilar([]);
      try {
        setSimilar(
          await api.get<Similar[]>(`/vacancies/similar?title=${encodeURIComponent(title.trim())}`),
        );
      } catch {
        setSimilar([]);
      }
    },
    [vacancy],
  );

  // ---------------------------------------------------------------- save
  const payload = (f: Form, base: Form) => {
    const p: Record<string, unknown> = {};
    if (f.title.trim() !== base.title) p['title'] = f.title.trim();
    if (f.status !== base.status) p['status'] = f.status;
    if (f.experience !== base.experience) p['experienceRange'] = f.experience;
    if (f.text.trim() !== base.text.trim()) p['description'] = f.text.trim();
    if (f.department !== base.department) p['department'] = f.department.trim() || null;
    if (f.location !== base.location) p['location'] = f.location.trim() || null;
    if (f.openings !== base.openings) p['openings'] = f.openings ? Number(f.openings) : null;
    if (f.closingDate !== base.closingDate) p['closingDate'] = f.closingDate || null;
    if (f.hiringManager !== base.hiringManager) p['hiringManager'] = f.hiringManager.trim() || null;
    if (f.notes !== base.notes) p['notes'] = f.notes.trim() || null;
    if (f.sourceType !== base.sourceType) p['sourceType'] = f.sourceType;
    if (f.sourceFileName !== base.sourceFileName) p['sourceFileName'] = f.sourceFileName || null;
    if (f.linkUrl !== base.linkUrl) p['linkUrl'] = f.linkUrl || null;
    if (f.linkHash) p['linkHash'] = f.linkHash;
    if (f.reqs.length && reqKey(f.reqs) !== reqKey(base.reqs))
      p['requirements'] = f.reqs.map((r) => ({
        text: r.text,
        classification: r.classification,
        weight: r.weight,
        rule: r.rule ?? null,
        confidence: r.confidence ?? null,
      }));
    return p;
  };

  /** Returns the saved vacancy, or null when it could not be saved (the reason is on screen). */
  async function save(): Promise<VacancyView | null> {
    setShowErrors(true);
    setError('');
    setStale('');
    setInfo('');
    if (form.title.trim().length < 2) return null;
    if (!vacancy && !ignoreSimilar) {
      try {
        const found = await api.get<Similar[]>(
          `/vacancies/similar?title=${encodeURIComponent(form.title.trim())}`,
        );
        setSimilar(found);
        if (found.length) return null;
      } catch {
        /* the check is a help; do not block saving on it */
      }
    }
    setBusy('save');
    try {
      let v: VacancyView;
      let base = saved;
      let ver = version;
      if (!vacancy) {
        const c = await api.post<{ id: string }>('/vacancies', { title: form.title.trim() });
        v = await api.get<VacancyView>(`/vacancies/${c.id}`);
        base = blank();
        ver = v.version;
        const rest = payload(form, base);
        delete rest['title'];
        if (Object.keys(rest).length)
          v = await api.patch<VacancyView>(`/vacancies/${c.id}`, { expectedVersion: ver, ...rest });
        try {
          localStorage.removeItem(draftKey(null));
        } catch {
          /* ignore */
        }
        leaving.current = true; // the new vacancy opens next: that is not leaving unsaved work
        onSaved(v);
        return v;
      }
      const p = payload(form, base);
      if (Object.keys(p).length === 0) {
        setInfo(t('Nothing to save.'));
        return vacancy;
      }
      v = await api.patch<VacancyView>(`/vacancies/${vacancy.id}`, { expectedVersion: ver, ...p });
      const next = fromView(v);
      setSaved(next);
      setForm((f) => ({ ...f, linkHash: '', reqs: f.reqs.length ? f.reqs : next.reqs }));
      setVersion(v.version);
      clearDraft();
      setInfo(t('Saved.'));
      onSaved(v);
      return v;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'STALE_VERSION') setStale(errMsg(e));
      else setError(errMsg(e));
      return null;
    } finally {
      setBusy('');
    }
  }

  // ---------------------------------------------------------------- requirement sources
  async function attachWord(file: File | undefined) {
    if (!file) return;
    setProblem('');
    setBusy('word');
    try {
      const r = await api.upload<{ filename: string; text: string; words: number }>(
        '/vacancies/read-document',
        [file],
      );
      setWordRead({ name: r.filename, words: r.words });
      setForm((f) => ({
        ...f,
        text: f.text.trim() ? `${f.text.trim()}\n\n${r.text}` : r.text,
        sourceType: 'file',
        sourceFileName: r.filename,
      }));
    } catch (e) {
      setProblem(errMsg(e));
    } finally {
      setBusy('');
      if (wordRef.current) wordRef.current.value = '';
    }
  }

  async function readLink() {
    if (!linkInput.trim()) return;
    setProblem('');
    setBusy('link');
    try {
      const r = await api.post<{ host: string; text: string; words: number; hash: string }>(
        '/vacancies/read-link',
        { url: linkInput.trim() },
      );
      setLinkRead({ host: r.host, words: r.words });
      setForm((f) => ({
        ...f,
        text: f.text.trim() ? `${f.text.trim()}\n\n${r.text}` : r.text,
        sourceType: 'url',
        linkUrl: linkInput.trim(),
        linkHash: r.hash,
      }));
      setLinkOpen(false);
      setLinkInput('');
    } catch (e) {
      setProblem(errMsg(e));
    } finally {
      setBusy('');
    }
  }

  async function readAgain() {
    if (!vacancy) return;
    setProblem('');
    setInfo('');
    setBusy('again');
    try {
      const r = await api.post<{
        status: 'unchanged' | 'changed' | 'unreadable';
        text?: string;
        hash?: string;
        words?: number;
        since?: string;
        message?: string;
      }>(`/vacancies/${vacancy.id}/reread`, { apply: false });
      if (r.status === 'unchanged') setInfo(t('The page has not changed since it was last read.'));
      else if (r.status === 'unreadable')
        setProblem(t("Couldn't read that page. Paste the text instead."));
      else {
        setForm((f) => ({
          ...f,
          text: r.text ?? f.text,
          sourceType: 'url',
          linkHash: r.hash ?? '',
        }));
        setInfo(
          t(
            'The page has changed. Its new text is in the box. Save to keep it, then read the requirements again.',
          ),
        );
      }
    } catch (e) {
      setProblem(errMsg(e));
    } finally {
      setBusy('');
    }
  }

  async function readRequirements() {
    setShowErrors(true);
    setError('');
    if (form.title.trim().length < 2 || form.text.trim().length < MIN_READ) return;
    setBusy('read');
    try {
      const v = await save();
      if (!v) return;
      const c = await api.post<Criteria>(`/vacancies/${v.id}/criteria/extract`);
      const found = (c.current?.requirements ?? []) as VacancyRequirement[];
      // Skills added by hand are kept; the AI's own are replaced by the new reading.
      const have = new Set(found.map((r) => r.text.toLowerCase()));
      const kept = form.reqs.filter(
        (r) => manual.current.has(r.text.toLowerCase()) && !have.has(r.text.toLowerCase()),
      );
      const fresh = await api.get<VacancyView>(`/vacancies/${v.id}`);
      const next = fromView(fresh);
      setSaved(next);
      setVersion(fresh.version);
      setForm({ ...next, reqs: [...found, ...kept] });
      setReadText(form.text);
      onSaved(fresh);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy('');
    }
  }

  // ---------------------------------------------------------------- chips
  const chips = form.reqs.filter(
    (r) => r.classification === 'mandatory' || r.classification === 'preferred',
  );
  const others = form.reqs.filter(
    (r) => r.classification !== 'mandatory' && r.classification !== 'preferred',
  );
  const flip = (r: VacancyRequirement) =>
    setForm((f) => ({
      ...f,
      reqs: f.reqs.map((x) =>
        x === r
          ? {
              ...x,
              classification: x.classification === 'mandatory' ? 'preferred' : 'mandatory',
              weight: x.classification === 'mandatory' ? 5 : 10,
            }
          : x,
      ),
    }));
  const drop = (r: VacancyRequirement) =>
    setForm((f) => ({ ...f, reqs: f.reqs.filter((x) => x !== r) }));
  function addSkill() {
    const skill = newSkill.trim();
    if (skill.length < 3) return;
    if (!form.reqs.some((r) => r.text.toLowerCase() === skill.toLowerCase())) {
      manual.current.add(skill.toLowerCase());
      setForm((f) => ({
        ...f,
        reqs: [...f.reqs, { text: skill, classification: 'mandatory', weight: 10, rule: null }],
      }));
    }
    setNewSkill('');
  }

  const textChanged = readText !== null && readText !== form.text;
  const titleOk = form.title.trim().length >= 2;
  const savedLink = vacancy?.link ?? null;
  const owner = useMemo(() => vacancy?.owner.name ?? '', [vacancy]);

  return (
    <Card title={t('The role')}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {locked && (
          <Notice kind="info">
            {vacancy?.archived
              ? t('This vacancy is archived. Restore it to change it.')
              : t('Only {name} or a team lead can change this role.', { name: owner })}
          </Notice>
        )}
        {draftFrom && !locked && (
          <Notice kind="info">
            <span>{t('You have unsaved changes from {when}.', { when: ago(draftFrom.at) })}</span>{' '}
            <button
              type="button"
              className="underline"
              onClick={() => {
                setForm(draftFrom.form);
                setDraftFrom(null);
              }}
            >
              {t('Restore them')}
            </button>{' '}
            <button type="button" className="underline" onClick={clearDraft}>
              {t('Discard')}
            </button>
          </Notice>
        )}
        {stale && (
          <Notice kind="warn">
            <span>{stale}</span>{' '}
            <button
              type="button"
              className="underline"
              onClick={() => {
                // Keep what was typed as a draft, then show the newer version.
                try {
                  localStorage.setItem(
                    draftKey(id),
                    JSON.stringify({ form, at: new Date().toISOString() }),
                  );
                } catch {
                  /* ignore */
                }
                setStale('');
                void onReload();
              }}
            >
              {t('Reload their version')}
            </button>
          </Notice>
        )}
        {error && <Notice kind="error">{error}</Notice>}

        <Field label={t('Position')}>
          <input
            className={input}
            disabled={locked}
            placeholder={t('e.g. Network Engineer')}
            value={form.title}
            maxLength={200}
            onChange={(e) => {
              set('title', e.target.value);
              setIgnoreSimilar(false);
              if (similar.length) setSimilar([]);
            }}
            onBlur={(e) => void checkSimilar(e.target.value)}
          />
          {showErrors && !titleOk && (
            <span className="mt-1 block text-sm text-err-ink">{t('Add the position title.')}</span>
          )}
        </Field>

        {similar.length > 0 && !ignoreSimilar && (
          <div
            role="alert"
            className="rounded-md border border-warn-line bg-warn p-3 text-sm text-warn-ink"
          >
            <p className="font-medium">
              {t('A vacancy like this is already in the system. Use that one?')}
            </p>
            <ul className="mt-2 space-y-1">
              {similar.map((s) => (
                <li key={s.id}>
                  <a className="font-medium underline" href={`#/vacancies/${s.id}`}>
                    {s.title}
                  </a>{' '}
                  <span>
                    · {statusName(s.status)} · {s.ownerName} ·{' '}
                    {plural(s.documents, '{n} resume', '{n} resumes')}
                  </span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className={`${btnSecondary} mt-2`}
              onClick={() => setIgnoreSimilar(true)}
            >
              {t('Create a new one anyway')}
            </button>
          </div>
        )}

        {vacancy && (
          <Field label={t('Status')}>
            <select
              className={input}
              disabled={locked}
              value={form.status}
              onChange={(e) => set('status', e.target.value as VacancyStatus)}
            >
              {VACANCY_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusName(s)}
                </option>
              ))}
            </select>
          </Field>
        )}

        <div role="group" aria-label={t('Experience')} className="text-sm">
          <span className="mb-1 block font-medium text-ink-2">{t('Experience')}</span>
          <div className="flex flex-wrap gap-2">
            {EXPERIENCE.map(([k, label]) => (
              <button
                key={k}
                type="button"
                disabled={locked}
                aria-pressed={form.experience === k}
                onClick={() => set('experience', k)}
                className={`rounded-full border px-3 py-1 ${form.experience === k ? 'border-accent bg-accent text-on-accent' : 'border-edge bg-card text-ink'} focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none disabled:opacity-60`}
              >
                {t(label)}
              </button>
            ))}
          </div>
        </div>

        <Field
          label={t('Requirements')}
          hint={t('Paste the vacancy or type what you need. Azerbaijani, English or both.')}
        >
          <textarea
            className={`${input} h-40`}
            disabled={locked}
            value={form.text}
            maxLength={20_000}
            onChange={(e) => set('text', e.target.value)}
            onPaste={() => {
              if (!form.text.trim()) set('sourceType', 'pasted');
            }}
          />
        </Field>

        {!locked && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <button
              type="button"
              className="text-link hover:underline"
              disabled={busy !== ''}
              onClick={() => wordRef.current?.click()}
            >
              {busy === 'word' ? t('Reading the file…') : t('Attach a Word file')}
            </button>
            <input
              ref={wordRef}
              type="file"
              accept=".docx"
              aria-label={t('Attach a Word file')}
              className="sr-only"
              onChange={(e) => void attachWord(e.target.files?.[0])}
            />
            {wordRead && (
              <span className="text-ink-3">
                {t('Read {file}', {
                  file: `${wordRead.name} · ${plural(wordRead.words, '{n} word', '{n} words')}`,
                })}
              </span>
            )}
            <span aria-hidden="true" className="text-ink-3">
              ·
            </span>
            <button
              type="button"
              className="text-link hover:underline"
              aria-expanded={linkOpen}
              disabled={busy !== ''}
              onClick={() => setLinkOpen((v) => !v)}
            >
              {t('Add a vacancy link')}
            </button>
            {linkRead && (
              <span className="text-ink-3">
                {t('Read from {source}', {
                  source: `${linkRead.host} · ${plural(linkRead.words, '{n} word', '{n} words')}`,
                })}
              </span>
            )}
            {savedLink && (
              <>
                <span aria-hidden="true" className="text-ink-3">
                  ·
                </span>
                <button
                  type="button"
                  className="text-link hover:underline"
                  disabled={busy !== ''}
                  onClick={() => void readAgain()}
                >
                  {busy === 'again' ? t('Reading the page…') : t('Read the saved link again')}
                </button>
              </>
            )}
          </div>
        )}
        {savedLink && (
          <p className="truncate text-xs text-ink-3">
            {t('Saved link')}: <span className="text-ink-2">{savedLink.url}</span>
            {savedLink.readAt && <> · {t('read {when}', { when: ago(savedLink.readAt) })}</>}
          </p>
        )}
        {linkOpen && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <Field
                label={t('Vacancy link')}
                hint={t('A public page. If it cannot be read, paste the text.')}
              >
                <input
                  className={input}
                  type="url"
                  inputMode="url"
                  placeholder="https://example.com/jobs/network-engineer"
                  value={linkInput}
                  onChange={(e) => setLinkInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void readLink();
                    }
                  }}
                />
              </Field>
            </div>
            <button
              type="button"
              className={btnSecondary}
              disabled={busy !== '' || !linkInput.trim()}
              onClick={() => void readLink()}
            >
              {busy === 'link' ? t('Reading the page…') : t('Read the page')}
            </button>
          </div>
        )}
        {problem && (
          <p role="alert" className="text-sm text-err-ink">
            {problem}
          </p>
        )}

        {!locked && (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={btnSecondary}
              disabled={busy !== ''}
              onClick={() => void readRequirements()}
            >
              {busy === 'read'
                ? t('Reading…')
                : readText !== null || chips.length
                  ? t('Read requirements again')
                  : t('Read requirements')}
            </button>
            {form.text.trim() && (
              <span className="text-sm text-ink-3">
                {plural(words(form.text), '{n} word', '{n} words')}
              </span>
            )}
            {textChanged && (
              <span className="text-sm text-warn-text">
                {t('The text changed since it was read.')}
              </span>
            )}
            {showErrors && form.text.trim().length < MIN_READ && busy === '' && (
              <span className="text-sm text-err-ink">
                {t('Write or paste at least a few lines about the role.')}
              </span>
            )}
          </div>
        )}

        {form.reqs.length > 0 && (
          <div aria-label={t('Skills')} role="group" className="space-y-2">
            <p className="text-sm font-medium text-ink-2">{t('Skills the AI understood')}</p>
            <ul className="flex flex-wrap gap-2">
              {chips.map((r, i) => {
                const must = r.classification === 'mandatory';
                return (
                  <li key={`${r.text}:${i}`} className="inline-flex items-center">
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => flip(r)}
                      aria-label={
                        must
                          ? t('{skill}, must-have. Press to change to nice-to-have', {
                              skill: r.text,
                            })
                          : t('{skill}, nice-to-have. Press to change to must-have', {
                              skill: r.text,
                            })
                      }
                      className={`inline-flex items-center gap-1.5 rounded-l-full border px-3 py-1 text-sm focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none ${must ? 'border-accent bg-accent text-on-accent' : 'border-edge bg-card text-ink'}`}
                    >
                      <span aria-hidden="true">{must ? '●' : '○'}</span>
                      {r.text}
                    </button>
                    {!locked && (
                      <button
                        type="button"
                        onClick={() => drop(r)}
                        aria-label={t('Remove {name}', { name: r.text })}
                        className="rounded-r-full border border-l-0 border-edge bg-card px-2 py-1 text-sm text-ink-2 hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
                      >
                        ×
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            {!locked && (
              <div className="flex gap-2">
                <input
                  className={input}
                  aria-label={t('Add another skill')}
                  placeholder={t('Add another skill')}
                  value={newSkill}
                  onChange={(e) => setNewSkill(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addSkill();
                    }
                  }}
                />
                <button type="button" className={btnSecondary} onClick={addSkill}>
                  {t('Add')}
                </button>
              </div>
            )}
            <p className="text-sm text-ink-3">
              {t(
                'Press a skill to switch between must-have (●) and nice-to-have (○). A missing must-have lowers the match. It never hides anyone.',
              )}
            </p>
            {others.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-ink-2">
                  {plural(
                    others.length,
                    '{n} other requirement kept as text',
                    '{n} other requirements kept as text',
                  )}
                </summary>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-ink-2">
                  {others.map((r, i) => (
                    <li key={i}>{r.text}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
        {form.reqs.length === 0 && vacancy && (
          <p className="text-sm text-ink-3">
            {t('No skills yet. Read the requirements or add your own.')}
          </p>
        )}

        <details className="rounded-md border border-line p-3 text-sm">
          <summary className="cursor-pointer font-medium text-ink-2">{t('More details')}</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label={t('Department')}>
              <input
                className={input}
                disabled={locked}
                maxLength={120}
                value={form.department}
                onChange={(e) => set('department', e.target.value)}
              />
            </Field>
            <Field label={t('Location')}>
              <input
                className={input}
                disabled={locked}
                maxLength={120}
                value={form.location}
                onChange={(e) => set('location', e.target.value)}
              />
            </Field>
            <Field label={t('Open positions')}>
              <input
                className={input}
                type="number"
                min={1}
                max={1000}
                disabled={locked}
                value={form.openings}
                onChange={(e) => set('openings', e.target.value)}
              />
            </Field>
            <Field label={t('Closing date')}>
              <input
                className={input}
                type="date"
                disabled={locked}
                value={form.closingDate}
                onChange={(e) => set('closingDate', e.target.value)}
              />
            </Field>
            <Field label={t('Hiring manager')}>
              <input
                className={input}
                disabled={locked}
                maxLength={120}
                value={form.hiringManager}
                onChange={(e) => set('hiringManager', e.target.value)}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label={t('Notes')}>
                <textarea
                  className={`${input} h-20`}
                  disabled={locked}
                  maxLength={4000}
                  value={form.notes}
                  onChange={(e) => set('notes', e.target.value)}
                />
              </Field>
            </div>
          </div>
        </details>

        {!locked && (
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className={btnPrimary} disabled={busy !== ''}>
              {busy === 'save' ? t('Saving…') : vacancy ? t('Save') : t('Create vacancy')}
            </button>
            {dirty && vacancy && (
              <span className="text-sm text-warn-text">{t('Unsaved changes')}</span>
            )}
            {info && (
              <span role="status" className="text-sm text-ok-ink">
                {info}
              </span>
            )}
          </div>
        )}
      </form>
    </Card>
  );
}

/** Whether the saved skills are enough to start a run (at least one must-have or nice-to-have). */
export const skillCount = (v: VacancyView) =>
  v.requirements.filter((r) => r.classification === 'mandatory' || r.classification === 'preferred')
    .length;
