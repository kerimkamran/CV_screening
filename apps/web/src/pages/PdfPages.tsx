import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { api } from '../api';
import { scrollInside } from '../motion';
import { useT } from '../i18n';
import {
  quoteBoxes,
  spotsOnPage,
  squash,
  type Box,
  type ReqQuotes,
  type TextBit,
} from './pdf-marks';

export { squash };

/**
 * The original CV as pages (Stage 2, S2-FE4). This file is the only place that imports pdf.js, and
 * it is loaded on demand (React.lazy in CvPane), so the main bundle does not carry it.
 *
 * Safety: the worker is our own file under /assets (the page policy allows only 'self'), scripts
 * inside a PDF are never run (isEvalSupported is off), fonts are drawn as shapes instead of loaded
 * as font files, and the bytes come from our API with the sign-in in a header.
 */
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfProblem = 'password' | 'broken' | 'missing' | 'unavailable';
export interface PdfApi {
  /** Scroll to a page and flash it. Safe to call before the pages have loaded. */
  goTo: (page: number) => void;
  /** The page whose text holds this quote, or null (the server does not know pages for Word). */
  find: (quote: string) => Promise<number | null>;
}

/** The first page whose text contains the start of the quote (S2-FE4, findQuotePage). */
export async function findQuotePage(doc: PDFDocumentProxy, quote: string): Promise<number | null> {
  const needle = squash(quote).slice(0, 48);
  if (needle.length < 6) return null;
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const text = squash(content.items.map((i) => ('str' in i ? i.str : '')).join(' '));
    if (text.includes(needle)) return n;
  }
  return null;
}

const MAX_DPR = 2;
const PAGE_GAP = 12;

function problemOf(e: unknown): PdfProblem {
  const name = (e as { name?: string } | null)?.name ?? '';
  if (name === 'PasswordException') return 'password';
  if (
    name === 'InvalidPDFException' ||
    name === 'FormatError' ||
    name === 'UnexpectedResponseException'
  )
    return 'broken';
  const status = (e as { status?: number } | null)?.status;
  if (status === 404) return 'missing';
  if (status === 409) return 'unavailable';
  return 'broken';
}

