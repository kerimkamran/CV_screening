import { useId } from 'react';
import { useCountUp } from './motion';

/**
 * The match score as a ring that fills to its value while the number counts up (parallax motion).
 * The number is always written out, so the ring is decoration: with reduced motion it simply shows
 * the final value, and a screen reader hears the label once.
 */
export function ScoreDial({
  score,
  label,
  size = 56,
}: {
  score: number;
  /** What a screen reader hears, e.g. "Match 88%". */
  label: string;
  size?: number;
}) {
  const v = Math.max(0, Math.min(100, Math.round(score)));
  const shown = Math.round(useCountUp(v));
  const grad = `dial-${useId().replace(/:/g, '')}`;
  return (
    <span
      role="img"
      aria-label={label}
      className="relative inline-grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
      data-testid="score-dial"
    >
      <svg viewBox="0 0 36 36" aria-hidden="true" className="absolute inset-0 -rotate-90">
        {/* The arc runs from the brand navy into the link blue: depth without a new colour. */}
        <defs>
          <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" style={{ stopColor: 'var(--c-accent)' }} />
            <stop offset="100%" style={{ stopColor: 'var(--c-link)' }} />
          </linearGradient>
        </defs>
        <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--c-neutral)" strokeWidth="3" />
        <circle
          cx="18"
          cy="18"
          r="15.5"
          fill="none"
          stroke={`url(#${grad})`}
          strokeWidth="3"
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray="100"
          strokeDashoffset={100 - v}
          className="m-ring"
        />
      </svg>
      <span aria-hidden="true" className="relative text-sm font-bold tabular-nums">
        {shown}%
      </span>
    </span>
  );
}
