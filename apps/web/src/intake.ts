import { useCallback, useSyncExternalStore } from 'react';
import { MAX_ANNOUNCE_FILES, type BatchSource, type CvStatus, type UploadCode } from '@cv/shared';
import { api, ApiError } from './api';
import { errMsg } from './ui';

/**
 * Sending CVs to a vacancy (Stage 2, S2-FE7 and S2-FE8).
 *
 * 1. `checkFiles` looks at every file before anything is sent: wrong type, empty, too big, the old
 *    .doc format. Same-name files with different content are all kept.
 * 2. `startBatch` announces at most 500 files (the slice of `announceSlice`: at most the room left,
 *    a ZIP costs one slot; S3-UP-01), then sends them one file per request, three at a time, at most
 *    one of them a ZIP (S3-UP-06). A network error, a 5xx, a 429 or a `server_error` answer is
 *    retried once after 2 s; a 401 pauses the queue until the person signs in again; a cancelled
 *    send is never retried. One failing file never stops the others.
 * 2b. `cancelRun` ("Stop sending files", S3-UP-05) aborts the sends in flight, drops the waiting
 *    files and tells the server, which closes every open item as cancelled.
 * 3. The server keeps the status of every file. `watchBatch` polls only the counts (every 4 s while
 *    the tab is visible, 15 s hidden) and stops when nothing is left to wait for. Everything on the
 *    screen about a batch comes from there, so a reload or a second device shows the same picture.
 */

// ---------------------------------------------------------------------------- the check

export interface Limits {
  maxFileMb: number;
  maxZipMb: number;
}
export const DEFAULT_LIMITS: Limits = { maxFileMb: 10, maxZipMb: 100 };
/** Up to this many CVs per upload is recommended; more is allowed with a warning. */
export const RECOMMENDED_PER_UPLOAD = 100;
export const FOLDER_LIMIT = { files: 5000, depth: 8 };

export interface Checked {
  key: string;
  file: File;
  name: string;
  /** Folder path when the file came from a folder, else the name. */
  path: string;
  size: number;
  /** Why the file will not be sent. Empty means it is ready. */
  problem?: { code: UploadCode; n?: number };
}

export const isZip = (f: { name: string }) => /\.zip$/i.test(f.name);

/**
 * Which ready rows one upload announces (S3-UP-01). ZIP rows: the first min(ZIPs, 500). Loose rows:
 * the first min(loose, room, 500 - ZIP slots). List order is kept (answers map back by position).
 * A ZIP always costs one slot; its "about n CVs" estimate never changes the slice. `room` is null
 * when the intake information could not be read: then only the 500 cap applies (the server stays
 * the authority). What is left out is said before the click, never blocking it:
 * - `beyondRoom`: loose rows past the room ("Vacancy full" on each row);
 * - `beyondLimit`: rows past the 500-per-upload cap ("Not in this upload" on each row).
 */