function Page({
  doc,
  n,
  width,
  flashed,
  register,
  quotes,
  aim,
}: {
  doc: PDFDocumentProxy;
  n: number;
  width: number;
  flashed: boolean;
  register: (n: number, el: HTMLDivElement | null) => void;
  /** The lines to mark on this page (the chosen requirement's quotes). */
  quotes: string[];
  /** Goes up when this page was asked for: the first mark is brought into view. */
  aim: number;
}) {
  const t = useT();
  const box = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const firstMark = useRef<HTMLSpanElement | null>(null);
  const [near, setNear] = useState(false);
  const [ratio, setRatio] = useState(1.414);
  // The page fades in once it is drawn; until then a faint light passes over the blank sheet.
  const [drawn, setDrawn] = useState(false);
  const [marks, setMarks] = useState<Box[]>([]);
  const quoteKey = quotes.join('\u0000');

  // The marks: found in the page's text once the page is near and there is something to mark.
  useEffect(() => {
    if (!near || !quoteKey) {
      setMarks([]);
      return;
    }
    let dead = false;
    void (async () => {
      try {
        const page = await doc.getPage(n);
        const content = await page.getTextContent();
        if (dead) return;
        const vp = page.getViewport({ scale: 1 });
        const items: TextBit[] = content.items.flatMap((i) =>
          'str' in i ? [{ str: i.str, transform: i.transform as number[], width: i.width }] : [],
        );
        setMarks(quoteBoxes(items, vp, quoteKey.split('\u0000')));
      } catch {
        if (!dead) setMarks([]);
      }
    })();
    return () => {
      dead = true;
    };
  }, [doc, n, near, quoteKey]);

  // Asked for and marked: bring the first mark to the middle of the view.
  useEffect(() => {
    if (aim > 0 && marks.length > 0) scrollInside(firstMark.current, 'center');
  }, [aim, marks]);

  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(([e]) => e && setNear(e.isIntersecting), {
      rootMargin: '1200px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!near || width < 40) return;
    let task: RenderTask | null = null;
    let dead = false;
    void (async () => {
      try {
        const page = await doc.getPage(n);
        if (dead) return;
        const base = page.getViewport({ scale: 1 });
        setRatio(base.height / base.width);
        const scale = width / base.width;
        const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
        const vp = page.getViewport({ scale: scale * dpr });
        const c = canvas.current;
        if (!c) return;
        c.width = Math.floor(vp.width);
        c.height = Math.floor(vp.height);
        c.style.width = `${Math.floor(vp.width / dpr)}px`;
        c.style.height = `${Math.floor(vp.height / dpr)}px`;
        const ctx = c.getContext('2d');
        if (!ctx) return;
        task = page.render({ canvasContext: ctx, viewport: vp });
        await task.promise;
        if (!dead) setDrawn(true);
      } catch {
        /* a cancelled render (the width changed or the page left) is not an error */
      }
    })();
    return () => {
      dead = true;
      task?.cancel();
    };
  }, [doc, n, near, width]);

  return (
    <div
      ref={(el) => {
        box.current = el;
        register(n, el);
      }}
      data-page={n}
      className={`relative mx-auto overflow-hidden rounded-sm bg-white shadow-md transition-[box-shadow,scale] duration-500 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none ${flashed ? 'scale-[1.01] ring-4 ring-focus' : ''} ${drawn ? '' : 'm-loading'}`}
      style={{ width, height: Math.round(width * ratio), marginBottom: PAGE_GAP }}
    >
      <canvas
        ref={canvas}
        aria-label={t('Page {n}', { n })}
        role="img"
        className={`transition-opacity duration-500 motion-reduce:transition-none ${drawn ? 'opacity-100' : 'opacity-0'}`}
      />
      {/* A highlighter stroke over the found lines; it sweeps in from the left (motion.css). */}
      {marks.map((m, i) => (
        <span
          key={`${quoteKey.length}-${aim}-${i}`}
          ref={i === 0 ? firstMark : undefined}
          aria-hidden="true"
          data-testid="pdf-mark"
          className="m-highlight pointer-events-none absolute rounded-[2px]"
          style={
            {
              left: `${m.x * 100}%`,
              top: `${m.y * 100}%`,
              width: `${m.w * 100}%`,
              height: `${m.h * 100}%`,
              '--i': Math.min(i, 8),
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

export default function PdfPages({
  documentId,
  zoom,
  ref,
  onPages,
  onProblem,
  quotes = [],
  map,
  onMap,
}: {
  documentId: string;
  zoom: number;
  /** Lines to mark on the pages: the chosen requirement's quotes. */
  quotes?: string[];
  /** Every requirement's quotes, for the evidence map. */
  map?: ReqQuotes[];
  onMap?: (spots: { id: string; page: number; at: number }[]) => void;
  ref?: React.Ref<PdfApi>;
  onPages?: (count: number) => void;
  onProblem: (p: PdfProblem) => void;
}) {
  const t = useT();
  const wrap = useRef<HTMLDivElement | null>(null);
  const els = useRef(new Map<number, HTMLDivElement>());
  const pending = useRef<number | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [count, setCount] = useState(0);
  const [width, setWidth] = useState(0);
  const [flash, setFlash] = useState<number | null>(null);
  const [aim, setAim] = useState<{ page: number; seq: number }>({ page: 0, seq: 0 });

  // The document: one request, aborted when the CV changes or the pane closes.
  useEffect(() => {
    const ctl = new AbortController();
    let loaded: PDFDocumentProxy | null = null;
    let task: ReturnType<typeof pdfjs.getDocument> | null = null;
    setDoc(null);
    setCount(0);
    void (async () => {
      try {
        const data = await api.bytes(`/documents/${documentId}/view`, ctl.signal);
        if (ctl.signal.aborted) return;
        task = pdfjs.getDocument({
          data: new Uint8Array(data),
          isEvalSupported: false,
          disableFontFace: true,
          enableXfa: false,
          useWorkerFetch: false,
        });
        loaded = await task.promise;
        if (ctl.signal.aborted) return void loaded.destroy();
        setDoc(loaded);
        setCount(loaded.numPages);
        onPages?.(loaded.numPages);
      } catch (e) {
        if (!ctl.signal.aborted) onProblem(problemOf(e));
      }
    })();
    return () => {
      ctl.abort();
      void task?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  // The evidence map: where every requirement's quotes are, over all the pages (read once per CV).
  const mapKey = JSON.stringify(map ?? []);
  const onMapRef = useRef(onMap);
  useEffect(() => {
    onMapRef.current = onMap;
  });
  useEffect(() => {
    const reqs = JSON.parse(mapKey) as ReqQuotes[];
    if (!doc || reqs.length === 0) return;
    let dead = false;
    void (async () => {
      const out: { id: string; page: number; at: number }[] = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const content = await page.getTextContent();
        if (dead) return;
        const items: TextBit[] = content.items.flatMap((i) =>
          'str' in i ? [{ str: i.str, transform: i.transform as number[], width: i.width }] : [],
        );
        out.push(...spotsOnPage(items, page.getViewport({ scale: 1 }), reqs, n, doc.numPages));
      }
      if (!dead) onMapRef.current?.(out);
    })().catch(() => undefined);
    return () => {
      dead = true;
    };
  }, [doc, mapKey]);

  // The width the pages should have: the pane, times the zoom.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const read = () => setWidth(Math.max(0, Math.floor(el.clientWidth - 8) * zoom));
    read();
    if (typeof ResizeObserver === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(read, 150);
    });
    ro.observe(el);
    return () => {
      clearTimeout(timer);
      ro.disconnect();
    };
  }, [zoom]);

  const jump = (page: number) => {
    const el = els.current.get(page);
    if (!el) return false;
    scrollInside(el, 'start');
    setFlash(page);
    setAim((a) => ({ page, seq: a.seq + 1 }));
    setTimeout(() => setFlash((f) => (f === page ? null : f)), 1600);
    return true;
  };
  useImperativeHandle(ref, () => ({
    goTo: (page) => {
      if (!jump(page)) pending.current = page;
    },
    find: async (quote) => (doc ? findQuotePage(doc, quote) : null),
  }));
  useEffect(() => {
    if (doc && pending.current !== null && jump(pending.current)) pending.current = null;
  }, [doc, count]);

  return (
    <div ref={wrap} className="min-w-0" data-testid="pdf-pages">
      {!doc && (
        <p role="status" className="p-4 text-sm text-ink-3">
          {t('Loading the pages…')}
        </p>
      )}
      {doc &&
        Array.from({ length: count }, (_, i) => (
          <Page
            key={i + 1}
            doc={doc}
            n={i + 1}
            width={width}
            flashed={flash === i + 1}
            quotes={quotes}
            aim={aim.page === i + 1 ? aim.seq : 0}
            register={(n, el) => {
              if (el) els.current.set(n, el);
              else els.current.delete(n);
            }}
          />
        ))}
    </div>
  );
}
