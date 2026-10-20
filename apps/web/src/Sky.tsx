import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';

/**
 * The night-sky banner on Home (design spec 8.1). Five stacked, non-interactive layers: horizon
 * glow, six twinkling stars, dim constellations, a soft glow that follows the cursor, and bright
 * constellations revealed only near the cursor. It is decoration: nothing here carries meaning.
 * With "reduce motion" on, or on a touch screen, the twinkle and the cursor effects are off and
 * the sky stays still.
 *
 * Parallax (motion, October 2026): the layers sit at different depths and drift against each other
 * as the pointer moves, and a shooting star crosses now and then. Same rules: off with reduced
 * motion and on touch screens.
 */

// Original shapes, in a 800 x 220 box.
const SHAPES: { dots: [number, number][]; lines: [number, number, number, number][] }[] = [
  {
    dots: [
      [90, 60],
      [150, 100],
      [215, 80],
      [260, 140],
      [330, 120],
    ],
    lines: [
      [90, 60, 150, 100],
      [150, 100, 215, 80],
      [215, 80, 260, 140],
      [260, 140, 330, 120],
    ],
  },
  {
    dots: [
      [470, 50],
      [530, 90],
      [600, 60],
      [570, 150],
      [650, 130],
      [710, 90],
    ],
    lines: [
      [470, 50, 530, 90],
      [530, 90, 600, 60],
      [530, 90, 570, 150],
      [570, 150, 650, 130],
      [650, 130, 710, 90],
    ],
  },
  {
    dots: [
      [380, 170],
      [430, 195],
      [490, 175],
    ],
    lines: [
      [380, 170, 430, 195],
      [430, 195, 490, 175],
    ],
  },
];

const TWINKLE: { x: number; y: number; size: number; delay: number }[] = [
  { x: 8, y: 22, size: 3, delay: 0 },
  { x: 24, y: 70, size: 2, delay: 0.9 },
  { x: 47, y: 18, size: 2, delay: 1.7 },
  { x: 63, y: 62, size: 3, delay: 0.4 },
  { x: 81, y: 20, size: 2, delay: 2.3 },
  { x: 93, y: 68, size: 3, delay: 1.2 },
];

/** Number of stars drawn in the constellations (the waiting screen lights them one by one). */
export const STAR_COUNT = SHAPES.reduce((n, s) => n + s.dots.length, 0);
const DOT_INDEX = new Map<string, number>(
  SHAPES.flatMap((s) => s.dots).map(([x, y], i) => [`${x},${y}`, i]),
);

/**
 * The constellations as a progress picture: the first `lit` stars are gold, the rest dim, and a line
 * shows once both of its ends are lit. Changes use `transform` and `opacity` only (CSS classes
 * `sky-star` and `sky-line` in index.css).
 */
export function LitConstellations({ lit }: { lit: number }) {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 800 220"
      preserveAspectRatio="xMidYMid slice"
    >
      {SHAPES.flatMap((s) => s.lines).map(([a, b, c, d], i) => {
        const on = DOT_INDEX.get(`${a},${b}`)! < lit && DOT_INDEX.get(`${c},${d}`)! < lit;
        return (
          <line
            key={i}
            x1={a}
            y1={b}
            x2={c}
            y2={d}
            stroke="#8FB4FF"
            strokeWidth="1.4"
            className={`sky-line ${on ? 'sky-line-on' : ''}`}
            data-on={on ? 'true' : 'false'}
          />
        );
      })}
      {SHAPES.flatMap((s) => s.dots).map(([x, y], i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r="3.2"
          fill={i < lit ? '#F5C461' : '#B9C8F2'}
          className={`sky-star ${i < lit ? 'sky-star-on' : ''}`}
          data-lit={i < lit ? 'true' : 'false'}
          style={{ transformOrigin: `${x}px ${y}px` }}
        />
      ))}
    </svg>
  );
}

function Constellations({ line, dot, dimmed }: { line: string; dot: string; dimmed?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 800 220"
      preserveAspectRatio="xMidYMid slice"
      style={dimmed ? { opacity: 0.28 } : undefined}
    >
      {SHAPES.flatMap((s) => s.lines).map(([a, b, c, d], i) => (
        <line key={i} x1={a} y1={b} x2={c} y2={d} stroke={line} strokeWidth="1.2" />
      ))}
      {SHAPES.flatMap((s) => s.dots).map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="2.6" fill={dot} />
      ))}
    </svg>
  );
}

