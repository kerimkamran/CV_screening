import { useEffect } from 'react';
import { MARK_LABEL, VACANCY_STATUS_LABEL, type Mark, type VacancyStatus } from '@cv/shared';
import { tr } from './i18n';

/** Shapes the Vacancy pool, the Candidate pool and the report use (Development Plan, Phases 1 to 3). */

export type Band = 'strong' | 'good' | 'partial' | 'limited';
export const BANDS: Band[] = ['strong', 'good', 'partial', 'limited'];
export const BAND_NAME: Record<Band, string> = {
  strong: 'Strong',
  good: 'Good',
  partial: 'Partial',
  limited: 'Limited',
};
export const BAND_STYLE: Record<Band, string> = {
  strong: 'bg-ok text-ok-ink',
  good: 'bg-tag text-tag-ink',
  partial: 'bg-warn text-warn-ink',
  limited: 'bg-neutral text-ink',
};
export const MARK_STYLE: Record<Mark, string> = {
  new: 'border-edge bg-card text-ink-2',
  shortlist: 'border-ok-line bg-ok text-ok-ink',
  maybe: 'border-warn-line bg-warn text-warn-ink',
  not_now: 'border-err-line bg-err text-err-ink',
};
export const MARKS: Mark[] = ['new', 'shortlist', 'maybe', 'not_now'];
export const markName = (m: Mark) => tr(MARK_LABEL[m]);
export const statusName = (s: VacancyStatus) => tr(VACANCY_STATUS_LABEL[s]);
export const STATUS_STYLE: Record<VacancyStatus, string> = {
  draft: 'bg-neutral text-ink',
  open: 'bg-ok text-ok-ink',
  on_hold: 'bg-warn text-warn-ink',
  closed: 'bg-neutral text-ink-2',
};

export interface VacancyListItem {
  id: string;
  title: string;
  department: string | null;
  location: string | null;
  status: VacancyStatus;
  archived: boolean;
  owner: { id: string; name: string | null };
  canEdit: boolean;
  documents: number;
  analyzed: number;
  outOfDate: number;
  strong: number;
  decisions: { shortlist: number; maybe: number; notNow: number };
  running: number;
  stopped: number;
  version: number;
  updatedAt: string;
  createdAt: string;
}

export interface VacancyRequirement {
  id?: string;
  text: string;
  classification: 'mandatory' | 'preferred' | 'informational' | 'disqualifier';
  weight: number | null;
  rule?: unknown;
  confidence?: string | null;
}
export type ExperienceRange = 'any' | '1-3' | '3-5' | '5+';

export interface VacancyView {
  id: string;
  title: string;
  status: VacancyStatus;
  archived: boolean;
  department: string | null;
  location: string | null;
  experienceRange: ExperienceRange;
  openings: number | null;
  closingDate: string | null;
  hiringManager: string | null;
  notes: string | null;
  description: string;
  sourceType: string;
  sourceFileName: string | null;
  link: { url: string; readAt: string | null; status: string | null } | null;
  requirementsVersion: number;
  version: number;
  owner: { id: string; name: string | null };
  canEdit: boolean;
  candidateNoticeConfirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
  requirements: VacancyRequirement[];
  hasDraft: boolean;
  hasFrozen: boolean;
  counts: {
    documents: number;
    analyzed: number;
    outOfDate: number;
    strong: number;
    running: number;
    stopped: number;
    failed: number;
    needsLook: number;
  };
}

export interface PoolRow {
  documentId: string;
  vacancyId: string;
  vacancyTitle: string;
  vacancyStatus: VacancyStatus;
  vacancyArchived: boolean;
  pseudonym: string;
  label: string;
  name: string | null;
  ordinal: number;
  matchId: string;
  score: number;
  band: Band;
  mustFound: number;
  mustTotal: number;
  decision: Mark;
  decisionNote: string | null;
  decisionVersion: number;
  decidedAt: string | null;
  decidedBy: string | null;
  outOfDate: boolean;
  scoredAgainst: string | null;
  reanalyzing: boolean;
  analyzedAt: string;
  updatedAt: string;
}
export interface PoolPage {
  rows: PoolRow[];
  total: number;
  counts: { byMark: Record<Mark, number>; outOfDate: number; strong: number };
  nextCursor: string | null;
  asOf: string;
}
export interface MarkResult {
  mark: Mark;
  note: string | null;
  version: number;
  previous: { mark: Mark; note: string | null; version: number };
}

export interface ReportAnchor {
  start: number;
  end: number;
  quote: string;
  page: number | null;
  block: number;
}
export interface ReportRequirement {
  requirementId: string;
  text: string;
  kind: 'must' | 'nice' | 'other';
  state: 'matched' | 'partly' | 'missing';
  unclear: boolean;
  notFound: boolean;
  confidence: string | null;
  rationale: string | null;
  anchors: ReportAnchor[];
}
export interface CandidateReportData {
  matchId: string;
  documentId: string;
  label: string;
  name: string | null;
  pseudonym: string;
  email: string | null;
  filename: string | null;
  vacancy: { id: string; title: string; status: VacancyStatus; archived: boolean };
  score: number;
  band: Band;
  mustFound: number;
  mustTotal: number;
  summary: string | null;
  analyzedAt: string;
  outOfDate: {
    scoredAgainst: string | null;
    changes: { version: number; at: string; by: string; description: string | null }[];
  } | null;
  reanalyzing: boolean;
  decision: {
    mark: Mark;
    note: string | null;
    version: number;
    decidedAt: string | null;
    decidedBy: string | null;
  };
  history: { mark: Mark; label: string; note: string | null; at: string; by: string }[];
  requirements: ReportRequirement[];
}
export interface ResumeData {
  text: string;
  truncated: boolean;
  pageStarts: number[] | null;
  blocks: { start: number; end: number; page: number | null }[];
}

// ------------------------------------------------------------------ small helpers

/** "3 min ago", "yesterday", or a date: the same rule everywhere a time is shown beside a row. */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return tr('just now');
  const m = Math.round(s / 60);
  if (m < 60) return tr('{n} min ago', { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return tr('{n} h ago', { n: h });
  const d = Math.round(h / 24);
  if (d < 14) return d === 1 ? tr('yesterday') : tr('{n} days ago', { n: d });
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Warn before leaving a page with unsaved work: reloads, closing the tab, and in-app links. */
export function useLeaveGuard(dirty: boolean, message: string, bypass?: { current: boolean }) {
  useEffect(() => {
    if (!dirty) return;
    const before = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    let last = window.location.hash;
    const onHash = () => {
      if (window.location.hash === last || bypass?.current) return;
      if (window.confirm(message)) {
        last = window.location.hash;
        return;
      }
      // Stay: put the address back without adding a history entry.
      window.history.replaceState(null, '', last || '#/');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    };
    window.addEventListener('beforeunload', before);
    window.addEventListener('hashchange', onHash);
    return () => {
      window.removeEventListener('beforeunload', before);
      window.removeEventListener('hashchange', onHash);
    };
  }, [dirty, message, bypass]);
}
