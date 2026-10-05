import type { ReactNode } from 'react';
import type { ReqStatus } from './api';

export const btn =
  'inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 disabled:opacity-50 disabled:cursor-not-allowed';
export const btnPrimary = `${btn} bg-sky-700 text-white hover:bg-sky-800`;
export const btnSecondary = `${btn} border border-slate-300 bg-white text-slate-800 hover:bg-slate-50`;
export const btnDanger = `${btn} bg-red-700 text-white hover:bg-red-800`;
export const input =
  'block w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600';

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
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
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
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
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
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    warn: 'border-amber-300 bg-amber-50 text-amber-900',
    error: 'border-red-300 bg-red-50 text-red-900',
    ok: 'border-emerald-300 bg-emerald-50 text-emerald-900',
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
  met: ['Met', 'bg-emerald-100 text-emerald-900'],
  partially_met: ['Partially met', 'bg-lime-100 text-lime-900'],
  not_met: ['Not met', 'bg-red-100 text-red-900'],
  not_found: ['Not found in CV', 'bg-slate-200 text-slate-800'],
  ambiguous: ['Unclear', 'bg-amber-100 text-amber-900'],
  not_applicable: ['Not applicable', 'bg-slate-100 text-slate-600'],
};
export const statusLabel = (s: ReqStatus) => STATUS[s][0];

/** Status is always text plus colour, never colour alone. */
export function StatusBadge({ status }: { status: ReqStatus | null }) {
  if (!status) return <span className="text-xs text-slate-400">—</span>;
  const [label, cls] = STATUS[status];
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}

const BAND: Record<string, [string, string]> = {
  strong_match: ['Strong match', 'bg-emerald-100 text-emerald-900'],
  possible_match: ['Possible match', 'bg-sky-100 text-sky-900'],
  weak_match: ['Weak match', 'bg-slate-200 text-slate-800'],
  needs_review: ['Needs review', 'bg-amber-100 text-amber-900'],
};
export function BandBadge({ band }: { band: string | null }) {
  if (!band) return <span className="text-xs text-slate-400">—</span>;
  const [label, cls] = BAND[band] ?? [band, 'bg-slate-100'];
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}

export const OUTCOME: Record<string, [string, string]> = {
  shortlist: ['Shortlisted', 'bg-emerald-100 text-emerald-900'],
  hold: ['On hold', 'bg-amber-100 text-amber-900'],
  reject: ['Rejected', 'bg-red-100 text-red-900'],
};

export function when(iso: string | null | undefined) {
  return iso ? new Date(iso).toLocaleString() : '';
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');
