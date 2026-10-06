import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';

/**
 * The night-sky banner on Home (design spec 8.1). Five stacked, non-interactive layers: horizon
 * glow, six twinkling stars, dim constellations, a soft glow that follows the cursor, and bright
 * constellations revealed only near the cursor. It is decoration: nothing here carries meaning.
 * With "reduce motion" on, or on a touch screen, the twinkle and the cursor effects are off and
 * the sky stays still.
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

export function Sky({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const calm = calmSky();

  useEffect(() => {
    const el = ref.current;
    if (!el || calm) return;
    const move = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${e.clientX - r.left}px`);
      el.style.setProperty('--my', `${e.clientY - r.top}px`);
    };
    const leave = () => {
      el.style.setProperty('--mx', '-1000px');
      el.style.setProperty('--my', '-1000px');
    };
    el.addEventListener('mousemove', move);
    el.addEventListener('mouseleave', leave);
    return () => {
      el.removeEventListener('mousemove', move);
      el.removeEventListener('mouseleave', leave);
    };
  }, [calm]);

  return (
    <div
      ref={ref}
      data-testid="sky"
      data-calm={calm ? 'true' : 'false'}
      className="relative overflow-hidden rounded-3xl px-6 py-8 text-white"
      style={
        {
          background: '#0A1530',
          '--mx': '-1000px',
          '--my': '-1000px',
        } as CSSProperties
      }
    >
      {/* 1. Horizon glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-[-20%] bottom-[-70%] h-[140%] rounded-[50%]"
        style={{
          background: 'radial-gradient(ellipse at center, #1B3E8F 0%, #0F2459 38%, #0A1530 70%)',
        }}
      />
      {/* 2. Twinkling stars */}
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
      {/* 3. Dim constellations */}
      <Constellations line="#5C93FF" dot="#B9C8F2" dimmed />
      {!calm && (
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
            className="pointer-events-none absolute inset-0"
            style={{
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
