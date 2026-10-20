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
    ro?.observe(scroller);
    return () => {
      scroller.removeEventListener('scroll', read);
      ro?.disconnect();
    };
  }, [scroller]);

  const byId = new Map(requirements.map((r) => [r.requirementId, r]));
  const shown = spots.filter((s) => byId.has(s.id));
  // Spots on the same line would hide each other: they step aside a little, left and right.
  const nudge = new Map<number, number>();
  const order = shown.map((s, i) => [s.at, i] as const).sort((x, y) => x[0] - y[0]);
  let run = 0;
  order.forEach(([at, i], k) => {
    run = k > 0 && at - order[k - 1]![0] < 0.02 ? run + 1 : 0;
    nudge.set(i, run === 0 ? 0 : (run % 2 ? 1 : -1) * Math.ceil(run / 2) * 6);
  });
  const missing = requirements.filter(
    (r) =>
      r.kind === 'must' && r.state === 'missing' && !shown.some((s) => s.id === r.requirementId),
  ).length;
  if (shown.length === 0) return null;

  return (
    <nav
      aria-label={t('Where the requirements are in the CV')}
      className="relative w-5 shrink-0 self-stretch rounded-full bg-neutral/60"
      data-testid="evidence-map"
    >
      {view && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 rounded-full border border-edge/70 bg-card/50 transition-[top] duration-150"
          style={{ top: `${view.top * 100}%`, height: `${Math.max(view.height * 100, 4)}%` }}
        />
      )}
      {shown.map((s, i) => {
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
            title={label}
            aria-label={label}
            aria-pressed={on}
            onClick={() => onPick(s.id)}
            className="m-pop absolute left-1/2 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
            style={
              {
                top: `${Math.min(98, Math.max(2, s.at * 100))}%`,
                marginLeft: nudge.get(i) ?? 0,
                '--i': i,
              } as CSSProperties
            }
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
      {missing > 0 && (
        <span className="sr-only">
          {missing === 1
            ? t('1 must-have was not found in the CV.')
            : t('{n} must-haves were not found in the CV.', { n: missing })}
        </span>
      )}
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
