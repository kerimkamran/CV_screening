import { useSyncExternalStore } from 'react';
import { api } from './api';
import { errMsg } from './ui';

/**
 * Sends resumes to a vacancy in the background (design spec 6.1.4). The first group goes up before
 * the person lands on Results; the rest keep going while they look, so they never wait for 100
 * files. A ZIP is sent on its own and unpacked by the server.
 */

export interface IntakeState {
  total: number;
  sent: number;
  error: string;
}

const MAX_BATCH = 50;
const PARALLEL = 2;
const states = new Map<string, IntakeState>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const isZip = (f: { name: string }) => /\.zip$/i.test(f.name);

/** Groups of files per request: each ZIP alone, the rest in batches the server accepts. */
export function groupFiles(files: File[]): File[][] {
  const zips = files.filter(isZip).map((f) => [f]);
  const rest = files.filter((f) => !isZip(f));
  const groups: File[][] = [];
  for (let i = 0; i < rest.length; i += MAX_BATCH) groups.push(rest.slice(i, i + MAX_BATCH));
  return [...groups, ...zips];
}

/**
 * Upload everything. Resolves when the first group is in, so the caller can show the results at
 * once; the remaining groups continue in the background and update the state.
 */
export async function startIntake(vacancyId: string, files: File[]): Promise<void> {
  const groups = groupFiles(files);
  const set = (p: Partial<IntakeState>) => {
    states.set(vacancyId, { ...states.get(vacancyId)!, ...p });
    emit();
  };
  states.set(vacancyId, { total: files.length, sent: 0, error: '' });
  emit();
  const send = async (g: File[]) => {
    try {
      await api.upload(`/vacancies/${vacancyId}/documents`, g);
    } catch (e) {
      set({ error: errMsg(e) });
    }
    set({ sent: states.get(vacancyId)!.sent + g.length });
  };
  if (groups.length === 0) return;
  await send(groups[0]!);
  const rest = groups.slice(1);
  if (rest.length === 0) return;
  let next = 0;
  const worker = async () => {
    while (next < rest.length) await send(rest[next++]!);
  };
  void Promise.all(Array.from({ length: PARALLEL }, worker));
}

export function useIntake(vacancyId: string): IntakeState | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => states.get(vacancyId) ?? null,
  );
}

/** Folders dropped on the page: walk them, keep the files, say what was left out. */
export async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const items = Array.from(dt.items ?? []);
  const entries = items
    .map((i) => (typeof i.webkitGetAsEntry === 'function' ? i.webkitGetAsEntry() : null))
    .filter((e): e is FileSystemEntry => !!e);
  if (!entries.some((e) => e.isDirectory)) return Array.from(dt.files);
  const out: File[] = [];
  const walk = async (e: FileSystemEntry, depth: number): Promise<void> => {
    if (out.length > 5000 || depth > 8) return;
    if (e.isFile) {
      const f = await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej));
      out.push(f);
    } else if (e.isDirectory) {
      const reader = (e as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) =>
          reader.readEntries(res, rej),
        );
        if (batch.length === 0) break;
        for (const c of batch) await walk(c, depth + 1);
      }
    }
  };
  for (const e of entries) await walk(e, 0);
  return out;
}
