import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import {
  crossedMilestone,
  etaMinutes,
  getChime,
  isSlow,
  litStars,
  setChime,
  stableMinutes,
  type Progress,
  type Sample,
} from '../coffeebay-logic';
import { ensureAudio, playChime } from '../done-signals';
import { btnPrimary, btnSecondary } from '../ui';

const Scene = lazy(() => import('./CoffeebayScene'));

/**
 * The waiting screen (Stage 2, S2-FE12): the coffeebay scene and what the assistant says beside it.
 * It is the running state of the one batch panel, in the page flow (not a modal): the recruiter can
 * scroll, use the tabs or leave. The copy says "reading", never "queue", "model" or "scoring".
 */
export function Coffeebay({
  progress: pr,
  assistant,
  firstName,
  userId,
  focusGreeting,
  retryCount,
  retrying,
  detailsOpen,
  onRetry,
  onResults,
  onDetails,
  onHide,
  onClose,
}: {
  progress: Progress;
  assistant: string;
  firstName: string | null;
  userId: string;
  /** Focus goes to the greeting only after the start click. */
  focusGreeting: boolean;
  retryCount: number;
  retrying: boolean;
  detailsOpen: boolean;
  onRetry: () => void;
  onResults: () => void;
  onDetails: () => void;
  onHide: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const finished = pr.phase === 'finished';
  const head = useRef<HTMLHeadingElement>(null);
  const [chime, setChimeState] = useState(() => getChime(userId));
  const [now, setNow] = useState(() => Date.now());
  const [announce, setAnnounce] = useState('');
  const [minutes, setMinutes] = useState<number | null>(null);
  const samples = useRef<Sample[]>([]);
  const [lastChange, setLastChange] = useState(() => Date.now());
  const lastP = useRef(pr.p);

  useEffect(() => {
    if (focusGreeting) head.current?.focus();
  }, [focusGreeting]);

  // One sample per change in finished CVs; the time left comes from the last two minutes.
  useEffect(() => {
    const t0 = Date.now();
    const list = samples.current;
    if (list.length === 0 || list[list.length - 1]!.done !== pr.done) {
      list.push({ t: t0, done: pr.done });
      setLastChange(t0);
      if (list.length > 400) list.splice(0, list.length - 400);
    }
    setMinutes((m) => stableMinutes(m, etaMinutes(list, t0, pr.total)));
  }, [pr.done, pr.total]);

  // Slow detection and the shown minutes need a clock, but only while CVs are being read.
  useEffect(() => {
    if (finished) return;
    const h = setInterval(() => {
      const n = Date.now();
      setNow(n);
      setMinutes((m) => stableMinutes(m, etaMinutes(samples.current, n, pr.total)));
    }, 15_000);
    return () => clearInterval(h);
  }, [finished, pr.total]);

  // A polite announcement at 25, 50 and 75 %, then the finished headline.
  useEffect(() => {
    const m = crossedMilestone(lastP.current, pr.p);
    lastP.current = pr.p;
    if (m && !finished) setAnnounce(t('About {n}% of the CVs are read.', { n: m }));
  }, [pr.p, finished, t]);

  const name = firstName;
  const n = pr.total;
  const slow = !finished && pr.phase === 'reading' && isSlow(lastChange, now);

  const headline = finished
    ? pr.notSent === 0 && pr.failed === 0 && pr.ready === n
      ? name
        ? t('All {n} CVs are ready, {name}. Enjoy your coffee.', { n, name })
        : t('All {n} CVs are ready. Enjoy your coffee.', { n })
      : name
        ? t('{ready} of {total} CVs are ready, {name}.', { ready: pr.ready, total: n, name })
        : t('{ready} of {total} CVs are ready.', { ready: pr.ready, total: n })
    : n > 5
      ? name
        ? t('Hey {name}, go grab a coffee and relax.', { name })
        : t('Go grab a coffee and relax.')
      : name
        ? t('Hey {name}, this only takes a minute or two.', { name })
        : t('This only takes a minute or two.');

  const problems = finished
    ? [
        t('{n} analyzed', { n: pr.analyzed }),
        pr.needsLook > 0 ? t('{n} need a human look', { n: pr.needsLook }) : '',
        pr.failed > 0
          ? pr.failed === 1
            ? t('1 analysis failed')
            : t('{n} analyses failed', { n: pr.failed })
          : '',
        pr.notSent > 0
          ? pr.notSent === 1
            ? t('1 file was not sent')
            : t('{n} files were not sent', { n: pr.notSent })
          : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  const progressLine = [
    t('Sent {sent} of {total}', { sent: pr.sent, total: n }),
    t('Analyzed {done} of {total}', { done: pr.done, total: n }),
    !finished && !slow && minutes !== null
      ? t(minutes === 1 ? 'about {m} minute left' : 'about {m} minutes left', { m: minutes })
      : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <section
      aria-labelledby="coffeebay-head"
      data-testid="coffeebay"
      className="cb-panel grid gap-4 rounded-3xl border border-line bg-card p-3 sm:p-4 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] md:items-center"
    >
      <Suspense fallback={<div className="cb-scene" aria-hidden="true" />}>
        <Scene lit={litStars(pr.p)} done={pr.done} total={n} finished={finished} />
      </Suspense>

      <div className="space-y-3">
        <h2
          id="coffeebay-head"
          ref={head}
          tabIndex={-1}
          className="text-lg font-bold leading-snug tracking-tight outline-none"
        >
          {headline}
        </h2>
        {!finished && (
          <p className="text-sm text-ink-2">
            {t('{assistant} is reading your {n} CVs for you.', { assistant, n })}
          </p>
        )}
        {finished && problems && <p className="text-sm text-ink-2">{problems}</p>}

        {pr.phase === 'sending' && (
          <p className="text-sm text-ink-2">
            {t('Sending files: {sent} of {total}. Keep this page open until they are all sent.', {
              sent: pr.sent,
              total: n,
            })}
          </p>
        )}
        {pr.phase === 'reading' && !slow && (
          <p className="text-sm text-ink-2">
            {t('All files are sent. You can close this page: {assistant} keeps reading.', {
              assistant,
            })}
          </p>
        )}
        {slow && (
          <p className="text-sm text-ink-2">
            {t(
              'This is taking a little longer than usual. {assistant} keeps going, and you can leave this page.',
              { assistant },
            )}
          </p>
        )}

        <div>
          <p className="text-sm font-medium tabular-nums">{progressLine}</p>
          <progress
            className="mt-1 h-2 w-full overflow-hidden rounded-full accent-[var(--c-accent)]"
            max={n}
            value={Math.round(pr.p * n)}
            aria-label={t('Progress')}
          />
        </div>

        <div role="status" aria-live="polite" className="sr-only">
          {finished ? headline : announce}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={`${btnPrimary} min-h-11`} onClick={onResults}>
            {finished ? t('See results') : t('See results so far')}
          </button>
          {retryCount > 0 && (
            <button
              type="button"
              className={`${btnSecondary} min-h-11`}
              disabled={retrying}
              onClick={onRetry}
            >
              {t('Retry failed ({n})', { n: retryCount })}
            </button>
          )}
          <button
            type="button"
            className={`${btnSecondary} min-h-11`}
            aria-expanded={detailsOpen}
            onClick={onDetails}
          >
            {t('Details')}
          </button>
          <button
            type="button"
            className="min-h-11 px-2 text-sm text-link underline"
            onClick={finished ? onClose : onHide}
          >
            {finished ? t('Close') : t('Hide')}
          </button>
        </div>

        <label className="flex min-h-11 items-center gap-2 text-sm text-ink-2">
          <input
            type="checkbox"
            checked={chime}
            onChange={(e) => {
              const on = e.target.checked;
              setChime(userId, on);
              setChimeState(on);
              if (on) {
                ensureAudio();
                playChime(); // a preview, once
              }
            }}
          />
          {t('Soft sound when ready')}
        </label>
      </div>
    </section>
  );
}
