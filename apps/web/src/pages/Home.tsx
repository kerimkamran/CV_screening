import { useEffect, useRef, useState } from 'react';
import { api, type Criteria, type Requirement } from '../api';
import { go } from '../route';
import { filesFromDrop, isZip, startIntake } from '../intake';
import { Sky } from '../Sky';
import { btnPrimary, btnSecondary, Card, errMsg, Field, input, Notice } from '../ui';
import { NOTICE_TEXT } from './Vacancy';

/**
 * Home (design spec 6.1): add resumes on one side, describe the role on the other, then "Find the
 * best fit". It runs on the existing vacancy back end: reading the requirements creates the vacancy
 * and a draft criteria set; the button freezes it, records the candidate notice and uploads the CVs.
 */

const EXPERIENCE = [
  ['any', 'Any'],
  ['1-3', '1–3 yrs'],
  ['3-5', '3–5 yrs'],
  ['5+', '5+ yrs'],
] as const;
type Experience = (typeof EXPERIENCE)[number][0];
const EXPERIENCE_LINE: Record<Experience, string> = {
  any: '',
  '1-3': 'Experience: 1 to 3 years',
  '3-5': 'Experience: 3 to 5 years',
  '5+': 'Experience: 5 or more years',
};

const DRAFT_KEY = 'cv-home-draft';
const COLLAPSE_ABOVE = 8;
const MIN_TEXT = 50;