/** True when the person asked for less motion or the screen has no hover (touch). */
export function calmSky(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true;
  return (
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    window.matchMedia('(hover: none)').matches
  );
}

export function Sky({
  children,
  lit,
  className,
}: {
  children?: ReactNode;
  /** When set, the sky is a progress picture (see `LitConstellations`) and the cursor effects are off. */
  lit?: number;
  /** Replaces the default banner shape and padding. */
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const calm = calmSky();
  const still = calm || lit !== undefined; // no cursor effects

  useEffect(() => {
    const el = ref.current;
    if (!el || still) return;
    const move = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${e.clientX - r.left}px`);
      el.style.setProperty('--my', `${e.clientY - r.top}px`);
      // -1 to 1 from the centre: the depth layers drift by this times their depth (motion.css).
      el.style.setProperty('--px', (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
      el.style.setProperty('--py', (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
    };
    const leave = () => {
      el.style.setProperty('--mx', '-1000px');
      el.style.setProperty('--my', '-1000px');
      el.style.setProperty('--px', '0');
      el.style.setProperty('--py', '0');
    };
    el.addEventListener('mousemove', move);
    el.addEventListener('mouseleave', leave);
    return () => {
      el.removeEventListener('mousemove', move);
      el.removeEventListener('mouseleave', leave);
    };
  }, [still]);

  return (
    <div
      ref={ref}
      data-testid="sky"
      data-calm={calm ? 'true' : 'false'}
      className={`relative overflow-hidden text-white ${className ?? 'rounded-3xl px-6 py-8'}`}
      style={
        {
          background: '#0A1530',
          '--mx': '-1000px',
          '--my': '-1000px',
        } as CSSProperties
      }
    >
      {/* 1. Horizon glow (furthest away: drifts the other way) */}
      <div
        aria-hidden="true"
        className="sky-depth pointer-events-none absolute inset-x-[-20%] bottom-[-70%] h-[140%] rounded-[50%]"
        style={
          {
            background: 'radial-gradient(ellipse at center, #1B3E8F 0%, #0F2459 38%, #0A1530 70%)',
            '--d': still ? 0 : -6,
          } as CSSProperties
        }
      />
      {/* 2. Twinkling stars, and a shooting star now and then */}
      <div
        aria-hidden="true"
        className="sky-depth pointer-events-none absolute inset-0"
        style={{ '--d': still ? 0 : 5 } as CSSProperties}
      >
        {!still && (
          <>
            <span className="sky-meteor" style={{ left: '12%', top: '8%' }} />
            <span
              className="sky-meteor"
              style={{ left: '58%', top: '4%', animationDelay: '5.5s', animationDuration: '13s' }}
            />
          </>
        )}
        {TWINKLE.map((s, i) => (
          <span
            key={i}
            aria-hidden="true"
            className={`pointer-events-none absolute rounded-full bg-white ${calm ? 'opacity-70' : 'sky-twinkle'}`}
            style={{
              left: `${s.x}%`,
              top: `${s.y}%`,
              width: s.size,
              height: s.size,
              animationDelay: `${s.delay}s`,
            }}
          />
        ))}
      </div>
      {/* 3. Dim constellations, or the progress picture (nearest: drifts the most) */}
      <div
        aria-hidden="true"
        className="sky-depth pointer-events-none absolute inset-0"
        style={{ '--d': still ? 0 : 12 } as CSSProperties}
      >
        {lit !== undefined ? (
          <LitConstellations lit={lit} />
        ) : (
          <Constellations line="#5C93FF" dot="#B9C8F2" dimmed />
        )}
      </div>
      {!still && (
        <>
          {/* 4. Cursor glow */}
          <div
            aria-hidden="true"
            data-testid="sky-glow"
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(320px circle at var(--mx) var(--my), rgba(92,147,255,.20), transparent 70%)',
            }}
          />
          {/* 5. Bright constellations, only near the cursor */}
          <div
            aria-hidden="true"
            data-testid="sky-bright"
            className="sky-depth pointer-events-none absolute inset-0"
            style={{
              ['--d' as string]: 12,
              WebkitMaskImage:
                'radial-gradient(260px circle at var(--mx) var(--my), #000, transparent)',
              maskImage: 'radial-gradient(260px circle at var(--mx) var(--my), #000, transparent)',
            }}
          >
            <Constellations line="#8FB4FF" dot="#F5C461" />
          </div>
        </>
      )}
      <div className="relative">{children}</div>
    </div>
  );
}