export function announceSlice<T extends { name: string }>(
  ready: T[],
  room: number | null,
  max = MAX_ANNOUNCE_FILES,
): { announced: T[]; beyondRoom: T[]; beyondLimit: T[] } {
  const zips = ready.filter(isZip);
  const zipSlots = Math.min(zips.length, max);
  const looseCap = max - zipSlots;
  const announced: T[] = [];
  const beyondRoom: T[] = [];
  const beyondLimit: T[] = [];
  let z = 0;
  let loose = 0;
  for (const r of ready) {
    if (isZip(r)) {
      if (z++ < zipSlots) announced.push(r);
      else beyondLimit.push(r);
      continue;
    }
    const i = loose++;
    if (room !== null && i >= room) beyondRoom.push(r);
    else if (i >= looseCap) beyondLimit.push(r);
    else announced.push(r);
  }
  return { announced, beyondRoom, beyondLimit };
}
export const pathOf = (f: File) =>
  (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
/** Operating-system litter inside a dropped folder: never worth a line. */
export const isLitter = (f: { name: string }) =>
  /^(\.|~\$|Thumbs\.db$|desktop\.ini$)/i.test(f.name);
/** Two different files can share a name and a size; the folder and the time tell them apart. */
export const fileKey = (f: File) => `${pathOf(f)}|${f.size}|${f.lastModified}`;

export function problemOf(f: File, limits: Limits): Checked['problem'] {
  if (/\.doc$/i.test(f.name)) return { code: 'old_word_format' };
  if (!/\.(pdf|docx|txt|md|zip)$/i.test(f.name)) return { code: 'wrong_type' };
  if (f.size === 0) return { code: 'empty' };
  const mb = isZip(f) ? limits.maxZipMb : limits.maxFileMb;
  if (f.size > mb * 1024 * 1024) return { code: 'too_large', n: mb };
  return undefined;
}

/** Look at files as they are added. Returns the new rows and how many exact repeats were left out. */
export function checkFiles(
  list: File[],
  limits: Limits,
  have: Set<string> = new Set(),
): { added: Checked[]; ignored: number; repeated: number } {
  const seen = new Set(have);
  const added: Checked[] = [];
  let ignored = 0;
  let repeated = 0;
  for (const f of list) {
    if (isLitter(f)) {
      ignored++;
      continue;
    }
    const key = fileKey(f);
    if (seen.has(key)) {
      repeated++;
      continue;
    }
    seen.add(key);
    added.push({
      key,
      file: f,
      name: f.name,
      path: pathOf(f),
      size: f.size,
      problem: problemOf(f, limits),
    });
  }
  return { added, ignored, repeated };
}

/** "136 CVs, 182 MB": the numbers shown above the list. */
export function summarize(rows: Checked[]) {
  const ready = rows.filter((r) => !r.problem);
  return {
    files: rows.length,
    bytes: rows.reduce((s, r) => s + r.size, 0),
    ready: ready.length,
    problems: rows.length - ready.length,
  };
}

/** Folders dropped on the page: walk them, keep the files, say what was left out. */
export async function filesFromDrop(
  dt: DataTransfer,
): Promise<{ files: File[]; truncated: boolean }> {
  const items = Array.from(dt.items ?? []);
  const entries = items
    .map((i) => (typeof i.webkitGetAsEntry === 'function' ? i.webkitGetAsEntry() : null))
    .filter((e): e is FileSystemEntry => !!e);
  if (!entries.some((e) => e.isDirectory)) return { files: Array.from(dt.files), truncated: false };
  const out: File[] = [];
  let truncated = false;
  const walk = async (e: FileSystemEntry, depth: number, parent: string): Promise<void> => {
    if (out.length >= FOLDER_LIMIT.files || depth > FOLDER_LIMIT.depth) {
      truncated = true;
      return;
    }
    if (e.isFile) {
      const f = await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej));
      // A dropped file has no relative path of its own: give it its folder, so same names stay apart.
      if (parent && !pathOf(f).includes('/')) {
        Object.defineProperty(f, 'webkitRelativePath', { value: `${parent}/${f.name}` });
      }
      out.push(f);
    } else if (e.isDirectory) {
      const reader = (e as FileSystemDirectoryEntry).createReader();
      const path = parent ? `${parent}/${e.name}` : e.name;
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) =>
          reader.readEntries(res, rej),
        );
        if (batch.length === 0) break;
        for (const c of batch) await walk(c, depth + 1, path);
      }
    }
  };
  for (const e of entries) await walk(e, 0, '');
  return { files: out, truncated };
}

/** Folder picking is not available on iPhone and iPad browsers: do not offer a dead button. */
export function folderPickingSupported(): boolean {
  if (typeof navigator === 'undefined') return true;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return !ios;
}

// ---------------------------------------------------------------------------- server shapes

export interface IntakeInfo {
  used: number;
  limit: number;
  maxFileMb: number;
  maxZipMb: number;
  accepts: string[];
  latestBatch: LatestBatch | null;
  /** Stage 3 (S3-INT-05): an Oracle import that is still running; its batch is null while it lists. */
  activeImport?: { runId: string; state: string; phase: string; batchId: string | null } | null;
}
export interface LatestBatch {
  id: string;
  createdAt: string;
  createdBy: string;
  fileCount: number;
  mine: boolean;
  source?: BatchSource;
}
export interface BatchItemView {
  itemId: string;
  parentItemId: string | null;
  position: number;
  filename: string;
  clientPath: string | null;
  size: number;
  status: CvStatus;
  code: string | null;
  message: string | null;
  documentId: string | null;
  container: boolean;
}
export interface BatchStatus {
  batch: {
    id: string;
    vacancyId: string;
    createdAt: string;
    createdBy: string;
    fileCount: number;
    mine: boolean;
    /** Set once someone pressed "Stop sending files" (S3-UP-05). */
    cancelledAt?: string | null;
    /** Stage 3 (S3-INT-05): a batch made by the Oracle import, or by a browser upload. */
    source?: BatchSource;
  };
  lastReceivedAt: string | null;
  counts: {
    upload: {
      total: number;
      received: number;
      notReceived: number;
      vacancyFull: number;
      rejected: number;
      duplicate: number;
      cancelled?: number;
    };
    byStatus: Record<CvStatus, number>;
  };
  items?: BatchItemView[];
}

