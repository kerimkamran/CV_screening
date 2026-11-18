import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Boundary, ReloadNote } from '../Boundary';
import { api, ApiError } from '../api';
import { tr, useT } from '../i18n';
import type { CvReviewData, ReportAnchor, ResumeData } from '../pool';
import { btnSecondary, errMsg, Notice } from '../ui';
import { Segmented } from '../Segmented';
import { CvText } from './CvText';
import { EvidenceMap, textSpots, type EvidenceSpot } from './EvidenceMap';
import type { PdfApi, PdfProblem } from './PdfPages';
import { PdfPages } from './lazy';
import { trServer } from '../i18n/server';

// pdf.js is large: it loads the first time a PDF is opened, not with the app.

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
  activeId = null,
  onPick,
}: {
  data: CvReviewData;
  anchors: ReportAnchor[];
  /** Goes up by one each time "Show in CV" is pressed. */
  focus: number;
  /** The requirement being shown, and how to show another one (the evidence map). */
  activeId?: string | null;
  onPick?: (requirementId: string) => void;
}) {
  const t = useT();
  const erased = data.status === 'erased';
  const canPages = !erased && data.original.view === 'pdf';
  const canText = !erased && data.text.available;
  // Until the person picks a tab, the pages are shown as soon as there are any (a Word file's pages
  // can arrive while the CV is open).
  const [picked, setTab] = useState<Tab | null>(null);
  const tab: Tab = picked ?? (canPages ? 'original' : 'text');
  const [text, setText] = useState<ResumeData | null>(null);
  const [textError, setTextError] = useState('');
  const [problem, setProblem] = useState<PdfProblem | null>(null);
  const [pages, setPages] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(false);
  const [shownZoom, setShownZoom] = useState(1);
  const [full, setFull] = useState(false);
  const dialog = useRef<HTMLDialogElement | null>(null);
  const holder = useRef<HTMLDivElement | null>(null);
  const [held, setHeld] = useState(0);
  const [busy, setBusy] = useState(false);
  const [fileError, setFileError] = useState('');
  const pdf = useRef<PdfApi>(null);
  const openBtn = useRef<HTMLButtonElement | null>(null);
  // The evidence map: spots found on the pages (PDF and Word), or worked out from the text.
  const requirements = data.analysis?.requirements ?? [];
  const mapReqs = requirements.flatMap((r) => {
    const quotes = r.anchors.flatMap((a) => (a.quote ? [a.quote] : []));
    return quotes.length ? [{ id: r.requirementId, quotes }] : [];
  });
  const [pageSpots, setPageSpots] = useState<EvidenceSpot[]>([]);
  const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null);
  const [textEl, setTextEl] = useState<HTMLElement | null>(null);

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

  // "Show in CV": go to the page of the first line when there are pages, else show the lines. A PDF
  // carries its page numbers; for Word the pages are searched for the quote.
  const page = quotePage(anchors);
  const fromMap = useRef<Tab | null>(null);
  useEffect(() => {
    if (!focus) return;
    const from = fromMap.current;
    fromMap.current = null;
    if (from === 'text' && canText) return; // the text marks and scrolls to the lines itself
    if (canPages && !problem) {
      setTab('original');
      if (page) return void pdf.current?.goTo(page);
      const quote = anchors.find((a) => a.quote)?.quote;
      if (quote)
        void pdf.current?.find(quote).then((n) => {
          if (n) pdf.current?.goTo(n);
        });
    } else if (canText) setTab('text');
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  // The text scrolls in its own box (CvText): the map's "on screen" box follows that one. Found by a
  // data attribute, not by its label, which is translated (SD-07).
  useEffect(() => {
    setTextEl(bodyEl?.querySelector<HTMLElement>('[data-cv-text]') ?? null);
  }, [bodyEl, text, tab, full]);

  /*
   * Full screen (UAT-BUG-001) is a real modal: this same element is shown with showModal(), so it
   * sits in the browser's top layer above every header, bar, panel and card, the page behind is
   * inert, and the pages are not loaded again. Esc and the browser's Back button close it; the
   * review keys and "/" do nothing meanwhile (they check data-cv-full); focus returns to the button.
   */
  useEffect(() => {
    const el = dialog.current;
    if (!full || !el) return;
    const root = document.documentElement;
    const button = openBtn.current;
    const scrollY = window.scrollY;
    const prev = {
      overflow: document.body.style.overflow,
      gutter: root.style.scrollbarGutter,
    };
    // The page behind keeps its width (no jump when the scroll bar would go) and its place.
    root.style.scrollbarGutter = 'stable';
    document.body.style.overflow = 'hidden';
    root.dataset.cvFull = '1';
    if (typeof el.showModal === 'function' && !el.open) el.showModal();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFull(false);
    };
    window.addEventListener('keydown', onKey);
    // Back closes the viewer and stays on this CV: one history entry while it is open.
    history.pushState({ ...(history.state as object | null), cvFull: true }, '');
    const onPop = () => setFull(false);
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('popstate', onPop);
      if (el.open) el.close();
      delete root.dataset.cvFull;
      document.body.style.overflow = prev.overflow;
      root.style.scrollbarGutter = prev.gutter;
      if ((history.state as { cvFull?: boolean } | null)?.cvFull) history.back();
      if (window.scrollY !== scrollY) window.scrollTo({ top: scrollY, behavior: 'instant' });
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
    setFileError('');
    if (!w) {
      // Blocked: this tab stays on the review (it never turns into the file), and says why.
      setFileError(tr('The browser blocked the new tab. Use Download instead.'));
      return;
    }
    setBusy(true);
    try {
      const blob = await api.blob(`/documents/${data.documentId}/view`);
      const url = URL.createObjectURL(blob);
      w.opener = null;
      w.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      w.close();
      setFileError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }, [data.documentId]);

  const tabs: { id: Tab; label: string }[] = [];
  if (canPages) tabs.push({ id: 'original', label: tr('Original') });
  if (canText || !canPages) tabs.push({ id: 'text', label: tr('Text') });
  const showing: Tab = canPages && tab === 'original' ? 'original' : 'text';

  // The pages stay mounted once shown, also while the Text tab is open, so going back to Original
  // neither fetches the file again nor loses the place (FS-20).
  const [pagesSeen, setPagesSeen] = useState(false);
  const wantPages = showing === 'original' && canPages && !problem;
  useEffect(() => {
    if (wantPages) setPagesSeen(true);
  }, [wantPages]);
  const pagesView = canPages && !problem && !erased && (pagesSeen || wantPages) && (
    <div hidden={showing !== 'original'}>
      {data.original.source === 'rendition' && (
        <p className="px-1 pb-2 text-xs text-ink-3">
          {t('These pages were made from the Word file, so the layout can differ a little.')}
        </p>
      )}
      <Boundary
        name="pdf pages"
        fallback={<ReloadNote text="parallax was updated. Reload to see the CV." />}
      >
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
            fitHeight={fit}
            maxWidth={full ? 1000 : undefined}
            onZoom={setShownZoom}
            ref={pdf}
            onPages={setPages}
            onProblem={setProblem}
            quotes={anchors.flatMap((x) => (x.quote ? [x.quote] : []))}
            map={onPick ? mapReqs : undefined}
            onMap={setPageSpots}
          />
        </Suspense>
      </Boundary>
    </div>
  );
  // Each view keeps its own scroll position in the shared box.
  const scrollOf = useRef<Record<Tab, number>>({ original: 0, text: 0 });
  const lastShowing = useRef<Tab>(showing);
  /** Reads the place in the view being left, before the switch changes the box under it. */
  const keepPlace = () => {
    if (bodyEl) scrollOf.current = { ...scrollOf.current, [lastShowing.current]: bodyEl.scrollTop };
  };
  // The position is recorded as the person scrolls: by the time the view has changed, the box has
  // already been shortened or emptied by the other view and its scrollTop is no longer theirs.
  useEffect(() => {
    if (!bodyEl) return;
    const rec = () => {
      scrollOf.current = { ...scrollOf.current, [lastShowing.current]: bodyEl.scrollTop };
    };
    bodyEl.addEventListener('scroll', rec, { passive: true });
    return () => bodyEl.removeEventListener('scroll', rec);
  }, [bodyEl]);
  useLayoutEffect(() => {
    if (!bodyEl || lastShowing.current === showing) return;
    lastShowing.current = showing;
    const want = scrollOf.current[showing];
    bodyEl.scrollTo?.({ top: want, behavior: 'instant' });
    if (!want) return;
    // The pages measure their box again after they are shown, so at first they are shorter than
    // they were and the place cannot be reached yet: it is set again until it holds (FS-20), and
    // never against the person's own scrolling.
    let tries = 0;
    let timer = 0;
    const stop = () => window.clearTimeout(timer);
    const again = () => {
      if (Math.abs(bodyEl.scrollTop - want) <= 1 || tries++ >= 12) return;
      bodyEl.scrollTo?.({ top: want, behavior: 'instant' });
      timer = window.setTimeout(again, 50);
    };
    timer = window.setTimeout(again, 50);
    bodyEl.addEventListener('wheel', stop, { once: true, passive: true });
    bodyEl.addEventListener('touchstart', stop, { once: true, passive: true });
    return () => {
      stop();
      bodyEl.removeEventListener('wheel', stop);
      bodyEl.removeEventListener('touchstart', stop);
    };
  }, [showing, bodyEl]);

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
      return null; // the pages (pagesView) are shown
    }
    // The text view, with the reason when it cannot be shown. In full screen the text box takes the
    // remaining height and scrolls by itself.
    return (
      <div className={full ? 'flex min-h-0 flex-1 flex-col gap-2' : 'space-y-2'}>
        {data.kind === 'docx' && data.original.view === 'pending' && (
          <Notice kind="info">
            {t(
              'The pages of this Word file are being prepared. They appear here by themselves; the text below was read from the file.',
            )}
          </Notice>
        )}
        {data.kind === 'docx' && data.original.view !== 'pending' && !canPages && (
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
            {trServer(data.statusDetail.reason ?? 'No text could be read from this file.')}
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

  const zoomBy = (step: number) => {
    const from = fit ? shownZoom : zoom;
    setFit(false);
    setZoom(Math.min(2, Math.max(Math.min(0.75, from), +(from + step).toFixed(2))));
  };
  const tool = `${btnSecondary} pointer-coarse:min-w-11`;
  const pct = Math.round((fit ? shownZoom : zoom) * 100);

  return (
    // While the viewer is in the top layer this box keeps its place in the page, so nothing behind it
    // moves and the scroll position stays (no layout shift).
    <div ref={holder} style={full && held ? { minHeight: held } : undefined} className="min-w-0">
      <dialog
        ref={dialog}
        aria-label={t('CV')}
        // Shown as a page section until full screen; then the same element becomes a modal (no reload).
        role={full ? undefined : 'region'}
        aria-modal={full ? true : undefined}
        onCancel={(e) => {
          e.preventDefault();
          setFull(false);
        }}
        onClose={() => setFull(false)}
        // Shown always: a closed <dialog> is hidden by the browser's own style otherwise.
        style={{ display: 'flex' }}
        className={
          full
            ? 'fixed inset-0 m-0 flex h-dvh max-h-none w-screen max-w-none flex-col gap-2 overflow-hidden border-0 bg-page p-3 text-ink backdrop:bg-page'
            : 'static m-0 flex h-auto max-h-none w-auto max-w-none min-w-0 flex-col gap-2 border-0 bg-transparent p-0 text-inherit'
        }
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
                    className={tool}
                    aria-label={t('Zoom out')}
                    disabled={(fit ? shownZoom : zoom) <= 0.75 + 1e-6}
                    onClick={() => zoomBy(-0.25)}
                  >
                    −
                  </button>
                  <span
                    className="min-w-[3.5ch] text-center text-xs tabular-nums text-ink-2"
                    aria-live="polite"
                  >
                    {pct}%
                  </span>
                  <button
                    type="button"
                    className={tool}
                    aria-label={t('Zoom in')}
                    disabled={(fit ? shownZoom : zoom) >= 2 - 1e-6}
                    onClick={() => zoomBy(0.25)}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className={tool}
                    aria-pressed={fit}
                    title={t('Fit one page to the height')}
                    onClick={() => setFit(true)}
                  >
                    {t('Fit')}
                  </button>
                </span>
              )}
              {canPages && !problem && (
                <button type="button" className={tool} disabled={busy} onClick={openInTab}>
                  {t('Open in new tab')}
                </button>
              )}
              <button type="button" className={tool} disabled={busy} onClick={download}>
                {t('Download')}
              </button>
              <button
                ref={openBtn}
                type="button"
                className={tool}
                aria-pressed={full}
                onClick={() => {
                  if (!full) setHeld(holder.current?.getBoundingClientRect().height ?? 0);
                  setFull((f) => !f);
                }}
              >
                {full ? t('Close full screen') : t('Full screen')}
              </button>
            </div>
          )}
        </div>
        {tabs.length > 1 && (
          <Segmented
            label={t('CV view')}
            className="w-fit"
            value={showing}
            onChange={(next) => {
              keepPlace();
              setTab(next);
            }}
            items={tabs.map((x) => ({ key: x.id, label: x.label }))}
          />
        )}
        {fileError && <Notice kind="error">{fileError}</Notice>}
        <div className={full ? 'flex min-h-0 flex-1 gap-2' : 'flex gap-2'}>
          <div
            ref={setBodyEl}
            // The scrolling page view is a tab stop, so the arrow and Page keys scroll the CV (A11-01).
            {...(showing === 'original'
              ? { tabIndex: 0, role: 'group', 'aria-label': t('CV pages') }
              : {})}
            className={
              full
                ? showing === 'original'
                  ? 'min-h-0 min-w-0 flex-1 overflow-auto'
                  : 'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden'
                : showing === 'original'
                  ? 'max-h-[calc(100vh-14rem)] min-h-[20rem] min-w-0 flex-1 overflow-auto rounded-md bg-neutral/40 p-2 @min-[60rem]:pointer-coarse:max-h-[calc(100vh-20rem)]'
                  : 'min-w-0 flex-1'
            }
            data-testid="cv-body"
          >
            {pagesView}
            {body}
          </div>
          {onPick && !erased && (
            <EvidenceMap
              spots={
                showing === 'original'
                  ? problem
                    ? []
                    : pageSpots
                  : text
                    ? textSpots(requirements, text.text.length)
                    : []
              }
              requirements={requirements}
              activeId={activeId}
              onPick={(id) => {
                // A dot pressed in the Text view shows the lines in the text, not the pages (EM-07).
                fromMap.current = showing;
                onPick(id);
              }}
              scroller={showing === 'original' ? bodyEl : textEl}
            />
          )}
        </div>
      </dialog>
    </div>
  );
}
