import { useEffect, useRef, useState, type ReactNode } from 'react';
import { SCENE_NAME } from '../brand';
import { useT } from '../i18n';
import { Sky } from '../Sky';
import './coffeebay.css';

/**
 * The coffeebay scene (Stage 2, S2-FE11): a flat illustration in SVG and CSS. Decorative only
 * (`aria-hidden`); everything it says is also in the panel next to it. Loaded lazily so the main
 * bundle does not carry it. Nothing here is taken from any real café's logo.
 *
 * Progress is the star window: `lit` of the 14 stars are gold, and a constellation line shows when
 * both of its ends are lit.
 */
/** The drawing is 720 x 300; every moving part is placed by these units so it scales with the scene. */
const W = 720;
const H = 300;

/**
 * A moving part drawn on its own. Its `<svg>` box is a layer the browser can move and fade without
 * repainting the rest of the scene (animating a shape inside one big SVG repaints all of it, every
 * frame). `box` is x, y, width, height in drawing units; the part's own drawing uses the same units.
 */
function Part({
  box: [x, y, w, h],
  className,
  delay,
  children,
}: {
  box: [number, number, number, number];
  className: string;
  /** Seconds before its loop starts, so the wisps rise one after another. */
  delay?: number;
  children: ReactNode;
}) {
  return (
    <svg
      className={`cb-part ${className}`}
      viewBox={`${x} ${y} ${w} ${h}`}
      style={{
        left: `${(x / W) * 100}%`,
        top: `${(y / H) * 100}%`,
        width: `${(w / W) * 100}%`,
        height: `${(h / H) * 100}%`,
        ...(delay ? { animationDelay: `${delay}s` } : null),
      }}
      focusable="false"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export default function CoffeebayScene({
  lit,
  done,
  total,
  finished,
}: {
  lit: number;
  done: number;
  total: number;
  finished: boolean;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [still, setStill] = useState(false);

  // Everything holds still when the tab is hidden or the scene is scrolled out of view.
  useEffect(() => {
    const el = ref.current;
    let offscreen = false;
    let hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    const apply = () => setPaused(offscreen || hidden);
    const onVis = () => {
      hidden = document.visibilityState === 'hidden';
      apply();
    };
    document.addEventListener('visibilitychange', onVis);
    let io: IntersectionObserver | null = null;
    if (el && typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver(([e]) => {
        offscreen = !e?.isIntersecting;
        apply();
      });
      io.observe(el);
    }
    apply();
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      io?.disconnect();
    };
  }, []);

  // Twelve seconds after the finish, every loop stops.
  useEffect(() => {
    if (!finished) {
      setStill(false);
      return;
    }
    const h = setTimeout(() => setStill(true), 12_000);
    return () => clearTimeout(h);
  }, [finished]);

  return (
    <div
      ref={ref}
      className="cb-scene"
      aria-hidden="true"
      data-testid="coffeebay-scene"
      data-finished={finished ? 'true' : 'false'}
      data-still={still ? 'true' : 'false'}
      data-paused={paused ? 'true' : 'false'}
      data-lit={lit}
    >
      <svg className="cb-art" viewBox="0 0 720 300" focusable="false">
        <rect className="cb-wall" width="720" height="300" />
        <rect className="cb-floor" y="252" width="720" height="48" />

        {/* hanging sign */}
        <line x1="440" y1="70" x2="440" y2="84" stroke="currentColor" strokeWidth="2" />
        <line x1="530" y1="70" x2="530" y2="84" stroke="currentColor" strokeWidth="2" />
        <rect x="408" y="84" width="152" height="48" rx="8" className="cb-sign" />
        <circle cx="424" cy="100" r="4.5" className="cb-light" />
        <text x="436" y="118" fontSize="25" className="cb-sign-text">
          {SCENE_NAME}
        </text>

        {/* chalk board */}
        <rect x="582" y="62" width="122" height="84" rx="6" className="cb-wood" />
        <rect x="588" y="68" width="110" height="72" rx="3" className="cb-board" />
        <text x="643" y="90" fontSize="10" textAnchor="middle" className="cb-chalk">
          {finished ? t('All ready') : t('Now brewing')}
        </text>
        <text x="643" y="116" fontSize="19" textAnchor="middle" className="cb-chalk">
          {done}/{total}
        </text>
        <text x="643" y="131" fontSize="10" textAnchor="middle" className="cb-chalk">
          {t('CVs')}
        </text>

        {/* the regular at the counter: body, neck and the resting arm (head, arm, mug and steam move) */}
        <g className="cb-person">
          <path d="M442 212c0-21 10-31 28-31s28 10 28 31z" className="cb-knit" />
          <rect x="465" y="171" width="10" height="13" rx="4" className="cb-skin" />
          <path d="M449 187l-2 15 12 2" className="cb-knit-arm" />
          <circle cx="461" cy="204" r="4.6" className="cb-skin" />
          <path d="M489 187l2 14" className="cb-knit-arm" />
          {/* the parallax mark on the jumper: two viewpoints and one star */}
          <path
            d="M463 206l7-11 7 11"
            fill="none"
            stroke="var(--c-card)"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="470" cy="195" r="1.9" fill="var(--c-card)" />
        </g>

        {/* counter */}
        <rect x="0" y="212" width="720" height="40" className="cb-counter" />
        <rect x="0" y="208" width="720" height="8" className="cb-wood" />

        {/* plant */}
        <g className="cb-plant">
          <path d="M664 208l4-26h24l4 26z" className="cb-wood" />
          <path d="M680 182c-14-6-18-22-10-34 10 6 14 20 10 34z" className="cb-leaf" />
          <path d="M680 182c10-8 22-8 28-22-14-2-26 8-28 22z" className="cb-leaf" />
          <path d="M680 182c-2-14 4-26 16-32 2 14-4 26-16 32z" className="cb-leaf" />
        </g>
      </svg>

      {/* The moving parts, each on its own layer (see Part). */}
      <Part box={[404, 0, 28, 55]} className="cb-lamp">
        <line x1="418" y1="0" x2="418" y2="26" stroke="currentColor" strokeWidth="2" />
        <path d="M404 46h28l-6-20h-16z" className="cb-sign" />
        <circle cx="418" cy="50" r="5" className="cb-light" />
      </Part>
      <Part box={[538, 0, 28, 47]} className="cb-lamp-2">
        <line x1="552" y1="0" x2="552" y2="18" stroke="currentColor" strokeWidth="2" />
        <path d="M538 38h28l-6-20h-16z" className="cb-sign" />
        <circle cx="552" cy="42" r="5" className="cb-light" />
      </Part>
      <Part box={[412, 88, 24, 24]} className="cb-glow">
        <circle cx="424" cy="100" r="12" />
      </Part>
      {/* Coffee break: she sips, leans into it, and the steam waits for the mug to come back. */}
      <Part box={[466, 172, 8, 8]} className="cb-head">
        <circle cx="470" cy="160" r="15" className="cb-skin" />
        <circle cx="455.2" cy="162" r="3" className="cb-skin" />
        <circle cx="484.8" cy="162" r="3" className="cb-skin" />
        <path
          d="M455 158c-1-12 6-18 15-18s16 5 15 18c-4-6-9-9-15-9s-11 3-15 9z"
          className="cb-hair"
        />
        <path d="M461 161q3-3.6 6 0M473 161q3-3.6 6 0M465 166q5 4 10 0" className="cb-face" />
        <circle cx="461.5" cy="166" r="2.4" className="cb-blush" />
        <circle cx="478.5" cy="166" r="2.4" className="cb-blush" />
      </Part>
      <Part box={[510, 160, 24, 28]} className="cb-steam">
        <path className="cb-steam-line" d="M516 186c-5-6 5-10 0-18" />
        <path className="cb-steam-line" d="M527 184c-5-6 5-10 0-16" />
      </Part>
      <Part box={[511, 188, 22, 20]} className="cb-mug">
        <path d="M533 192h4a5 5 0 0 1 0 10h-4" className="cb-mug-handle" />
        <rect x="511" y="188" width="22" height="20" rx="5" className="cb-cup" />
        <rect x="511" y="197" width="22" height="5" className="cb-mug-band" />
        <ellipse cx="522" cy="189" rx="9" ry="2.2" className="cb-coffee" />
      </Part>
      <Part box={[487, 197, 8, 8]} className="cb-arm">
        <path d="M491 201l23-2.2" className="cb-knit-arm" />
        <circle cx="517" cy="198.4" r="5" className="cb-skin" />
      </Part>
      <div className="cb-window">
        <Sky lit={lit} className="h-full w-full" />
        <span className="cb-drop" />
      </div>
    </div>
  );
}