export const fetchIntakeInfo = (vacancyId: string) =>
  api.get<IntakeInfo>(`/vacancies/${vacancyId}/intake`);

// ---------------------------------------------------------------------------- sending

export interface RunItem {
  itemId: string;
  position: number;
  name: string;
  path: string;
  size: number;
  file: File | null;
  /** Where this file is in THIS tab. The server's own status comes from the batch. */
  client: 'waiting' | 'sending' | 'sent' | 'failed' | 'stopped';
  error: string;
}
export interface Run {
  vacancyId: string;
  batchId: string;
  items: RunItem[];
  /** A 401 paused the queue; `resumeRun` continues it. */
  paused: boolean;
  /** Who was signed in when the 401 paused it: only that person's sign-in continues the queue. */
  pausedFor?: string | null;
  startedAt: number;
  /** Aborts the sends in flight ("Stop sending files"). */
  controller?: AbortController;
  /** After a stop: the server was told (`done`) or could not be told (`failed`). */
  stop?: { state: 'done' | 'failed'; sent: number; notSent: number } | null;
}

/** The person signed in right now (set by `personSignedIn`). */
let signedIn: string | null = null;

const LANES = 3;
/** At most this many ZIPs in flight at once (S3-UP-06): the server reads one ZIP at a time anyway. */
const ZIP_LANES = 1;
const RETRY_AFTER_MS = 2000;
const runs = new Map<string, Run>();
const runListeners = new Set<() => void>();
const emitRuns = () => runListeners.forEach((l) => l());
let wake: { release: () => Promise<void> } | null = null;

/** The files this tab is still holding for a vacancy (empty once everything is sent or failed). */
export const runActive = (r: Run | null | undefined) =>
  !!r && r.items.some((i) => i.client === 'waiting' || i.client === 'sending');

