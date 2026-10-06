import type { ReactNode } from 'react';
import type { ReqStatus } from './api';

export const btn =
  'inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50 disabled:cursor-not-allowed';
export const btnPrimary = `${btn} bg-accent text-on-accent hover:bg-accent-hover`;
export const btnSecondary = `${btn} border border-edge bg-card text-ink hover:bg-page`;
export const btnDanger = `${btn} bg-danger text-on-accent hover:bg-danger-hover`;
export const input =
  'block w-full rounded-md border border-edge px-2.5 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-focus';

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

export function Card({
  title,
  children,
  actions,
}: {
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-line bg-card p-4 shadow-sm">
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold text-ink">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Notice({
  kind = 'info',
  children,
}: {
  kind?: 'info' | 'warn' | 'error' | 'ok';
  children: ReactNode;
}) {
  const c = {
    info: 'border-info-line bg-info text-info-ink',
    warn: 'border-warn-line bg-warn text-warn-ink',
    error: 'border-err-line bg-err text-err-ink',
    ok: 'border-ok-line bg-ok text-ok-ink',
  }[kind];
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className={`rounded-md border px-3 py-2 text-sm ${c}`}
    >
      {children}
    </div>
  );
}

const STATUS: Record<ReqStatus, [string, string]> = {
  met: ['Met', 'bg-ok text-ok-ink'],
  partially_met: ['Partially met', 'bg-ok text-ok-ink'],
  not_met: ['Not met', 'bg-err text-err-ink'],
  not_found: ['Not found in CV', 'bg-neutral text-ink'],
  ambiguous: ['Unclear', 'bg-warn text-warn-ink'],
  not_applicable: ['Not applicable', 'bg-neutral text-ink-2'],
};
export const statusLabel = (s: ReqStatus) => STATUS[s][0];

/** Status is always text plus colour, never colour alone. */
export function StatusBadge({ status }: { status: ReqStatus | null }) {
  if (!status) return <span className="text-xs text-ink-3">—</span>;
  const [label, cls] = STATUS[status];
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}

const BAND: Record<string, [string, string]> = {
  strong_match: ['Strong match', 'bg-ok text-ok-ink'],
  possible_match: ['Possible match', 'bg-tag text-tag-ink'],
  weak_match: ['Weak match', 'bg-neutral text-ink'],
  needs_review: ['Needs review', 'bg-warn text-warn-ink'],
};
export function BandBadge({ band }: { band: string | null }) {
  if (!band) return <span className="text-xs text-ink-3">—</span>;
  const [label, cls] = BAND[band] ?? [band, 'bg-neutral'];
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}

export const OUTCOME: Record<string, [string, string]> = {
  shortlist: ['Shortlisted', 'bg-ok text-ok-ink'],
  hold: ['Maybe', 'bg-warn text-warn-ink'],
  reject: ['Not now', 'bg-err text-err-ink'],
};

export function when(iso: string | null | undefined) {
  return iso ? new Date(iso).toLocaleString() : '';
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');
