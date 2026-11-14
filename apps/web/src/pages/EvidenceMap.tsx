import { useEffect, useState, type CSSProperties } from 'react';
import { useT } from '../i18n';
import type { ReportRequirement } from '../pool';

/** Where one requirement's evidence sits in the CV, from 0 (top of page 1) to 1 (end of the CV). */
export interface EvidenceSpot {
  id: string;
  at: number;
  page?: number;
}

/**
 * The evidence map (a design addition to Stage 2): a thin strip beside the CV, like the marks on a
 * code editor's scrollbar. Each requirement that was found has a dot where its quote sits in the
 * CV; the box shows which part of the CV is on screen. Pressing a dot shows that requirement in the
 * CV, exactly like its "Show in CV". It answers at a glance "is the evidence all in one old job, or
 * spread over the whole career?" and "what is not there at all?".
 *
 * The dots are buttons with the requirement in words, so the map works with a keyboard and a screen
 * reader; colour is never the only signal (found and partly found differ in shape too).
 */
/**
 * How far apart crowded dots are stacked, in px: a dot is 20 px (h-5) and targets keep 24 px between
 * their centres (WCAG 2.5.8 target spacing).
 */
const DOT = 24;

export function EvidenceMap({
  spots,
  requirements,
  activeId,
  onPick,
  scroller,
}: {
  spots: EvidenceSpot[];
  requirements: ReportRequirement[];
  activeId: string | null;
  onPick: (requirementId: string) => void;
  /** The element that scrolls the CV, for the "on screen" box. */
  scroller: HTMLElement | null;
}) {
  const t = useT();
  const [view, setView] = useState<{ top: number; height: number } | null>(null);
  const [strip, setStrip] = useState<HTMLElement | null>(null);
  const [h, setH] = useState(0);
  useEffect(() => {
    if (!strip) return;
    const read = () => setH(strip.clientHeight);
    read();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(read);
    ro?.observe(strip);
    return () => ro?.disconnect();
  }, [strip]);

  useEffect(() => {
    if (!scroller) return;
    const read = () => {
      const h = scroller.scrollHeight;
      if (h <= scroller.clientHeight + 1) return setView(null);
      setView({ top: scroller.scrollTop / h, height: scroller.clientHeight / h });
    };
    read();
    scroller.addEventListener('scroll', read, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(read);
    // The box also has to follow the content: zooming or a page that finishes drawing changes
    // scrollHeight without the scroller itself changing size (EM-03).
    const watch = () => {
      ro?.disconnect();
      ro?.observe(scroller);
      for (const c of Array.from(scroller.children)) ro?.observe(c);
      read();
    };
    watch();
    const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => watch());
    mo?.observe(scroller, { childList: true });
    return () => {
      scroller.removeEventListener('scroll', read);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [scroller]);

  const byId = new Map(requirements.map((r) => [r.requirementId, r]));
  const shown = spots.filter((s) => byId.has(s.id));
  // Spots that sit close together would hide each other. They are stacked along the strip, one dot
  // apart, and never pushed sideways out of it (SD-05): the strip is as wide as a dot.
  const top = new Map<number, string>();
  const order = shown.map((s, i) => [s.at, i] as const).sort((x, y) => x[0] - y[0]);
  if (h > DOT) {
    const ys = order.map(([at]) => Math.min(h - DOT / 2, Math.max(DOT / 2, at * h)));
    for (let k = 1; k < ys.length; k++) ys[k] = Math.max(ys[k]!, ys[k - 1]! + DOT);
    // Too low at the end: push the run back up, keeping the spacing while there is room.
    for (let k = ys.length - 1; k >= 0; k--) {
      const limit = h - DOT / 2 - (ys.length - 1 - k) * DOT;
      ys[k] = Math.max(DOT / 2, Math.min(ys[k]!, limit));
    }
    order.forEach(([, i], k) => top.set(i, `${ys[k]}px`));
  } else order.forEach(([at, i]) => top.set(i, `${Math.min(98, Math.max(2, at * 100))}%`));
  const missing = requirements.filter(
    (r) =>
      r.kind === 'must' && r.state === 'missing' && !shown.some((s) => s.id === r.requirementId),
  ).length;
  const missingNote =
    missing > 0 ? (
      <span className="sr-only">
        {missing === 1
          ? t('1 must-have was not found in the CV.')
          : t('{n} must-haves were not found in the CV.', { n: missing })}
      </span>
    ) : null;
  // No dots: the strip is not drawn, but the missing must-haves are still said (EM-04).
  if (shown.length === 0) return missingNote;
  // Dots are in the page in reading order (top to bottom), so Tab meets them in that order.
  const reading = order.map(([, i]) => i);

  return (
    <nav
      ref={setStrip}
      aria-label={t('Where the requirements are in the CV')}
      className="relative w-5 shrink-0 self-stretch rounded-full bg-neutral/60"
      data-testid="evidence-map"
    >
      {view && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 rounded-full border border-edge/70 bg-card/50 transition-[top] duration-150"
          style={{ top: `${view.top * 100}%`, height: `${view.height * 100}%`, minHeight: 6 }}
        />
      )}
      {reading.map((i) => {
        const s = shown[i]!;
        const r = byId.get(s.id)!;
        const on = s.id === activeId;
        const partly = r.state === 'partly';
        const label = s.page
          ? t('{requirement}, page {n}', { requirement: r.text, n: s.page })
          : r.text;
        return (
          <button
            key={`${s.id}-${i}`}
            type="button"
            data-tgt="small"
            title={label}
            aria-label={label}
            aria-pressed={on}
            onClick={() => onPick(s.id)}
            className="m-pop absolute left-1/2 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
            style={{ top: top.get(i), '--i': Math.min(i, 12) } as CSSProperties}
          >
            <span
              aria-hidden="true"
              className={`block transition-transform ${on ? 'scale-150' : ''} ${
                partly
                  ? 'h-2.5 w-2.5 rotate-45 rounded-[2px] bg-warn-text'
                  : 'h-2.5 w-2.5 rounded-full bg-ok-text'
              } ${on ? 'ring-2 ring-accent ring-offset-1 ring-offset-card' : ''}`}
            />
          </button>
        );
      })}
      {missingNote}
    </nav>
  );
}

/** Spots from the CV text: where each requirement's first quote starts in it. */
export function textSpots(requirements: ReportRequirement[], length: number): EvidenceSpot[] {
  if (length <= 0) return [];
  return requirements.flatMap((r) => {
    const a = r.anchors.find((x) => x.end > x.start);
    return a ? [{ id: r.requirementId, at: Math.min(1, a.start / length) }] : [];
  });
}
