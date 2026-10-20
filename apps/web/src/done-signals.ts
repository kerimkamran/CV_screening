import { progressOf, ringIcon, titleFor, getChime } from './coffeebay-logic';
import { tr } from './i18n';
import { getRun, watchBatch, type BatchStatus } from './intake';

/**
 * The "your CVs are ready" signals (Stage 2, S2-FE13): tab title, favicon, a desktop notification
 * and a soft chime. They live in the main bundle and follow the batch, not the screen: they keep
 * working when the waiting scene is hidden, on other pages of the app, and in a background tab.
 *
 * Nothing here is shown to anyone but the person who started the batch, and no text names a
 * candidate, a file or the vacancy.
 */

export interface SignalContext {
  vacancyId: string;
  batchId: string;
  userId: string;
  /** The SenAI name from Admin; "parallax" when SenAI is switched off. */
  assistant: string;
}

const ASKED_KEY = 'cv-coffeebay-asked';
const RESTORE_AFTER_MS = 10_000;

const isPhone = () =>
  typeof navigator !== 'undefined' &&
  (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));

// ---------------------------------------------------------------------------- the first click

/**
 * Call synchronously inside the start click: browsers only allow a permission prompt and an audio
 * unlock while the click is still "fresh". Asks for notifications once on a desktop (never again
 * after "no", never on a phone) and wakes the audio engine when the chime is switched on.
 */
export function prepareSignals(userId: string): void {
  try {
    if (
      typeof Notification !== 'undefined' &&
      Notification.permission === 'default' &&
      !isPhone() &&
      localStorage.getItem(ASKED_KEY) !== '1'
    ) {
      localStorage.setItem(ASKED_KEY, '1');
      void Notification.requestPermission();
    }
  } catch {
    /* no notifications here: the title and icon still work */
  }
  if (getChime(userId)) ensureAudio();
}

// ---------------------------------------------------------------------------- the chime

let audio: AudioContext | null = null;
export function ensureAudio(): AudioContext | null {
  try {
    if (!audio) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      audio = new Ctor();
    }
    if (audio.state === 'suspended') void audio.resume();
    return audio;
  } catch {
    return null;
  }
}

/** E5 then B5, about -24 dBFS, 1.6 s in all. Synthesised, so there is no audio file to load. */
export function playChime(): void {
  const ctx = ensureAudio();
  if (!ctx) return;
  const t0 = ctx.currentTime + 0.02;
  for (const [freq, at] of [
    [659.25, 0],
    [987.77, 0.45],
  ] as const) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const start = t0 + at;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.063, start + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.15);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 1.2);
  }
}

// ---------------------------------------------------------------------------- title and icon

let originalTitle: string | null = null;
let originalIcon: string | null = null;
let restoreTimer: ReturnType<typeof setTimeout> | null = null;
let restoreOnVisible: (() => void) | null = null;

function iconLink(): HTMLLinkElement | null {
  if (typeof document === 'undefined') return null;
  let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  return link;
}

function remember() {
  if (originalTitle === null) originalTitle = document.title;
  if (originalIcon === null) originalIcon = iconLink()?.getAttribute('href') ?? '';
}

function show(title: string, icon: string) {
  remember();
  if (document.title !== title) document.title = title;
  const link = iconLink();
  if (link && link.getAttribute('href') !== icon) {
    link.type = 'image/svg+xml';
    link.setAttribute('href', icon);
  }
}

/** Put the title and icon back as they were. */
export function restoreTitle(): void {
  if (restoreTimer) clearTimeout(restoreTimer);
  restoreTimer = null;
  if (restoreOnVisible) document.removeEventListener('visibilitychange', restoreOnVisible);
  restoreOnVisible = null;
  if (originalTitle !== null) document.title = originalTitle;
  const link = iconLink();
  if (link && originalIcon !== null) {
    if (originalIcon) link.setAttribute('href', originalIcon);
    else link.removeAttribute('href');
  }
}

/** After the finish: restore 10 s after the tab is visible (at once on the clock if it already is). */
function restoreSoon() {
  const arm = () => {
    if (restoreTimer) clearTimeout(restoreTimer);
    restoreTimer = setTimeout(restoreTitle, RESTORE_AFTER_MS);
  };
  if (document.visibilityState === 'visible') return arm();
  restoreOnVisible = () => {
    if (document.visibilityState !== 'visible') return;
    document.removeEventListener('visibilitychange', restoreOnVisible!);
    restoreOnVisible = null;
    arm();
  };
  document.addEventListener('visibilitychange', restoreOnVisible);
}

// ---------------------------------------------------------------------------- tracking a batch

interface Tracked {
  stop: () => void;
  sawActive: boolean;
  finished: boolean;
}
const tracked = new Map<string, Tracked>();

function notify(ctx: SignalContext, ready: number, total: number) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (isPhone()) return;
    if (document.visibilityState === 'visible' && document.hasFocus()) return;
    const n = new Notification(
      tr('{assistant}: your CVs are ready', { assistant: ctx.assistant }),
      {
        body: tr('{ready} of {total} CVs are ready to review', { ready, total }),
        tag: `cv-batch-${ctx.batchId}`,
      },
    );
    n.onclick = () => {
      window.focus();
      window.location.hash = `#/vacancies/${ctx.vacancyId}/candidates`;
      n.close();
    };
  } catch {
    /* a notification that cannot be shown is not an error */
  }
}

function onStatus(ctx: SignalContext, t: Tracked, s: BatchStatus) {
  if (t.finished) return;
  const pr = progressOf(s, getRun(ctx.vacancyId));
  if (pr.phase !== 'finished') {
    t.sawActive = true;
    show(titleFor(pr.done, pr.total, false, tr), ringIcon(pr.p, false));
    return;
  }
  t.finished = true;
  t.stop();
  // A batch that was already finished when this page opened is old news: no title, no sound.
  if (!t.sawActive) return;
  show(titleFor(pr.done, pr.total, true, tr), ringIcon(1, true));
  notify(ctx, pr.ready, pr.total);
  if (getChime(ctx.userId)) playChime();
  restoreSoon();
}

/**
 * Follow a batch until it finishes. Safe to call again for the same batch (a return visit): it does
 * nothing the second time. The follower lives in the batch watcher, so it does not depend on any
 * component being on screen.
 */
export function trackBatch(ctx: SignalContext): void {
  if (tracked.has(ctx.batchId)) return;
  const t: Tracked = { stop: () => undefined, sawActive: false, finished: false };
  tracked.set(ctx.batchId, t);
  t.stop = watchBatch(ctx.batchId, (s) => onStatus(ctx, t, s));
  if (t.finished) t.stop(); // it was already finished on the first answer
}

/** Close, sign-out, or a new batch: stop following and put the tab back. */
export function stopTracking(batchId?: string): void {
  for (const [id, t] of tracked) {
    if (batchId && id !== batchId) continue;
    if (!t.finished) t.stop();
    tracked.delete(id);
  }
  if (!batchId || tracked.size === 0) restoreTitle();
}

export function resetSignalsForTests(): void {
  for (const t of tracked.values()) if (!t.finished) t.stop();
  tracked.clear();
  restoreTitle();
  originalTitle = null;
  originalIcon = null;
  audio = null;
}
