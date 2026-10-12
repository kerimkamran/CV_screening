import { useRef, useState } from 'react';
import { api } from '../api';
import { useT, tr } from '../i18n';
import { filesFromDrop, isZip, startIntake, useIntake } from '../intake';
import { type VacancyView } from '../pool';
import { btnPrimary, btnSecondary, Card, errMsg, Notice } from '../ui';
import { NOTICE_TEXT } from './Vacancy';
import { skillCount } from './RoleCard';

/**
 * The Resumes card (Development Plan, Phase 1 and 2): add resumes to this vacancy and run the
 * analysis. It opens up once the role is saved with at least one skill. "Find the best fit" the
 * first time, "Re-analyze" when the requirements changed or more resumes were added.
 */

const COLLAPSE_ABOVE = 8;
const plural = (n: number, one: string, many: string) => tr(n === 1 ? one : many, { n });
const okFile = (f: File) => /\.(pdf|docx|txt|zip)$/i.test(f.name);
/** Operating-system litter inside a dropped folder: never worth a line. */
const litter = (f: File) => /^(\.|~\$|Thumbs\.db$|desktop\.ini$)/i.test(f.name);
const label = (f: File) =>
  (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
const fileKey = (f: File) => `${label(f)}:${f.size}`;

export function ResumesCard({
  vacancy,
  roleDirty,
  onStarted,
}: {
  vacancy: VacancyView;
  /** The Role card has changes that are not saved yet. */
  roleDirty: boolean;
  onStarted: () => void;
}) {
  const t = useT();
  const [files, setFiles] = useState<File[]>([]);
  const [skipped, setSkipped] = useState<{ name: string; reason: string }[]>([]);
  const [showList, setShowList] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const intake = useIntake(vacancy.id);

  const c = vacancy.counts;
  const skills = skillCount(vacancy);
  const confirmed = !!vacancy.candidateNoticeConfirmedAt;
  const everRan = c.analyzed > 0 || c.running > 0 || vacancy.hasFrozen;
  const locked = !vacancy.canEdit || vacancy.archived;
  const noticeOk = confirmed || notice;
  const newWork =
    files.length > 0 || c.outOfDate > 0 || c.needsLook > 0 || c.stopped > 0 || !everRan;
  const hasResumes = files.length > 0 || c.documents > 0;
  const ready = skills > 0 && !roleDirty && noticeOk && newWork && hasResumes && !busy && !locked;

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

  async function run() {
    if (!ready) return;
    setBusy(true);
    setError('');
    setDone('');
    try {
      // Freeze the requirements and open the vacancy first, so uploaded resumes are analyzed at once.
      const r = await api.post<{ queued: number }>(`/vacancies/${vacancy.id}/start`, {
        confirmNotice: noticeOk,
      });
      if (files.length) {
        await startIntake(vacancy.id, files);
        setFiles([]);
      }
      setDone(
        files.length
          ? t('Started. The resumes are being read.')
          : r.queued > 0
            ? plural(r.queued, '{n} resume queued.', '{n} resumes queued.')
            : t('Nothing new to analyze.'),
      );
      onStarted();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const needs: string[] = [];
  if (roleDirty) needs.push(t('Save the role first.'));
  else if (skills === 0) needs.push(t('Add at least one skill on the role card.'));
  if (!hasResumes) needs.push(t('Add at least one resume.'));
  if (!noticeOk) needs.push(t('Confirm the candidate notice.'));

  const button = everRan ? t('Re-analyze') : t('Find the best fit →');
  return (
    <Card title={t('Resumes')}>
      <div className="space-y-3">
        {error && <Notice kind="error">{error}</Notice>}
        {done && <Notice kind="ok">{done}</Notice>}
        <p className="text-sm text-ink-2" role="status">
          {c.documents === 0
            ? t('No resumes in this vacancy yet.')
            : [
                plural(c.documents, '{n} resume', '{n} resumes'),
                t('{n} analyzed', { n: c.analyzed }),
                c.running > 0 ? t('{n} running', { n: c.running }) : '',
                c.outOfDate > 0 ? t('{n} out of date', { n: c.outOfDate }) : '',
                c.failed > 0 ? t('{n} could not be read', { n: c.failed }) : '',
              ]
                .filter(Boolean)
                .join(' · ')}
        </p>

        {!locked && (
          <>
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
              className={`flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center ${dragging ? 'border-accent bg-sel' : 'border-edge'}`}
            >
              <p className="font-medium">{t('Drop resumes here')}</p>
              <p className="text-sm text-ink-3">
                {t('PDF, DOCX or TXT files, a whole folder, or a ZIP of resumes')}
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  className={btnSecondary}
                  onClick={() => fileRef.current?.click()}
                >
                  {t('Choose files')}
                </button>
                <button
                  type="button"
                  className={btnSecondary}
                  onClick={() => folderRef.current?.click()}
                >
                  {t('Choose a folder')}
                </button>
              </div>
              <input
                ref={folderRef}
                type="file"
                multiple
                // @ts-expect-error webkitdirectory is not in the DOM typings
                webkitdirectory=""
                aria-label={t('Choose a folder of resumes')}
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
                aria-label={t('Choose resume files')}
                className="sr-only"
                onChange={(e) => {
                  addFiles(Array.from(e.target.files ?? []));
                  e.target.value = '';
                }}
              />
            </div>
            {skipped.length > 0 && skipped.length <= 3 && (
              <p role="alert" className="text-sm text-warn-text">
                {skipped.map((x) => `${x.name}: ${t(x.reason)}`).join(' ')}
              </p>
            )}
            {skipped.length > 3 && (
              <div className="text-sm text-warn-text" role="status">
                {t('{n} skipped,', { n: skipped.length })}{' '}
                <button
                  type="button"
                  className="underline"
                  aria-expanded={showSkipped}
                  onClick={() => setShowSkipped((v) => !v)}
                >
                  {showSkipped ? t('hide which') : t('see which')}
                </button>
                {showSkipped && (
                  <ul className="mt-1 max-h-40 list-disc overflow-auto pl-5">
                    {skipped.map((x, i) => (
                      <li key={i}>
                        {x.name}: {t(x.reason)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {files.length > 0 && (
              <div>
                <p className="text-sm font-medium" role="status">
                  {plural(files.length, '{n} resume added', '{n} resumes added')}
                  {files.some(isZip) && ' ' + t('(a ZIP is unpacked when you start)')}
                  {files.length > COLLAPSE_ABOVE && (
                    <>
                      {' · '}
                      <button
                        type="button"
                        className="font-normal text-link underline"
                        aria-expanded={showList}
                        onClick={() => setShowList((v) => !v)}
                      >
                        {showList ? t('Hide the list') : t('Show the list')}
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
                          aria-label={t('Remove {name}', { name: label(f) })}
                          onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}
                        >
                          {t('Remove')}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {!confirmed && (
              <div className="rounded-md border border-line p-3">
                <p className="mb-2 text-sm text-ink-2">
                  {t(
                    'Candidates must be told that AI assists the screening of their application. Share this text, for example in the job advert, then confirm below.',
                  )}
                </p>
                <blockquote className="mb-3 rounded border-l-4 border-accent bg-sel p-3 text-sm text-ink">
                  {t(NOTICE_TEXT)}
                </blockquote>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={notice}
                    onChange={(e) => setNotice(e.target.checked)}
                  />
                  <span>
                    {t(
                      'I confirm that the candidates for this vacancy have been informed that AI is used to assist the screening of their applications, and how to request human review.',
                    )}
                  </span>
                </label>
              </div>
            )}

            <div className="flex flex-col items-start gap-2">
              <button
                type="button"
                className={`${btnPrimary} h-11 px-5`}
                disabled={busy}
                aria-disabled={!ready}
                onClick={() => void run()}
              >
                {busy ? t('Starting…') : button}
              </button>
              {!ready && !busy && newWork && needs.length > 0 && (
                <ul className="text-sm text-err-ink" role="status">
                  {needs.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
              {!newWork && !busy && (
                <p className="text-sm text-ink-3">
                  {t('Everything is analyzed against the current requirements.')}
                </p>
              )}
              <p className="text-xs text-ink-3">
                {t('Resumes are read by the AI provider your administrator has chosen.')}
              </p>
            </div>
          </>
        )}

        {intake && intake.sent < intake.total && (
          <Notice kind="info">
            <span role="status">
              {t(
                'Sending {sent} of {total} files. You can start looking now: the rest appear here as they are read.',
                {
                  sent: intake.sent,
                  total: intake.total,
                },
              )}
            </span>
          </Notice>
        )}
        {intake?.error && <Notice kind="error">{intake.error}</Notice>}
      </div>
    </Card>
  );
}
