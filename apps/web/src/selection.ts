import { api, BASE } from './api';
import { tr } from './i18n';

/**
 * Selecting CVs in a list and downloading them (Stage 2, S2-FE6).
 *
 * The selection is keyed by document id (a CV that has no result yet can be selected too) and holds
 * the result id when there is one, so marks still work for rows that are not loaded. It survives
 * "Show more", a change of sort and a trip to a CV and back; a change of filter or search clears it.
 */
export type Selection = Map<string, string | null>;

export const DOWNLOAD_MAX = 500;
export const MARK_MAX = 100;

/** The list's filters without its order: a new sort keeps the selection, a new filter does not. */
export function filterKey(query: string): string {
  const p = new URLSearchParams(query);
  p.delete('sort');
  p.delete('order');
  p.sort();
  return p.toString();
}

const KEY = (scope: string) => `cv-pool-selection:${scope}`;

export function saveSelection(scope: string, filter: string, sel: Selection) {
  try {
    if (sel.size === 0) sessionStorage.removeItem(KEY(scope));
    else sessionStorage.setItem(KEY(scope), JSON.stringify({ filter, items: [...sel] }));
  } catch {
    /* a convenience only */
  }
}

export function loadSelection(scope: string, filter: string): Selection {
  try {
    const j = JSON.parse(sessionStorage.getItem(KEY(scope)) ?? 'null') as {
      filter?: string;
      items?: unknown;
    } | null;
    if (!j || j.filter !== filter || !Array.isArray(j.items)) return new Map();
    return new Map(
      j.items.filter(
        (x): x is [string, string | null] =>
          Array.isArray(x) &&
          typeof x[0] === 'string' &&
          (typeof x[1] === 'string' || x[1] === null),
      ),
    );
  } catch {
    return new Map();
  }
}

export interface DownloadTicket {
  url: string;
  files: number;
  bytes: number;
  archiveName: string;
  excluded: { documentId: string; label: string | null; reason: 'erased' | 'not_found' }[];
}

export function sizeText(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** "Downloading 311 CVs (96 MB) as one ZIP. 1 left out: Candidate 07 (the CV was erased)." */
export function downloadNotice(t: DownloadTicket): string {
  const head = tr(
    t.files === 1
      ? 'Downloading 1 CV ({size}) as one ZIP.'
      : 'Downloading {n} CVs ({size}) as one ZIP.',
    { n: t.files, size: sizeText(t.bytes) },
  );
  if (!t.excluded.length) return head;
  const why = (r: 'erased' | 'not_found') =>
    r === 'erased' ? tr('the CV was erased') : tr('not found or not yours to see');
  const listed = t.excluded
    .slice(0, 5)
    .map((x) => `${x.label ?? tr('a CV')} (${why(x.reason)})`)
    .join(', ');
  const more = t.excluded.length > 5 ? ` ${tr('and {n} more', { n: t.excluded.length - 5 })}` : '';
  return `${head} ${tr('{n} left out:', { n: t.excluded.length })} ${listed}${more}.`;
}

/**
 * Asks for a ticket, then lets the browser's own download manager fetch the ZIP: nothing large is
 * held in the page, and phones show the download's progress. The link works once, for two minutes.
 */
export async function downloadCvs(ids: string[]): Promise<DownloadTicket> {
  const t = await api.post<DownloadTicket>('/downloads', { documentIds: ids });
  const a = document.createElement('a');
  a.href = `${BASE}${t.url}`;
  a.rel = 'noreferrer';
  a.download = t.archiveName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  return t;
}
