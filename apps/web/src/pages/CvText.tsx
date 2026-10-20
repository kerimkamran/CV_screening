import { useEffect, useMemo, useRef } from 'react';
import { useT } from '../i18n';
import { replay, scrollInside } from '../motion';
import type { ReportAnchor, ResumeData } from '../pool';

/** The CV as text with the chosen lines marked and page numbers in the margin. */
export function CvText({
  data,
  anchors,
  focus,
  tall = false,
}: {
  data: ResumeData;
  anchors: ReportAnchor[];
  focus: number;
  tall?: boolean;
}) {
  const t = useT();
  const first = useRef<HTMLElement | null>(null);
  const text = data.text;
  const ranges = useMemo(() => {
    const r = anchors
      .map((a) => [a.start, a.end] as [number, number])
      .filter(([a, b]) => b > a && a >= 0 && a < text.length)
      .map(([a, b]) => [a, Math.min(b, text.length)] as [number, number])
      .sort((x, y) => x[0] - y[0]);
    const merged: [number, number][] = [];
    for (const x of r) {
      const last = merged.at(-1);
      if (last && x[0] <= last[1]) last[1] = Math.max(last[1], x[1]);
      else merged.push([...x]);
    }
    return merged;
  }, [anchors, text.length]);

  useEffect(() => {
    scrollInside(first.current, 'center');
    // The found line lights up for a moment (motion.css), each time it is asked for.
    replay(first.current, 'm-spot');
  }, [focus, ranges]);

  const cuts = new Set<number>([0, text.length]);
  for (const [a, b] of ranges) {
    cuts.add(a);
    cuts.add(b);
  }
  const pages = new Map<number, number>();
  data.pageStarts?.forEach((o, i) => {
    if (o > 0 && o < text.length) {
      cuts.add(o);
      pages.set(o, i + 1);
    }
  });
  const pts = [...cuts].sort((a, b) => a - b);
  const inRange = (o: number) => ranges.some(([a, b]) => o >= a && o < b);
  let setFirst = false;
  const out: React.ReactNode[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const piece = text.slice(a, b);
    if (pages.has(a))
      out.push(
        <span
          key={`p${a}`}
          className="-mx-6 my-6 block border-t-8 border-neutral pt-2 text-center text-xs text-[#5b6577] sm:-mx-10"
        >
          {t('Page {n}', { n: pages.get(a)! })}
        </span>,
      );
    if (inRange(a)) {
      const isFirst = !setFirst;
      setFirst = true;
      out.push(
        <mark
          key={a}
          ref={isFirst ? (el) => void (first.current = el) : undefined}
          className="rounded bg-warn px-0.5 text-warn-ink"
        >
          {piece}
        </mark>,
      );
    } else out.push(<span key={a}>{piece}</span>);
  }
  return (
    // The text is set on a sheet of paper, like the pages of a PDF, so every CV reads as a document.
    <div
      tabIndex={0}
      aria-label={t('CV text')}
      className={`${tall ? 'max-h-full' : 'max-h-[calc(100vh-16rem)]'} min-h-[20rem] overflow-auto rounded-md bg-neutral/40 p-3 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none sm:p-5`}
    >
      <article className="mx-auto min-h-[28rem] max-w-[46rem] rounded-sm bg-white px-6 py-8 text-[0.9rem] leading-relaxed whitespace-pre-wrap text-[#1a1a1a] shadow-md sm:px-10 sm:py-12 forced-colors:border">
        {out}
        {data.truncated && (
          <p className="mt-6 text-xs text-[#5b6577]">
            {t('Only the first part of this CV is shown.')}
          </p>
        )}
      </article>
    </div>
  );
}