// Files still being sent live only in this tab: reloading or closing it now would lose them, so the
// browser asks first (UP-05).
if (typeof window !== 'undefined')
  window.addEventListener('beforeunload', (e) => {
    if ([...runs.values()].some(runActive)) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

export function getRun(vacancyId: string): Run | null {
  return runs.get(vacancyId) ?? null;
}

// ------------------------------------------------------------------ an import's batch (S3-INT-14)

/**
 * A batch the server made for an Oracle import: the strip adopts it when the run gets one, so the
 * batch panel shows it at once, with no reload. Same store pattern as the runs.
 */
const adopted = new Map<string, string>();
const adoptedListeners = new Set<() => void>();
export function adoptBatch(vacancyId: string, batchId: string | null) {
  if (batchId === (adopted.get(vacancyId) ?? null)) return;
  if (batchId) adopted.set(vacancyId, batchId);
  else adopted.delete(vacancyId);
  adoptedListeners.forEach((l) => l());
}
export function useAdopted(vacancyId: string): string | null {
  return useSyncExternalStore(
    (l) => {
      adoptedListeners.add(l);
      return () => adoptedListeners.delete(l);
    },
    () => adopted.get(vacancyId) ?? null,
  );
}

export function useRun(vacancyId: string): Run | null {
  return useSyncExternalStore(
    (l) => {
      runListeners.add(l);
      return () => runListeners.delete(l);
    },
    () => runs.get(vacancyId) ?? null,
  );
}

/** Replace the run with a new object, so React sees the change. */
function touch(run: Run) {
  runs.set(run.vacancyId, { ...run, items: run.items.map((i) => ({ ...i })) });
}

async function holdScreenAwake() {
  try {
    const wl = (
      navigator as unknown as {
        wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> };
      }
    ).wakeLock;
    if (wl && !wake) wake = await wl.request('screen');
  } catch {
    /* not supported, or refused: sending still works */
  }
}
function letScreenSleep() {
  void wake?.release().catch(() => undefined);
  wake = null;
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';
const retryable = (e: unknown) =>
  !isAbort(e) && (!(e instanceof ApiError) || e.status >= 500 || e.status === 429);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Raised when a file was answered `server_error` twice (S3-UP-03): "Could not send", with Retry. */
export const SERVER_ERROR_TEXT = 'The server could not process this file';

type UploadAnswer = { results?: { code?: string | null }[] };
/** A 2xx answer without results counts as sent (the L1 mock answers `{ ok: true }`). */
const serverError = (a: UploadAnswer) => a.results?.[0]?.code === 'server_error';

async function sendOne(vacancyId: string, item: RunItem, signal?: AbortSignal): Promise<void> {
  const url = `/vacancies/${vacancyId}/documents?item=${item.itemId}`;
  const stopped = () => {
    if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
  };
  try {
    const first = await api.upload<UploadAnswer>(url, [item.file!], signal);
    if (!serverError(first)) return;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) throw e;
    if (!retryable(e)) throw e;
  }
  // One retry after 2 s; a stop before or during the wait means no retry at all.
  stopped();
  await sleep(RETRY_AFTER_MS);
  stopped();
  const again = await api.upload<UploadAnswer>(url, [item.file!], signal);
  if (serverError(again)) throw new Error(SERVER_ERROR_TEXT);
}

function pump(vacancyId: string) {
  const run = runs.get(vacancyId);
  if (!run || run.paused) return;
  const live = () => runs.get(vacancyId)!;
  const sendingNow = () => live().items.filter((i) => i.client === 'sending');
  while (sendingNow().length < LANES) {
    const zipBusy = sendingNow().filter((i) => isZip(i)).length >= ZIP_LANES;
    const next = live().items.find(
      (i) => i.client === 'waiting' && i.file && !(zipBusy && isZip(i)),
    );
    if (!next) break;
    const id = next.itemId;
    const set = (patch: Partial<RunItem>, extra?: Partial<Run>) => {
      // The run may be gone meanwhile (cleared, or a test reset): nothing to update then.
      const cur = runs.get(vacancyId);
      if (!cur) return;
      cur.items = cur.items.map((i) => (i.itemId === id ? { ...i, ...patch } : i));
      Object.assign(cur, extra);
      touch(cur);
      emitRuns();
    };
    set({ client: 'sending' });
    const signal = live().controller?.signal;
    void (async () => {
      try {
        await sendOne(vacancyId, next, signal);
        set({ client: 'sent', error: '', file: null });
      } catch (e) {
        if (isAbort(e) || signal?.aborted) set({ client: 'stopped', error: '', file: null });
        else if (e instanceof ApiError && e.status === 401)
          set({ client: 'waiting' }, { paused: true, pausedFor: signedIn });
        else set({ client: 'failed', error: errMsg(e) });
      }
      const after = runs.get(vacancyId);
      if (!after) return;
      if (!runActive(after)) letScreenSleep();
      kickBatch(after.batchId);
      pump(vacancyId);
    })();
  }
}

/**
 * Announce the ready files (at most the slice of `announceSlice`) and start sending them. Resolves
 * as soon as the batch exists, with its id and how many files were left out, so the waiting screen
 * can open at once; the files go up in the background. A 413 `TOO_MANY_FILES` (a stale tab or a
 * script) throws: the caller shows the sentence and keeps the files listed.
 */
export async function startBatch(
  vacancyId: string,
  rows: Checked[],
  room: number | null = null,
): Promise<{ batchId: string; sent: number; leftOut: number }> {
  const slice = announceSlice(
    rows.filter((r) => !r.problem),
    room,
  );
  const ready = slice.announced;
  const made = await api.post<{
    batchId: string;
    items: { itemId: string; position: number; pre?: { outcome: string; code: string } }[];
  }>(`/vacancies/${vacancyId}/upload-batches`, {
    files: ready.map((r) => ({
      name: r.name,
      path: r.path !== r.name ? r.path : undefined,
      size: r.size,
    })),
  });
  const items: RunItem[] = made.items.map((it) => {
    const r = ready[it.position]!;
    // Files the server already marked (full vacancy) are not sent now.
    return {
      itemId: it.itemId,
      position: it.position,
      name: r.name,
      path: r.path,
      size: r.size,
      file: it.pre ? null : r.file,
      client: it.pre ? 'sent' : 'waiting',
      error: '',
    };
  });
  runs.set(vacancyId, {
    vacancyId,
    batchId: made.batchId,
    items,
    paused: false,
    startedAt: Date.now(),
    controller: new AbortController(),
    stop: null,
  });
  emitRuns();
  void holdScreenAwake();
  pump(vacancyId);
  kickBatch(made.batchId);
  return {
    batchId: made.batchId,
    sent: ready.length,
    leftOut: slice.beyondRoom.length + slice.beyondLimit.length,
  };
}

/** Mark this tab's run as stopped: abort the sends in flight and drop the waiting files. */
function stopLocally(run: Run) {
  run.controller?.abort();
  run.items = run.items.map((i) =>
    i.client === 'waiting' || i.client === 'sending' || (i.client === 'failed' && i.file)
      ? { ...i, client: 'stopped', file: null, error: '' }
      : i,
  );
}

/**
 * "Stop sending files" (S3-UP-05): one click, no confirm step. First this tab aborts the requests in
 * flight and drops the waiting files, then the server is told, so it closes every open item of the
 * batch as cancelled (also those another tab was sending). Files already sent stay and are analyzed.
 * If the call fails, `stop.state` is `failed` and `cancelRun` can be called again (Retry).
 */
export async function cancelRun(vacancyId: string): Promise<void> {
  const run = runs.get(vacancyId);
  if (!run) return;
  const sent = run.items.filter((i) => i.client === 'sent').length;
  const notSent = run.items.filter((i) => i.client !== 'sent').length;
  stopLocally(run);
  touch(run);
  emitRuns();
  letScreenSleep();
  const set = (state: 'done' | 'failed') => {
    const cur = runs.get(vacancyId);
    if (!cur) return;
    cur.stop = { state, sent, notSent };
    touch(cur);
    emitRuns();
  };
  try {
    await api.post(`/upload-batches/${run.batchId}/cancel`);
    set('done');
  } catch {
    set('failed');
  }
  kickBatch(run.batchId);
}

/** Tell the server again after a stop whose cancel call failed (the Retry of `stop.sending.failed`). */
export async function retryCancel(vacancyId: string): Promise<void> {
  const run = runs.get(vacancyId);
  if (!run?.stop) return;
  const keep = run.stop;
  try {
    await api.post(`/upload-batches/${run.batchId}/cancel`);
    run.stop = { ...keep, state: 'done' };
  } catch {
    run.stop = { ...keep, state: 'failed' };
  }
  touch(run);
  emitRuns();
  kickBatch(run.batchId);
}

/** Continue a queue that stopped on a 401, after signing in again. */
export function resumeRun(vacancyId: string) {
  const run = runs.get(vacancyId);
  if (!run) return;
  run.paused = false;
  run.pausedFor = null;
  touch(run);
  emitRuns();
  void holdScreenAwake();
  pump(vacancyId);
  kickBatch(run.batchId);
}

/**
 * A person is signed in (at the start, or again after a 401 ended the session). The files this tab
 * still holds for them go on without being chosen again (SD-26); files held for another person are
 * dropped, because they belong to that person's batch.
 */
export function personSignedIn(userId: string) {
  signedIn = userId;
  for (const run of [...runs.values()]) {
    if (!run.paused) continue;
    if (run.pausedFor && run.pausedFor !== userId) clearRun(run.vacancyId);
    else resumeRun(run.vacancyId);
  }
}

/** Put the files that failed in THIS tab back in the queue. */
export function retryFailedFiles(vacancyId: string): number {
  const run = runs.get(vacancyId);
  if (!run) return 0;
  let n = 0;
  run.items = run.items.map((i) => {
    if (i.client === 'failed' && i.file) {
      n++;
      return { ...i, client: 'waiting', error: '' };
    }
    return i;
  });
  if (n) {
    touch(run);
    emitRuns();
    void holdScreenAwake();
    pump(vacancyId);
    kickBatch(run.batchId);
  }
  return n;
}

/** Put one failed file of THIS tab back in the queue (the Retry on its row). */
export function retryRunItem(vacancyId: string, itemId: string): boolean {
  const run = runs.get(vacancyId);
  const it = run?.items.find((i) => i.itemId === itemId);
  if (!run || !it || it.client !== 'failed' || !it.file) return false;
  it.client = 'waiting';
  it.error = '';
  touch(run);
  emitRuns();
  void holdScreenAwake();
  pump(vacancyId);
  kickBatch(run.batchId);
  return true;
}

/**
 * After a reload or on another device the files are gone from memory. The person chooses them
 * again; each chosen file is matched to an open item on name + size (the browser never hashes). When
 * several open items share both, one file goes to each item, and the server's content check catches
 * a true copy.
 */
export function matchOpenItems(
  open: { itemId: string; filename: string; size: number; position: number }[],
  files: File[],
): { matched: { itemId: string; position: number; file: File }[]; unmatched: File[] } {
  const pool = new Map<string, typeof open>();
  for (const o of [...open].sort((a, b) => a.position - b.position)) {
    const k = `${o.filename}|${o.size}`;
    pool.set(k, [...(pool.get(k) ?? []), o]);
  }
  const matched: { itemId: string; position: number; file: File }[] = [];
  const unmatched: File[] = [];
  for (const f of files) {
    const list = pool.get(`${f.name}|${f.size}`);
    const o = list?.shift();
    if (o) matched.push({ itemId: o.itemId, position: o.position, file: f });
    else unmatched.push(f);
  }
  return { matched, unmatched };
}

/** Send re-chosen files for the open items of a batch. */
export function attachFiles(
  vacancyId: string,
  batchId: string,
  pairs: { itemId: string; position: number; file: File }[],
) {
  const cur = runs.get(vacancyId);
  const run: Run =
    cur && cur.batchId === batchId
      ? cur
      : {
          vacancyId,
          batchId,
          items: [],
          paused: false,
          startedAt: Date.now(),
          controller: new AbortController(),
          stop: null,
        };
  for (const p of pairs) {
    const have = run.items.find((i) => i.itemId === p.itemId);
    const item: RunItem = {
      itemId: p.itemId,
      position: p.position,
      name: p.file.name,
      path: pathOf(p.file),
      size: p.file.size,
      file: p.file,
      client: 'waiting',
      error: '',
    };
    if (have) Object.assign(have, item);
    else run.items.push(item);
  }
  run.paused = false;
  touch(run);
  emitRuns();
  void holdScreenAwake();
  pump(vacancyId);
  kickBatch(batchId);
}

export function clearRun(vacancyId: string) {
  runs.delete(vacancyId);
  letScreenSleep();
  emitRuns();
}

// ---------------------------------------------------------------------------- the batch watcher

interface Watch {
  status: BatchStatus | null;
  error: string;
  timer: ReturnType<typeof setTimeout> | null;
  refs: number;
  items: number; // watchers that want the file list
  final: boolean;
  busy: boolean;
  callbacks: Set<(s: BatchStatus) => void>;
  listeners: Set<() => void>;
}
const watches = new Map<string, Watch>();
const VISIBLE_MS = 4000;
const HIDDEN_MS = 15000;
/**
 * A batch that is settled but still has files that never arrived is looked at again now and then:
 * the person (or another device) may choose those files and send them, and every open tab of that
 * batch must follow without a reload (BP-10).
 */
const WAITING_VISIBLE_MS = 10000;
const WAITING_HIDDEN_MS = 30000;

function watchOf(batchId: string): Watch {
  let w = watches.get(batchId);
  if (!w) {
    w = {
      status: null,
      error: '',
      timer: null,
      refs: 0,
      items: 0,
      final: false,
      busy: false,
      callbacks: new Set(),
      listeners: new Set(),
    };
    watches.set(batchId, w);
  }
  return w;
}

/** Nothing left to wait for: no CV is being read and this tab holds no file to send. */
export function isFinal(s: BatchStatus, run: Run | null): boolean {
  if (runActive(run)) return false;
  // An Oracle batch with a file the runner has yet to fetch keeps its watcher alive.
  if (s.batch.source === 'oracle_hcm' && s.counts.upload.notReceived > 0) return false;
  return s.counts.byStatus.analyzing === 0;
}

async function poll(batchId: string) {
  const w = watchOf(batchId);
  if (w.busy) return;
  w.busy = true;
  if (w.timer) clearTimeout(w.timer);
  w.timer = null;
  try {
    const s = await api.get<BatchStatus>(`/upload-batches/${batchId}?items=${w.items > 0 ? 1 : 0}`);
    // Cancelled in another tab or on another device: this tab stops sending within one poll.
    const mine = getRun(s.batch.vacancyId);
    if (s.batch.cancelledAt && mine && mine.batchId === batchId && runActive(mine)) {
      const sent = mine.items.filter((i) => i.client === 'sent').length;
      const notSent = mine.items.filter((i) => i.client !== 'sent').length;
      stopLocally(mine);
      mine.stop = { state: 'done', sent, notSent };
      touch(mine);
      emitRuns();
      letScreenSleep();
    }
    w.status = s;
    w.error = '';
    w.final = isFinal(s, getRun(s.batch.vacancyId));
    w.callbacks.forEach((cb) => cb(s));
  } catch (e) {
    w.error = errMsg(e);
    if (e instanceof ApiError && e.status === 401) w.final = true;
  } finally {
    w.busy = false;
    w.listeners.forEach((l) => l());
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    if (w.refs > 0 && !w.final) {
      w.timer = setTimeout(() => void poll(batchId), hidden ? HIDDEN_MS : VISIBLE_MS);
    } else if (w.refs > 0 && (w.status?.counts.upload.notReceived ?? 0) > 0 && !w.error) {
      w.timer = setTimeout(
        () => void poll(batchId),
        hidden ? WAITING_HIDDEN_MS : WAITING_VISIBLE_MS,
      );
    }
  }
}

/** Ask for a fresh picture now and keep polling (after a send, a retry or opening the list). */
export function kickBatch(batchId: string) {
  const w = watches.get(batchId);
  if (!w || w.refs === 0) return;
  w.final = false;
  void poll(batchId);
}

/** Watch a batch: every update calls `cb`. Returns a function that stops watching. */
export function watchBatch(
  batchId: string,
  cb?: (s: BatchStatus) => void,
  opts: { items?: boolean } = {},
): () => void {
  const w = watchOf(batchId);
  w.refs++;
  if (opts.items) w.items++;
  if (cb) w.callbacks.add(cb);
  if (w.status && cb) cb(w.status);
  if (w.refs === 1 || opts.items) {
    w.final = false;
    void poll(batchId);
  }
  return () => {
    w.refs--;
    if (opts.items) w.items--;
    if (cb) w.callbacks.delete(cb);
    if (w.refs <= 0 && w.timer) {
      clearTimeout(w.timer);
      w.timer = null;
    }
  };
}

export interface BatchView {
  status: BatchStatus | null;
  error: string;
  refresh: () => void;
}

/** The latest picture of a batch (null before the first answer). */
export function useBatchStatus(batchId: string | null, opts: { items?: boolean } = {}): BatchView {
  const items = !!opts.items;
  // The subscription must keep its identity between renders: a new one each time would stop and
  // restart the watcher (and ask the server again) on every render.
  const subscribe = useCallback(
    (l: () => void) => {
      if (!batchId) return () => undefined;
      const w = watchOf(batchId);
      w.listeners.add(l);
      const stop = watchBatch(batchId, undefined, { items });
      return () => {
        w.listeners.delete(l);
        stop();
      };
    },
    [batchId, items],
  );
  const status = useSyncExternalStore(subscribe, () => (batchId ? watchOf(batchId).status : null));
  const error = useSyncExternalStore(subscribe, () => (batchId ? watchOf(batchId).error : ''));
  const refresh = useCallback(() => {
    if (batchId) kickBatch(batchId);
  }, [batchId]);
  return { status, error, refresh };
}

/** Test helper: forget every run and watcher. */
export function resetIntakeForTests() {
  runs.clear();
  for (const w of watches.values()) if (w.timer) clearTimeout(w.timer);
  watches.clear();
  letScreenSleep();
}