interface Draft {
  title: string;
  text: string;
  experience: Experience;
}
function loadDraft(): Draft {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}') as Partial<Draft>;
    return {
      title: typeof d.title === 'string' ? d.title : '',
      text: typeof d.text === 'string' ? d.text : '',
      experience: EXPERIENCE.some(([k]) => k === d.experience)
        ? (d.experience as Experience)
        : 'any',
    };
  } catch {
    return { title: '', text: '', experience: 'any' };
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
const okFile = (f: File) => /\.(pdf|docx|txt|zip)$/i.test(f.name);
/** Operating-system litter inside a dropped folder: never worth a line. */
const litter = (f: File) => /^(\.|~\$|Thumbs\.db$|desktop\.ini$)/i.test(f.name);
const label = (f: File) =>
  (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
const fileKey = (f: File) => `${label(f)}:${f.size}`;

export function Home() {
  const [draft] = useState(loadDraft);
  const [files, setFiles] = useState<File[]>([]);
  const [skipped, setSkipped] = useState<{ name: string; reason: string }[]>([]);
  const [showList, setShowList] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState('');
  const [linkRead, setLinkRead] = useState('');
  const [linkProblem, setLinkProblem] = useState('');
  const [title, setTitle] = useState(draft.title);
  const [experience, setExperience] = useState<Experience>(draft.experience);
  const [text, setText] = useState(draft.text);
  const [wordFile, setWordFile] = useState('');
  const [wordProblem, setWordProblem] = useState('');
  const [vacancyId, setVacancyId] = useState('');
  const [reqs, setReqs] = useState<Requirement[]>([]);
  const [manual, setManual] = useState<Set<string>>(new Set());
  const [readText, setReadText] = useState(''); // the text the chips were read from
  const [newSkill, setNewSkill] = useState('');
  const [notice, setNotice] = useState(false);
  const [busy, setBusy] = useState<'' | 'read' | 'word' | 'link' | 'run'>('');
  const [error, setError] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const wordRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ title, text, experience }));
    } catch {
      /* the draft is a convenience only */
    }
  }, [title, text, experience]);

  // ---------------------------------------------------------------- resumes
  function addFiles(list: File[]) {
    const skip: { name: string; reason: string }[] = [];
    const good: File[] = [];
    for (const f of list) {
      if (litter(f)) continue;
      if (okFile(f)) good.push(f);
      else skip.push({ name: label(f), reason: 'only PDF, DOCX and TXT files can be read.' });
    }
    setFiles((cur) => {
      const have = new Set(cur.map(fileKey));
      const fresh = good.filter((f) => {
        const dup = have.has(fileKey(f));
        have.add(fileKey(f));
        if (dup) skip.push({ name: label(f), reason: 'added twice.' });
        return !dup;
      });
      return [...cur, ...fresh];
    });
    setSkipped(skip);
    setShowSkipped(false);
  }

  // ---------------------------------------------------------------- role
  const chips = reqs.filter(
    (r) => r.classification === 'mandatory' || r.classification === 'preferred',
  );
  const others = reqs.filter(
    (r) => r.classification !== 'mandatory' && r.classification !== 'preferred',
  );
  const hasRead = readText !== '';
  const textChanged = hasRead && readText !== text;

  const roleText = () => [text.trim(), EXPERIENCE_LINE[experience]].filter(Boolean).join('\n\n');

  async function attachWord(file: File | undefined) {
    if (!file) return;
    setWordProblem('');
    setBusy('word');
    try {
      const r = await api.upload<{ filename: string; text: string; words: number }>(
        '/vacancies/read-document',
        [file],
      );
      setWordFile(`${r.filename} · ${plural(r.words, 'word', 'words')}`);
      setText((t) => (t.trim() ? `${t.trim()}\n\n${r.text}` : r.text));
    } catch (e) {
      setWordProblem(errMsg(e));
    } finally {
      setBusy('');
      if (wordRef.current) wordRef.current.value = '';
    }
  }

  async function readLink() {
    if (!link.trim()) return;
    setLinkProblem('');
    setBusy('link');
    try {
      const r = await api.post<{ host: string; text: string; words: number; truncated: boolean }>(
        '/vacancies/read-link',
        { url: link.trim() },
      );
      setLinkRead(`${r.host} · ${plural(r.words, 'word', 'words')}`);
      setText((t) => (t.trim() ? `${t.trim()}\n\n${r.text}` : r.text));
      setLinkOpen(false);
      setLink('');
    } catch (e) {
      setLinkProblem(errMsg(e));
    } finally {
      setBusy('');
    }
  }

  async function readRequirements() {
    setShowErrors(true);
    setError('');
    if (title.trim().length < 3 || text.trim().length < MIN_TEXT) return;
    setBusy('read');
    try {
      let id = vacancyId;
      if (!id) {
        id = (
          await api.post<{ id: string }>('/vacancies', {
            title: title.trim(),
            jdText: roleText(),
          })
        ).id;
        setVacancyId(id);
      } else {
        await api.put(`/vacancies/${id}/jd`, { jdText: roleText() });
      }
      const c = await api.post<Criteria>(`/vacancies/${id}/criteria/extract`);
      const found = c.current?.requirements ?? [];
      // Chips the recruiter added by hand are never overwritten: keep them, add what is new.
      const kept = reqs.filter((r) => manual.has(r.text.toLowerCase()));
      const have = new Set(kept.map((r) => r.text.toLowerCase()));
      setReqs([...found.filter((r) => !have.has(r.text.toLowerCase())), ...kept]);
      setReadText(text);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy('');
    }
  }

  const flip = (i: number) =>
    setReqs((rs) =>
      rs.map((r, j) => {
        if (j !== i) return r;
        const must = r.classification === 'mandatory';
        return { ...r, classification: must ? 'preferred' : 'mandatory', weight: must ? 5 : 10 };
      }),
    );
  const drop = (i: number) => setReqs((rs) => rs.filter((_, j) => j !== i));
  function addSkill() {
    const t = newSkill.trim();
    if (t.length < 3) return;
    if (!reqs.some((r) => r.text.toLowerCase() === t.toLowerCase())) {
      setReqs((rs) => [...rs, { text: t, classification: 'mandatory', weight: 10, rule: null }]);
      setManual((m) => new Set(m).add(t.toLowerCase()));
    }
    setNewSkill('');
  }

  // ---------------------------------------------------------------- run
  const roleOk = title.trim().length >= 3;
  const ready = files.length > 0 && chips.length > 0 && notice && roleOk && busy === '';

  async function findBestFit() {
    setShowErrors(true);
    if (!ready || !vacancyId) return;
    setBusy('run');
    setError('');
    try {
      await api.put(`/vacancies/${vacancyId}/criteria`, {
        requirements: reqs.map((r) => ({
          text: r.text,
          classification: r.classification,
          weight: r.weight,
          rule: r.rule,
          confidence: r.confidence ?? null,
        })),
      });
      await api.post(`/vacancies/${vacancyId}/criteria/freeze`);
      await api.post(`/vacancies/${vacancyId}/notice-confirm`);
      // The first group goes up now; the rest keeps going while the results are open.
      await startIntake(vacancyId, files);
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
      go(`/vacancies/${vacancyId}`);
    } catch (e) {
      setError(errMsg(e));
      setBusy('');
    }
  }

  const skillCount = chips.length;
  const needs: string[] = [];
  if (!files.length) needs.push('Add at least one resume.');
  if (!roleOk) needs.push('Add the position title.');
  else if (!hasRead) needs.push('Describe the role, then choose "Read requirements".');
  else if (!chips.length) needs.push('Add at least one skill.');
  if (!notice) needs.push('Confirm the candidate notice.');

  return (
    <div className="space-y-6">
      <Sky>
        <h1 className="text-2xl font-bold tracking-tight">Who fits this role?</h1>
        <p className="mt-1 text-[#B9C8F2]">Add resumes, then describe the role.</p>
      </Sky>

      {error && <Notice kind="error">{error}</Notice>}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card title="Resumes">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void filesFromDrop(e.dataTransfer).then(addFiles);
            }}
            className={`flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center ${dragging ? 'border-accent bg-sel' : 'border-edge'}`}
          >
            <p className="font-medium">Drop resumes here</p>
            <p className="text-sm text-ink-3">
              PDF, DOCX or TXT files, a whole folder, or a ZIP of resumes
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <button
                type="button"
                className={btnSecondary}
                onClick={() => fileRef.current?.click()}
              >
                Choose files
              </button>
              <button
                type="button"
                className={btnSecondary}
                onClick={() => folderRef.current?.click()}
              >
                Choose a folder
              </button>
            </div>
            <input
              ref={folderRef}
              type="file"
              multiple
              // @ts-expect-error webkitdirectory is not in the DOM typings
              webkitdirectory=""
              aria-label="Choose a folder of resumes"
              className="sr-only"
              onChange={(e) => {
                addFiles(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".pdf,.docx,.txt,.zip"
              aria-label="Choose resume files"
              className="sr-only"
              onChange={(e) => {
                addFiles(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
          </div>
          {skipped.length > 0 && skipped.length <= 3 && (
            <p role="alert" className="mt-2 text-sm text-warn-text">
              {skipped.map((x) => `${x.name}: ${x.reason}`).join(' ')}
            </p>
          )}
          {skipped.length > 3 && (
            <div className="mt-2 text-sm text-warn-text" role="status">
              {skipped.length} skipped,{' '}
              <button
                type="button"
                className="underline"
                aria-expanded={showSkipped}
                onClick={() => setShowSkipped((v) => !v)}
              >
                {showSkipped ? 'hide which' : 'see which'}
              </button>
              {showSkipped && (
                <ul className="mt-1 max-h-40 list-disc overflow-auto pl-5">
                  {skipped.map((x, i) => (
                    <li key={i}>
                      {x.name}: {x.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {files.length > 0 ? (
            <div className="mt-3">
              <p className="text-sm font-medium" role="status">
                {plural(files.length, 'resume', 'resumes')} added
                {files.some(isZip) && ' (a ZIP is unpacked when you start)'}
                {files.length > COLLAPSE_ABOVE && (
                  <>
                    {' · '}
                    <button
                      type="button"
                      className="font-normal text-link underline"
                      aria-expanded={showList}
                      onClick={() => setShowList((v) => !v)}
                    >
                      {showList ? 'Hide the list' : 'Show the list'}
                    </button>
                  </>
                )}
              </p>
              {(files.length <= COLLAPSE_ABOVE || showList) && (
                <ul className="mt-1 max-h-56 divide-y divide-line overflow-auto text-sm">
                  {files.map((f, i) => (
                    <li key={fileKey(f)} className="flex items-center justify-between gap-2 py-1">
                      <span className="truncate">{label(f)}</span>
                      <button
                        type="button"
                        className="shrink-0 text-link hover:underline"
                        aria-label={`Remove ${label(f)}`}
                        onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            showErrors && <p className="mt-2 text-sm text-err-ink">Add at least one resume.</p>
          )}
        </Card>

        <Card title="The role">
          <div className="space-y-4">
            <Field label="Position">
              <input
                className={input}
                placeholder="e.g. Network Engineer"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              {showErrors && !roleOk && (
                <span className="mt-1 block text-sm text-err-ink">Add the position title.</span>
              )}
            </Field>

            <div role="group" aria-label="Experience" className="text-sm">
              <span className="mb-1 block font-medium text-ink-2">Experience</span>
              <div className="flex flex-wrap gap-2">
                {EXPERIENCE.map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={experience === k}
                    onClick={() => setExperience(k)}
                    className={`rounded-full border px-3 py-1 ${experience === k ? 'border-accent bg-accent text-on-accent' : 'border-edge bg-card text-ink'} focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <Field
              label="Requirements"
              hint="Paste the vacancy or type what you need. Azerbaijani, English or both."
            >
              <textarea
                className={`${input} h-40`}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              {showErrors && text.trim().length < MIN_TEXT && (
                <span className="mt-1 block text-sm text-err-ink">
                  Write or paste at least a few lines about the role.
                </span>
              )}
            </Field>

            <div className="flex flex-wrap items-center gap-3 text-sm">
              <button
                type="button"
                className="text-link hover:underline"
                disabled={busy !== ''}
                onClick={() => wordRef.current?.click()}
              >
                {busy === 'word' ? 'Reading the file…' : 'Attach a Word file'}
              </button>
              <input
                ref={wordRef}
                type="file"
                accept=".docx"
                aria-label="Attach a Word file"
                className="sr-only"
                onChange={(e) => void attachWord(e.target.files?.[0])}
              />
              {wordFile && <span className="text-ink-3">Read {wordFile}</span>}
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
                Add a vacancy link
              </button>
              {linkRead && <span className="text-ink-3">Read from {linkRead}</span>}
            </div>
            {linkOpen && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Field
                    label="Vacancy link"
                    hint="A public page. If it cannot be read, paste the text."
                  >
                    <input
                      className={input}
                      type="url"
                      inputMode="url"
                      placeholder="https://example.com/jobs/network-engineer"
                      value={link}
                      onChange={(e) => setLink(e.target.value)}
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
                  disabled={busy !== '' || !link.trim()}
                  onClick={() => void readLink()}
                >
                  {busy === 'link' ? 'Reading the page…' : 'Read the page'}
                </button>
              </div>
            )}
            {linkProblem && (
              <p role="alert" className="text-sm text-err-ink">
                {linkProblem}
              </p>
            )}
            {wordProblem && (
              <p role="alert" className="text-sm text-err-ink">
                {wordProblem}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className={btnSecondary}
                disabled={busy !== ''}
                onClick={() => void readRequirements()}
              >
                {busy === 'read'
                  ? 'Reading…'
                  : hasRead
                    ? 'Read requirements again'
                    : 'Read requirements'}
              </button>
              {text.trim() && (
                <span className="text-sm text-ink-3">{plural(words(text), 'word', 'words')}</span>
              )}
              {textChanged && (
                <span className="text-sm text-warn-text">The text changed since it was read.</span>
              )}
            </div>

            {hasRead && (
              <div aria-label="Skills" role="group" className="space-y-2">
                <p className="text-sm font-medium text-ink-2">Skills the AI understood</p>
                <ul className="flex flex-wrap gap-2">
                  {chips.map((r) => {
                    const i = reqs.indexOf(r);
                    const must = r.classification === 'mandatory';
                    return (
                      <li key={`${r.text}:${i}`} className="inline-flex items-center">
                        <button
                          type="button"
                          onClick={() => flip(i)}
                          aria-label={`${r.text}, ${must ? 'must-have. Press to change to nice-to-have' : 'nice-to-have. Press to change to must-have'}`}
                          className={`inline-flex items-center gap-1.5 rounded-l-full border px-3 py-1 text-sm focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none ${must ? 'border-accent bg-accent text-on-accent' : 'border-edge bg-card text-ink'}`}
                        >
                          <span aria-hidden="true">{must ? '●' : '○'}</span>
                          {r.text}
                        </button>
                        <button
                          type="button"
                          onClick={() => drop(i)}
                          aria-label={`Remove ${r.text}`}
                          className="rounded-r-full border border-l-0 border-edge bg-card px-2 py-1 text-sm text-ink-2 hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
                        >
                          ×
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <div className="flex gap-2">
                  <input
                    className={input}
                    aria-label="Add another skill"
                    placeholder="Add another skill"
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
                    Add
                  </button>
                </div>
                <p className="text-sm text-ink-3">
                  Press a skill to switch between must-have (●) and nice-to-have (○). A missing
                  must-have lowers the match. It never hides anyone.
                </p>
                {showErrors && chips.length === 0 && (
                  <p className="text-sm text-err-ink">Add at least one skill.</p>
                )}
                {others.length > 0 && (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-ink-2">
                      {plural(others.length, 'other requirement', 'other requirements')} kept as
                      text
                    </summary>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-ink-2">
                      {others.map((r, i) => (
                        <li key={i}>
                          {r.text}
                          {r.classification === 'disqualifier' &&
                            ' (a knockout rule: a match sends the resume to human review, nobody is rejected automatically)'}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </div>
        </Card>
      </div>

      <Card title="Before you start: candidate notice">
        <p className="mb-2 text-sm text-ink-2">
          Candidates must be told that AI assists the screening of their application. Share this
          text, for example in the job advert, then confirm below.
        </p>
        <blockquote className="mb-3 rounded border-l-4 border-accent bg-sel p-3 text-sm text-ink">
          {NOTICE_TEXT}
        </blockquote>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={notice}
            onChange={(e) => setNotice(e.target.checked)}
          />
          <span>
            I confirm that the candidates for this vacancy have been informed that AI is used to
            assist the screening of their applications, and how to request human review.
          </span>
        </label>
      </Card>

      <div className="flex flex-col items-start gap-2">
        <button
          type="button"
          className={`${btnPrimary} h-12 px-6 text-base`}
          disabled={busy !== ''}
          aria-disabled={!ready}
          onClick={() => void findBestFit()}
        >
          {busy === 'run' ? 'Starting…' : 'Find the best fit →'}
        </button>
        <p className="text-sm text-ink-3">
          {plural(files.length, 'resume', 'resumes')} ·{' '}
          {plural(skillCount, 'key skill', 'key skills')} · Resumes are read by the AI provider your
          administrator has chosen.
        </p>
        {showErrors && !ready && busy === '' && needs.length > 0 && (
          <ul className="text-sm text-err-ink" role="status">
            {needs.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
