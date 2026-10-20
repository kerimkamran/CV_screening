import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { tr, useT } from '../i18n';
import type { CvReviewData, ReportAnchor, ResumeData } from '../pool';
import { btnSecondary, errMsg, Notice } from '../ui';
import { CvText } from './CvText';
import type { PdfApi, PdfProblem } from './PdfPages';

// pdf.js is large: it loads the first time a PDF is opened, not with the app.
const PdfPages = lazy(() => import('./PdfPages'));

type Tab = 'original' | 'text';

const PROBLEM_TEXT: Record<PdfProblem, string> = {
  password: 'This PDF is password-protected, so its pages cannot be shown.',
  broken: 'This PDF could not be shown as pages.',
  missing: 'The original file is no longer available.',
  unavailable: 'The original cannot be shown as pages.',
};

/** The page a "Show in CV" should go to: the first anchor that knows its page. */
export function quotePage(anchors: ReportAnchor[]): number | null {
  for (const a of anchors) if (a.page && a.page > 0) return a.page;
  return null;
}

/**
 * The CV itself (Stage 2, S2-FE4): the original pages (PDF) and the text it was read as, with one
 * toggle. Each file type says plainly what it can show:
 *  - PDF: pages, and the text tab for the exact lines.
 *  - Word: the text, and a download of the original until its pages are available.
 *  - Plain text: the text only, there are no pages.
 *  - Erased: nothing, and it says so.
 */
