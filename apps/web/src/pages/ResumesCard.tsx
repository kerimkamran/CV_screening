import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { UPLOAD_CODE_MESSAGE } from '@cv/shared';
import { api } from '../api';
import { useT, tr } from '../i18n';
import { useAssistantConfig } from '../assistant';
import { trackBatch, prepareSignals } from '../done-signals';
import {
  checkFiles,
  DEFAULT_LIMITS,
  fetchIntakeInfo,
  filesFromDrop,
  folderPickingSupported,
  FOLDER_LIMIT,
  RECOMMENDED_PER_UPLOAD,
  startBatch,
  summarize,
  useRun,
  type Checked,
  type IntakeInfo,
} from '../intake';
import { type VacancyView } from '../pool';
import { btnPrimary, btnSecondary, Card, errMsg, Notice } from '../ui';
import { NOTICE_TEXT } from './Vacancy';
import { skillCount } from './RoleCard';

/**
 * The CVs card (Stage 2, S2-FE7): add CVs to this vacancy and run the analysis. Every file is checked
 * before anything is sent (wrong type, empty, too big, old Word format), the person sees how many
 * CVs the vacancy already holds, and a long list is summarised instead of printed.
 * "Find the best fit" the first time, "Re-analyze" when the requirements changed or CVs were added.
 */

const COLLAPSE_ABOVE = 8;
const plural = (n: number, one: string, many: string) => tr(n === 1 ? one : many, { n });
const mb = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function problemText(p: NonNullable<Checked['problem']>): string {
  return tr(UPLOAD_CODE_MESSAGE[p.code], { n: p.n ?? 0 });
}

