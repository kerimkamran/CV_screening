/**
 * Searching the resumes themselves (SenAI plan S1, "mentioned in the resume, not assessed").
 * Reads `cv_document.text` on the server, finds where a skill is written and keeps only places
 * (offsets) with the answer. The text of a passage is read again when the answer is shown, so a
 * resume that is erased leaves nothing behind in a conversation. It never changes a score.
 */
import { Injectable } from '@nestjs/common';
import {
  foldMapped,
  mentionsOf,
  phraseRegex,
  skillById,
  skillRegex,
  windowAround,
  type Folded,
} from '@cv/shared';
import { DbService } from '../../db/db.service';
import { anonymise } from '../../pipeline/anonymise';
import type { PoolRow } from '../../pipeline/pool.service';
import type { SkillTerm } from './query';

/** Where a skill is written: the line around it, and the word itself. Offsets into the resume text. */
export interface PassageRef {
  skill: string;
  start: number;
  end: number;
  ms: number;
  me: number;
  /** Filled in when the answer is shown, never stored. */
  text?: string;
  hit?: string;
}

export interface SkillHits {
  hits: { skill: string; count: number }[];
  passages: PassageRef[];
}

/** How close words must be, in letters, to count as one phrase written in another order or with words between. */
const NEAR = 90;

/**
 * "Huawei core network" is also found as "core network (Huawei RAN)": every word of a phrase, in any
 * order, within a short stretch. Used only when the phrase is not written as asked, so an exact phrase
 * always wins and the passage shows the stretch itself.
 */
export function nearMentions(
  f: Folded,
  raw: string,
  phrase: string,
): { start: number; end: number }[] {
  const words = phrase
    .split(/[\s,;/]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2);
  if (words.length < 2 || words.length > 5) return [];
  const per = words.map((w) => mentionsOf(f, phraseRegex(w), raw));
  if (per.some((m) => m.length === 0)) return [];
  const anchor = per.reduce((a, b) => (b.length < a.length ? b : a));
  const out: { start: number; end: number }[] = [];
  for (const m of anchor) {
    let start = m.start;
    let end = m.end;
    let ok = true;
    for (const list of per) {
      if (list === anchor) continue;
      const near = list
        .filter((x) => Math.abs(x.start - m.start) <= NEAR)
        .sort((x, y) => Math.abs(x.start - m.start) - Math.abs(y.start - m.start))[0];
      if (!near) {
        ok = false;
        break;
      }
      start = Math.min(start, near.start);
      end = Math.max(end, near.end);
    }
    if (ok && !out.some((o) => o.start === start && o.end === end)) out.push({ start, end });
  }
  return out;
}

export function termRegex(t: SkillTerm): RegExp | null {
  if (t.id) {
    const s = skillById(t.id);
    return s ? skillRegex(s) : null;
  }
  return t.phrase ? phraseRegex(t.phrase) : null;
}

/** Hits for one resume text; null when the skills asked for are not all (or none, for "or") there. */
export function searchText(
  raw: string,
  terms: SkillTerm[],
  any: boolean,
  folded?: Folded,
): SkillHits | null {
  const f = folded ?? foldMapped(raw);
  const per = terms.map((t) => {
    const re = termRegex(t);
    let found = re ? mentionsOf(f, re, raw) : [];
    if (!found.length && !t.id && t.phrase) found = nearMentions(f, raw, t.phrase);
    return { t, found };
  });
  const ok = any ? per.some((p) => p.found.length > 0) : per.every((p) => p.found.length > 0);
  if (!ok) return null;
  const present = per.filter((p) => p.found.length > 0);
  const passages: PassageRef[] = [];
  const seen = new Set<string>();
  const take = (label: string, m: { start: number; end: number }) => {
    const w = windowAround(raw, m);
    const key = `${w.start}:${w.end}`;
    if (seen.has(key) || passages.length >= 3) return;
    seen.add(key);
    passages.push({ skill: label, start: w.start, end: w.end, ms: m.start, me: m.end });
  };
  for (const p of present) take(p.t.label, p.found[0]!);
  if (present.length === 1)
    for (const m of present[0]!.found.slice(1, 4)) take(present[0]!.t.label, m);
  return {
    hits: present.map((p) => ({ skill: p.t.label, count: p.found.length })),
    passages,
  };
}

@Injectable()
export class PoolSearch {
  constructor(private readonly db: DbService) {}

  /** The resumes of these pool rows that mention the skills, by document id. */
  async skills(rows: PoolRow[], terms: SkillTerm[], any: boolean): Promise<Map<string, SkillHits>> {
    const out = new Map<string, SkillHits>();
    for (let i = 0; i < rows.length; i += 40) {
      const batch = rows.slice(i, i + 40);
      const { rows: docs } = await this.db.query<{ id: string; text: string | null }>(
        `SELECT id, text FROM cv_document WHERE id = ANY($1::char(26)[]) AND erased_at IS NULL`,
        [batch.map((r) => r.documentId)],
      );
      for (const d of docs) {
        if (!d.text) continue;
        const r = searchText(d.text, terms, any);
        if (r) out.set(d.id, r);
      }
    }
    return out;
  }

  /** Puts the text of every passage into an answer for display. The stored answer keeps offsets only. */
  async hydrate<T extends { rows: { matchId: string; label: string; passages?: PassageRef[] }[] }>(
    a: T,
  ): Promise<T> {
    const ids = a.rows.filter((r) => r.passages?.length).map((r) => r.matchId);
    if (!ids.length) return a;
    const { rows } = await this.db.query<{ id: string; text: string | null }>(
      `SELECT sc.id, d.text FROM screening sc JOIN cv_document d ON d.id = sc.document_id
        WHERE sc.id = ANY($1::char(26)[]) AND d.erased_at IS NULL`,
      [ids],
    );
    const text = new Map(rows.map((r) => [r.id, r.text]));
    return {
      ...a,
      rows: a.rows.map((r) => {
        if (!r.passages?.length) return r;
        const raw = text.get(r.matchId);
        if (!raw) return { ...r, passages: [] };
        return {
          ...r,
          passages: r.passages.map((p) => ({
            ...p,
            text: anonymise(raw.slice(p.start, p.end), [r.label]).text.trim(),
            hit: raw.slice(p.ms, p.me),
          })),
        };
      }),
    };
  }
}

/** The stored form of an answer: passages keep their offsets and lose any text. */
export function stripPassages<T extends { rows: { passages?: PassageRef[] }[] }>(a: T): T {
  return {
    ...a,
    rows: a.rows.map((r) =>
      r.passages
        ? {
            ...r,
            passages: r.passages.map(({ skill, start, end, ms, me }) => ({
              skill,
              start,
              end,
              ms,
              me,
            })),
          }
        : r,
    ),
  };
}
