import { useEffect, useMemo, useRef } from 'react';
import { useT } from '../i18n';
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
    first.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
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
          className="my-2 block border-t border-dashed border-line pt-1 text-xs text-ink-3"
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
    <div
      tabIndex={0}
      aria-label={t('CV text')}
      className={`${tall ? 'max-h-full' : 'max-h-[calc(100vh-16rem)]'} min-h-[20rem] overflow-auto whitespace-pre-wrap rounded-md border border-line bg-card p-4 text-sm leading-relaxed focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none`}
    >
      {out}
      {data.truncated && (
        <p className="mt-3 text-xs text-ink-3">{t('Only the first part of this CV is shown.')}</p>
      )}
    </div>
  );
}