export function ResumesCard({
  vacancy,
  roleDirty,
  onStarted,
  user,
}: {
  vacancy: VacancyView;
  /** The Role card has changes that are not saved yet. */
  roleDirty: boolean;
  onStarted: () => void;
  /** Who is signed in (for the "ready" signals). */
  user: { id: string };
}) {
  const t = useT();
  const [rows, setRows] = useState<Checked[]>([]);
  const [ignored, setIgnored] = useState(0);
  const [repeated, setRepeated] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [showList, setShowList] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [info, setInfo] = useState<IntakeInfo | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const run = useRun(vacancy.id);
  const assistant = useAssistantConfig()?.name ?? 'parallax';
  const folders = useMemo(() => folderPickingSupported(), []);

  const refreshInfo = useCallback(() => {
    fetchIntakeInfo(vacancy.id).then(setInfo, () => undefined);
  }, [vacancy.id]);
  useEffect(refreshInfo, [refreshInfo, run?.batchId, vacancy.counts.documents]);

  const limits = info ? { maxFileMb: info.maxFileMb, maxZipMb: info.maxZipMb } : DEFAULT_LIMITS;
  const c = vacancy.counts;
  const skills = skillCount(vacancy);
  const confirmed = !!vacancy.candidateNoticeConfirmedAt;
  const everRan = c.analyzed > 0 || c.running > 0 || vacancy.hasFrozen;
  const locked = !vacancy.canEdit || vacancy.archived;
  const noticeOk = confirmed || notice;
  const sum = summarize(rows);
  const room = info ? Math.max(info.limit - info.used, 0) : Infinity;
  const newWork = sum.ready > 0 || c.outOfDate > 0 || c.needsLook > 0 || c.stopped > 0 || !everRan;
  const hasResumes = sum.ready > 0 || c.documents > 0;
  const ready = skills > 0 && !roleDirty && noticeOk && newWork && hasResumes && !busy && !locked;

  function addFiles(list: File[], wasTruncated = false) {
    const have = new Set(rows.map((r) => r.key));
    const r = checkFiles(list, limits, have);
    setRows((cur) => [...cur, ...r.added]);
    setIgnored(r.ignored);
    setRepeated(r.repeated);
    setTruncated(wasTruncated);
  }

  async function begin() {
    if (!ready) return;
    // Synchronous, inside the click: the browser only allows these while the click is fresh.
    prepareSignals(user.id);
    setBusy(true);
    setError('');
    setDone('');
    try {
      // Freeze the requirements and open the vacancy first, so uploaded CVs are analyzed at once.
      const r = await api.post<{ queued: number }>(`/vacancies/${vacancy.id}/start`, {
        confirmNotice: noticeOk,
      });
      if (sum.ready > 0) {
        const batchId = await startBatch(vacancy.id, rows);
        trackBatch({
          vacancyId: vacancy.id,
          batchId,
          userId: user.id,
          assistant,
        });
        setRows([]);
        setIgnored(0);
        setRepeated(0);
        setDone(t('Started. The CVs are being read.'));
      } else {
        setDone(
          r.queued > 0
            ? plural(r.queued, '{n} CV queued.', '{n} CVs queued.')
            : t('Nothing new to analyze.'),
        );
      }
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
  if (!hasResumes) needs.push(t('Add at least one CV.'));
  if (!noticeOk) needs.push(t('Confirm the candidate notice.'));

  const button = everRan ? t('Re-analyze') : t('Find the best fit →');
  const problems = rows.filter((r) => r.problem);
  const readyRows = rows.filter((r) => !r.problem);
  const overRoom = Math.max(readyRows.length - room, 0);
  const shownRows = showList ? rows : rows.filter((r) => r.problem);
  const sending = !!run && run.items.some((i) => i.client === 'waiting' || i.client === 'sending');
  return (
    <Card title={t('CVs')}>
      <div className="space-y-3">
        {error && <Notice kind="error">{error}</Notice>}
        {done && <Notice kind="ok">{done}</Notice>}
        <p className="text-sm text-ink-2" role="status">
          {info
            ? t('{used} of {limit} CVs used in this vacancy', {
                used: info.used,
                limit: info.limit,
              })
            : c.documents === 0
              ? t('No CVs in this vacancy yet.')
              : plural(c.documents, '{n} CV', '{n} CVs')}
          {c.documents > 0 && (
            <>
              {' · '}
              {[
                t('{n} analyzed', { n: c.analyzed }),
                c.running > 0 ? t('{n} running', { n: c.running }) : '',
                c.outOfDate > 0 ? t('{n} out of date', { n: c.outOfDate }) : '',
                c.failed > 0 ? t('{n} could not be read', { n: c.failed }) : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </>
          )}
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
                void filesFromDrop(e.dataTransfer).then((r) => addFiles(r.files, r.truncated));
              }}
              className={`flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-4 py-6 text-center ${dragging ? 'border-accent bg-sel' : 'border-edge'}`}
            >
              <p className="font-medium">{t('Drop CVs here')}</p>
              <p className="text-sm text-ink-3">
                {folders
                  ? t('PDF, DOCX or TXT files, a whole folder, or a ZIP of CVs')
                  : t('PDF, DOCX or TXT files, or a ZIP of CVs')}
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  className={btnSecondary}
                  onClick={() => fileRef.current?.click()}
                >
                  {t('Choose files')}
                </button>
                {folders && (
                  <button
                    type="button"
                    className={btnSecondary}
                    onClick={() => folderRef.current?.click()}
                  >
                    {t('Choose a folder')}
                  </button>
                )}
                <button
                  type="button"
                  className={btnSecondary}
                  onClick={() => zipRef.current?.click()}
                >
                  {t('Add a ZIP')}
                </button>
              </div>
              <input
                ref={folderRef}
                type="file"
                multiple
                // @ts-expect-error webkitdirectory is not in the DOM typings
                webkitdirectory=""
                aria-label={t('Choose a folder of CVs')}
                className="sr-only"
                onChange={(e) => {
                  const list = Array.from(e.target.files ?? []);
                  addFiles(list.slice(0, FOLDER_LIMIT.files), list.length > FOLDER_LIMIT.files);
                  e.target.value = '';
                }}
              />
              <input
                ref={fileRef}
                type="file"
                multiple
                accept=".pdf,.docx,.txt,.md,.doc"
                aria-label={t('Choose CV files')}
                className="sr-only"
                onChange={(e) => {
                  addFiles(Array.from(e.target.files ?? []));
                  e.target.value = '';
                }}
              />
              <input
                ref={zipRef}
                type="file"
                accept=".zip"
                aria-label={t('Choose a ZIP of CVs')}
                className="sr-only"
                onChange={(e) => {
                  addFiles(Array.from(e.target.files ?? []));
                  e.target.value = '';
                }}
              />
            </div>

            {truncated && (
              <Notice kind="warn">
                {t(
                  'The folder is very large, so only the first {n} files were read. Choose a smaller folder for the rest.',
                  { n: FOLDER_LIMIT.files },
                )}
              </Notice>
            )}
            {(ignored > 0 || repeated > 0) && (
              <p className="text-xs text-ink-3" role="status">
                {[
                  ignored > 0
                    ? plural(ignored, '{n} system file left out.', '{n} system files left out.')
                    : '',
                  repeated > 0
                    ? plural(repeated, '{n} repeat left out.', '{n} repeats left out.')
                    : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              </p>
            )}

            {rows.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium" role="status" data-testid="check-summary">
                  {[
                    plural(sum.files, '{n} file', '{n} files'),
                    mb(sum.bytes),
                    t('{n} ready', { n: sum.ready }),
                    sum.problems > 0 ? t('{n} need attention', { n: sum.problems }) : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {sum.ready > RECOMMENDED_PER_UPLOAD && (
                  <Notice kind="warn">
                    {t(
                      'You chose {n} CVs. Up to {rec} per upload is recommended so results arrive sooner. You can still send all of them.',
                      { n: sum.ready, rec: RECOMMENDED_PER_UPLOAD },
                    )}
                  </Notice>
                )}
                {overRoom > 0 && (
                  <Notice kind="warn">
                    {t('Only {room} more CVs fit in this vacancy. The last {n} will not be sent.', {
                      room,
                      n: overRoom,
                    })}
                  </Notice>
                )}
                {shownRows.length > 0 && (
                  <ul className="max-h-64 divide-y divide-line overflow-auto text-sm">
                    {shownRows.map((r) => {
                      const idx = readyRows.indexOf(r);
                      const full = !r.problem && idx >= room;
                      return (
                        <li key={r.key} className="flex items-center justify-between gap-2 py-1.5">
                          <span className="min-w-0">
                            <span className="block truncate">{r.path}</span>
                            <span
                              className={`block text-xs ${r.problem || full ? 'text-err-ink' : 'text-ink-3'}`}
                            >
                              {mb(r.size)}
                              {r.problem && ` · ${problemText(r.problem)}`}
                              {full && ` · ${t('Vacancy full')}`}
                            </span>
                          </span>
                          <button
                            type="button"
                            className="shrink-0 text-link hover:underline"
                            aria-label={t('Remove {name}', { name: r.path })}
                            onClick={() => setRows((cur) => cur.filter((x) => x.key !== r.key))}
                          >
                            {t('Remove')}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {readyRows.length > 0 && (rows.length > COLLAPSE_ABOVE || problems.length > 0) && (
                  <button
                    type="button"
                    className="text-sm text-link underline"
                    aria-expanded={showList}
                    onClick={() => setShowList((v) => !v)}
                  >
                    {showList
                      ? t('Show only the files that need attention')
                      : t('Show all {n} files', { n: rows.length })}
                  </button>
                )}
                {rows.length <= COLLAPSE_ABOVE && problems.length === 0 && (
                  <ul className="max-h-56 divide-y divide-line overflow-auto text-sm">
                    {rows.map((r) => (
                      <li key={r.key} className="flex items-center justify-between gap-2 py-1.5">
                        <span className="min-w-0">
                          <span className="block truncate">{r.path}</span>
                          <span className="block text-xs text-ink-3">{mb(r.size)}</span>
                        </span>
                        <button
                          type="button"
                          className="shrink-0 text-link hover:underline"
                          aria-label={t('Remove {name}', { name: r.path })}
                          onClick={() => setRows((cur) => cur.filter((x) => x.key !== r.key))}
                        >
                          {t('Remove')}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {problems.length > 0 && (
                  <button
                    type="button"
                    className="text-sm text-link underline"
                    onClick={() => setRows((cur) => cur.filter((r) => !r.problem))}
                  >
                    {t('Remove all files that need attention')}
                  </button>
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
                disabled={busy || sending}
                aria-disabled={!ready}
                onClick={() => void begin()}
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
                {t('CVs are read by the AI provider your administrator has chosen.')}
              </p>
              <p className="text-xs text-ink-3">
                {t(
                  'When you start, your browser may ask to show a notification when the CVs are ready.',
                )}
              </p>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
