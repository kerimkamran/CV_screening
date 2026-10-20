import { useEffect, useRef, useState } from 'react';
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

        {/* pendant lamps */}
        <g className="cb-lamp">
          <line x1="418" y1="0" x2="418" y2="26" stroke="currentColor" strokeWidth="2" />
          <path d="M404 46h28l-6-20h-16z" className="cb-sign" />
          <circle cx="418" cy="50" r="5" className="cb-light" />
        </g>
        <g className="cb-lamp cb-lamp-2">
          <line x1="552" y1="0" x2="552" y2="18" stroke="currentColor" strokeWidth="2" />
          <path d="M538 38h28l-6-20h-16z" className="cb-sign" />
          <circle cx="552" cy="42" r="5" className="cb-light" />
        </g>

        {/* hanging sign */}
        <line x1="440" y1="70" x2="440" y2="84" stroke="currentColor" strokeWidth="2" />
        <line x1="530" y1="70" x2="530" y2="84" stroke="currentColor" strokeWidth="2" />
        <rect x="408" y="84" width="152" height="48" rx="8" className="cb-sign" />
        <circle cx="424" cy="100" r="12" className="cb-glow" />
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

        {/* counter and cup */}
        <rect x="0" y="212" width="720" height="40" className="cb-counter" />
        <rect x="0" y="208" width="720" height="8" className="cb-wood" />
        <g>
          <path className="cb-steam" d="M436 176c-7-8 7-14 0-24" />
          <path
            className="cb-steam"
            d="M452 176c-7-8 7-14 0-24"
            style={{ animationDelay: '1.6s' }}
          />
          <path
            className="cb-steam"
            d="M468 176c-7-8 7-14 0-24"
            style={{ animationDelay: '3.2s' }}
          />
          <path d="M424 182h56v8a24 24 0 0 1-24 22h-8a24 24 0 0 1-24-22z" className="cb-cup" />
          <path
            d="M480 188h8a8 8 0 0 1 0 16h-10"
            fill="none"
            stroke="var(--c-edge)"
            strokeWidth="2"
          />
          {/* the parallax mark on the cup: two viewpoints and one star */}
          <path
            d="M441 204l11-18 11 18"
            fill="none"
            stroke="var(--c-brand)"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="452" cy="186" r="3" className="cb-light" />
        </g>

        {/* plant */}
        <g className="cb-plant">
          <path d="M664 208l4-26h24l4 26z" className="cb-wood" />
          <path d="M680 182c-14-6-18-22-10-34 10 6 14 20 10 34z" className="cb-leaf" />
          <path d="M680 182c10-8 22-8 28-22-14-2-26 8-28 22z" className="cb-leaf" />
          <path d="M680 182c-2-14 4-26 16-32 2 14-4 26-16 32z" className="cb-leaf" />
        </g>
      </svg>

      <div className="cb-window">
        <Sky lit={lit} className="h-full w-full" />
        <span className="cb-drop" />
        <span className="cb-drop" />
        <span className="cb-drop" />
        <span className="cb-drop" />
      </div>
    </div>
  );
}
