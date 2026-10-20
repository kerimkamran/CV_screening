import { useCallback, useSyncExternalStore } from 'react';
import type { CvStatus, UploadCode } from '@cv/shared';
import { api, ApiError } from './api';
import { errMsg } from './ui';

/**
 * Sending CVs to a vacancy (Stage 2, S2-FE7 and S2-FE8).
 *
 * 1. `checkFiles` looks at every file before anything is sent: wrong type, empty, too big, the old
 *    .doc format. Same-name files with different content are all kept.
 * 2. `startBatch` announces the files (one batch on the server, one item per file), then sends them
 *    one file per request, three at a time. A network error, a 5xx or a 429 is retried once after
 *    2 s; a 401 pauses the queue until the person signs in again. One failing file never stops the
 *    others.
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
}
export interface LatestBatch {
  id: string;
  createdAt: string;
  createdBy: string;
  fileCount: number;
  mine: boolean;
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
  client: 'waiting' | 'sending' | 'sent' | 'failed';
  error: string;
}
export interface Run {
  vacancyId: string;
  batchId: string;
  items: RunItem[];
  /** A 401 paused the queue; `resumeRun` continues it. */
  paused: boolean;
  startedAt: number;
}

const LANES = 3;
const RETRY_AFTER_MS = 2000;
const runs = new Map<string, Run>();
const runListeners = new Set<() => void>();
const emitRuns = () => runListeners.forEach((l) => l());
let wake: { release: () => Promise<void> } | null = null;

/** The files this tab is still holding for a vacancy (empty once everything is sent or failed). */
export const runActive = (r: Run | null | undefined) =>
  !!r && r.items.some((i) => i.client === 'waiting' || i.client === 'sending');

export function getRun(vacancyId: string): Run | null {
  return runs.get(vacancyId) ?? null;
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

const retryable = (e: unknown) => !(e instanceof ApiError) || e.status >= 500 || e.status === 429;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sendOne(vacancyId: string, item: RunItem): Promise<void> {
  const url = `/vacancies/${vacancyId}/documents?item=${item.itemId}`;
  try {
    await api.upload(url, [item.file!]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) throw e;
    if (!retryable(e)) throw e;
    await sleep(RETRY_AFTER_MS);
    await api.upload(url, [item.file!]);
  }
}

function pump(vacancyId: string) {
  const run = runs.get(vacancyId);
  if (!run || run.paused) return;
  const live = () => runs.get(vacancyId)!;
  const lanes = () => live().items.filter((i) => i.client === 'sending').length;
  while (lanes() < LANES) {
    const next = live().items.find((i) => i.client === 'waiting' && i.file);
    if (!next) break;
    const id = next.itemId;
    const set = (patch: Partial<RunItem>, extra?: Partial<Run>) => {
      const cur = live();
      cur.items = cur.items.map((i) => (i.itemId === id ? { ...i, ...patch } : i));
      Object.assign(cur, extra);
      touch(cur);
      emitRuns();
    };
    set({ client: 'sending' });
    void (async () => {
      try {
        await sendOne(vacancyId, next);
        set({ client: 'sent', error: '', file: null });
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) set({ client: 'waiting' }, { paused: true });
        else set({ client: 'failed', error: errMsg(e) });
      }
      if (!runActive(live())) letScreenSleep();
      kickBatch(live().batchId);
      pump(vacancyId);
    })();
  }
}

/**
 * Announce the ready files and start sending them. Resolves as soon as the batch exists, with its
 * id, so the waiting screen can open at once; the files go up in the background.
 */
export async function startBatch(vacancyId: string, rows: Checked[]): Promise<string> {
  const ready = rows.filter((r) => !r.problem);
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
  });
  emitRuns();
  void holdScreenAwake();
  pump(vacancyId);
  kickBatch(made.batchId);
  return made.batchId;
}

/** Continue a queue that stopped on a 401, after signing in again. */
export function resumeRun(vacancyId: string) {
  const run = runs.get(vacancyId);
  if (!run) return;
  run.paused = false;
  touch(run);
  emitRuns();
  void holdScreenAwake();
  pump(vacancyId);
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
      : { vacancyId, batchId, items: [], paused: false, startedAt: Date.now() };
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
    if (w.refs > 0 && !w.final) {
      w.timer = setTimeout(
        () => void poll(batchId),
        typeof document !== 'undefined' && document.visibilityState === 'hidden'
          ? HIDDEN_MS
          : VISIBLE_MS,
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