export function CvPane({
  data,
  anchors,
  focus,
}: {
  data: CvReviewData;
  anchors: ReportAnchor[];
  /** Goes up by one each time "Show in CV" is pressed. */
  focus: number;
}) {
  const t = useT();
  const erased = data.status === 'erased';
  const canPages = !erased && data.original.view === 'pdf';
  const canText = !erased && data.text.available;
  const [tab, setTab] = useState<Tab>(canPages ? 'original' : 'text');
  const [text, setText] = useState<ResumeData | null>(null);
  const [textError, setTextError] = useState('');
  const [problem, setProblem] = useState<PdfProblem | null>(null);
  const [pages, setPages] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [full, setFull] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fileError, setFileError] = useState('');
  const pdf = useRef<PdfApi>(null);
  const openBtn = useRef<HTMLButtonElement | null>(null);

  // The text is fetched when it is first wanted; a change of CV remounts this pane (keyed by id).
  useEffect(() => {
    if (tab !== 'text' || text || textError || !canText) return;
    let dead = false;
    api.get<ResumeData>(`/documents/${data.documentId}/text`).then(
      (r) => !dead && setText(r),
      (e) => !dead && setTextError(e instanceof ApiError && e.status === 409 ? '' : errMsg(e)),
    );
    return () => {
      dead = true;
    };
  }, [tab, text, textError, canText, data.documentId]);

  // "Show in CV": go to the page of the first line when there are pages, else show the lines.
  const page = quotePage(anchors);
  useEffect(() => {
    if (!focus) return;
    if (canPages && !problem && page) {
      setTab('original');
      pdf.current?.goTo(page);
    } else if (canText) setTab('text');
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  // Full screen: Esc closes it, the page behind does not scroll, and focus goes back to the button.
  useEffect(() => {
    if (!full) return;
    const on = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFull(false);
    };
    window.addEventListener('keydown', on);
    const prev = document.body.style.overflow;
    const button = openBtn.current;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', on);
      document.body.style.overflow = prev;
      button?.focus();
    };
  }, [full]);

  const download = useCallback(async () => {
    setBusy(true);
    setFileError('');
    try {
      await api.download(`/documents/${data.documentId}/file`, data.filename);
    } catch (e) {
      setFileError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }, [data.documentId, data.filename]);

  const openInTab = useCallback(async () => {
    // The tab opens during the click, or a pop-up blocker would stop it.
    const w = window.open('', '_blank');
    setBusy(true);
    setFileError('');
    try {
      const blob = await api.blob(`/documents/${data.documentId}/view`);
      const url = URL.createObjectURL(blob);
      if (w) {
        w.opener = null;
        w.location.href = url;
      } else window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      w?.close();
      setFileError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }, [data.documentId]);

  const tabs: { id: Tab; label: string }[] = [];
  if (canPages) tabs.push({ id: 'original', label: tr('Original') });
  if (canText || !canPages) tabs.push({ id: 'text', label: tr('Text') });
  const showing: Tab = canPages && tab === 'original' ? 'original' : 'text';

  const body = (() => {
    if (erased)
      return (
        <Notice kind="info">{t('This CV was erased. Its file and its text are gone.')}</Notice>
      );
    if (showing === 'original') {
      if (problem)
        return (
          <div className="space-y-2">
            <Notice kind="warn">{t(PROBLEM_TEXT[problem])}</Notice>
            {canText && (
              <button type="button" className={btnSecondary} onClick={() => setTab('text')}>
                {t('Show the text instead')}
              </button>
            )}
          </div>
        );
      return (
        <Suspense
          fallback={
            <p role="status" className="p-4 text-sm text-ink-3">
              {t('Loading the pages…')}
            </p>
          }
        >
          <PdfPages
            documentId={data.documentId}
            zoom={zoom}
            ref={pdf}
            onPages={setPages}
            onProblem={setProblem}
          />
        </Suspense>
      );
    }
    // The text view, with the reason when it cannot be shown.
    return (
      <div className="space-y-2">
        {data.kind === 'docx' && (
          <Notice kind="info">
            {t(
              'The pages of this Word file are not available. The text below was read from the file; the original can be downloaded.',
            )}
          </Notice>
        )}
        {data.kind === 'txt' && (
          <p className="text-xs text-ink-3">
            {t('This is a plain text file, so it has no pages.')}
          </p>
        )}
        {textError && <Notice kind="error">{textError}</Notice>}
        {!canText && (
          <Notice kind="warn">
            {data.statusDetail.reason ?? t('No text could be read from this file.')}
          </Notice>
        )}
        {canText && !text && !textError && <p className="text-sm text-ink-3">{t('Loading…')}</p>}
        {text && <CvText data={text} anchors={anchors} focus={focus} tall={full} />}
        {canPages && !problem && (
          <p className="text-xs text-ink-3">
            {t('The lines found are marked here. The original pages are under Original.')}
          </p>
        )}
      </div>
    );
  })();

  return (
    <section
      aria-label={t('CV')}
      className={
        full
          ? 'fixed inset-0 z-50 flex flex-col gap-2 overflow-hidden bg-page p-3'
          : 'flex min-w-0 flex-col gap-2'
      }
      {...(full ? { role: 'dialog', 'aria-modal': true } : {})}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="min-w-0 truncate text-sm font-semibold text-ink-2">
          {t('CV')}
          <span className="ml-2 font-normal text-ink-3">{data.filename}</span>
          {pages > 0 && showing === 'original' && (
            <span className="ml-2 font-normal text-ink-3">{t('{n} pages', { n: pages })}</span>
          )}
        </h2>
        {!erased && (
          <div className="flex flex-wrap items-center gap-2">
            {showing === 'original' && !problem && (
              <span className="flex items-center gap-1" role="group" aria-label={t('Zoom')}>
                <button
                  type="button"
                  className={btnSecondary}
                  aria-label={t('Zoom out')}
                  disabled={zoom <= 0.75}
                  onClick={() => setZoom((z) => Math.max(0.75, +(z - 0.25).toFixed(2)))}
                >
                  −
                </button>
                <button
                  type="button"
                  className={btnSecondary}
                  aria-label={t('Zoom in')}
                  disabled={zoom >= 2}
                  onClick={() => setZoom((z) => Math.min(2, +(z + 0.25).toFixed(2)))}
                >
                  +
                </button>
              </span>
            )}
            {canPages && (
              <button type="button" className={btnSecondary} disabled={busy} onClick={openInTab}>
                {t('Open')}
              </button>
            )}
            <button type="button" className={btnSecondary} disabled={busy} onClick={download}>
              {t('Download')}
            </button>
            <button
              ref={openBtn}
              type="button"
              className={btnSecondary}
              aria-pressed={full}
              onClick={() => setFull((f) => !f)}
            >
              {full ? t('Close full screen') : t('Full screen')}
            </button>
          </div>
        )}
      </div>
      {tabs.length > 1 && (
        <div
          role="tablist"
          aria-label={t('CV view')}
          className="flex w-fit gap-1 rounded-md border border-line bg-card p-1"
        >
          {tabs.map((x) => (
            <button
              key={x.id}
              role="tab"
              type="button"
              aria-selected={showing === x.id}
              onClick={() => setTab(x.id)}
              className={`rounded px-3 py-1 text-sm font-medium ${showing === x.id ? 'bg-accent text-on-accent' : 'text-ink-2'}`}
            >
              {x.label}
            </button>
          ))}
        </div>
      )}
      {fileError && <Notice kind="error">{fileError}</Notice>}
      <div
        className={
          full
            ? 'min-h-0 flex-1 overflow-auto'
            : showing === 'original'
              ? 'max-h-[calc(100vh-14rem)] min-h-[20rem] overflow-auto rounded-md bg-neutral/40 p-2'
              : ''
        }
        data-testid="cv-body"
      >
        {body}
      </div>
    </section>
  );
}
