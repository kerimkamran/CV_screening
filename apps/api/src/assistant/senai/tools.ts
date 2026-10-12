/**
 * The tools of SenAI (plan section 5): compare, doctor, changes, what-if, open, interview, recall,
 * about and help. Each reads the pool's own data and fills the answer with fixed wording; none writes
 * anything and none sends a resume anywhere. A tool never decides about a person.
 */
import { Injectable } from '@nestjs/common';
import { fold, tokens } from '@cv/shared';
import type { Principal } from '../../auth/principal';
import { DbService } from '../../db/db.service';
import { AdjustmentService } from '../../pipeline/adjustments.service';
import { PoolService, bandOf, type PoolRow } from '../../pipeline/pool.service';
import { BAND_WORD, MARK_WORD, type Lang, type VacancyRef } from '../pool-assistant';
import type { PoolAnswer, Register } from '../pool-assistant.service';
import { describe, type Query } from './query';
import { helpKey, tsay, type TKey } from './tools-words';

export interface AnswerTable {
  head: string[];
  rows: { cells: string[]; tag?: 'must' | 'nice' }[];
}
export interface AnswerAction {
  label: string;
  href: string;
}

export interface ToolCtx {
  a: PoolAnswer;
  q: Query;
  reg: Register | null;
  text: string;
  /** The vacancies the question is about (named, on the page, or the conversation's scope). */
  list: VacancyRef[];
  /** A vacancy was named in the question itself. */
  named: VacancyRef | null;
  live: VacancyRef[];
  now: Date;
  p: Principal;
}

interface Item {
  text: string;
  classification: string;
  status: string;
}

const STATUS: Record<string, TKey> = {
  met: 'st_met',
  partially_met: 'st_partially_met',
  not_met: 'st_not_met',
  not_found: 'st_not_found',
  ambiguous: 'st_ambiguous',
  not_applicable: 'st_not_applicable',
};

const bakuDate = (d: Date): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Baku',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);

@Injectable()
export class PoolTools {
  constructor(
    private readonly db: DbService,
    private readonly pool: PoolService,
    private readonly adj: AdjustmentService,
  ) {}

  /** Which tool answers this intent; false when the intent is not a tool. */
  async run(c: ToolCtx): Promise<boolean> {
    switch (c.q.intent) {
      case 'compare':
        await this.compare(c);
        return true;
      case 'doctor':
        await this.doctor(c);
        return true;
      case 'changes':
        await this.changes(c);
        return true;
      case 'what_if':
        await this.whatIf(c);
        return true;
      case 'open':
        await this.open(c);
        return true;
      case 'interview':
        await this.interview(c);
        return true;
      case 'recall':
        await this.recall(c);
        return true;
      case 'about':
        this.about(c);
        return true;
      case 'help': {
        const k = c.q.topic ? helpKey(c.q.topic) : null;
        if (!k) return false;
        c.a.kind = 'help';
        c.a.headline = tsay(c.a.language, k);
        return true;
      }
      default:
        return false;
    }
  }

  // ------------------------------------------------------------------ references

  /** The candidates the question points at: "the second", "Candidate 07", "those", or a name. */
  async resolve(c: ToolCtx, max: number): Promise<PoolRow[]> {
    const rows = await this.pool.rows(c.live.map((v) => v.id));
    const byId = new Map(rows.map((r) => [r.matchId, r]));
    const shown = (c.reg?.shown ?? []).map((id) => byId.get(id)).filter((r): r is PoolRow => !!r);
    const out: PoolRow[] = [];
    const add = (r: PoolRow | undefined) => {
      if (r && !out.includes(r)) out.push(r);
    };
    for (const ref of c.q.refs) {
      if (ref.kind === 'ordinal') add(shown[ref.n - 1]);
      else if (ref.kind === 'last') add(shown[shown.length - 1]);
      else if (ref.kind === 'shown') shown.forEach(add);
      else {
        const same = rows.filter((r) => r.ordinal === ref.n);
        const inShown = same.filter((r) => shown.includes(r));
        const inScope = same.filter((r) => c.list.some((v) => v.id === r.vacancyId));
        const pick = inShown.length ? inShown : inScope.length ? inScope : same;
        if (pick.length === 1) add(pick[0]);
      }
    }
    if (!out.length) for (const r of this.byName(c.text, rows)) add(r);
    return out.slice(0, max);
  }

  /** Candidates whose name is written in the question (a full name, or a name word nobody else shares). */
  private byName(text: string, rows: PoolRow[]): PoolRow[] {
    const padded = ` ${fold(text)} `;
    const words = new Set(tokens(text));
    const named = rows.filter((r) => r.name);
    const full = named.filter((r) => padded.includes(` ${fold(r.name!)} `));
    if (full.length) return full;
    const out: PoolRow[] = [];
    for (const w of words) {
      if (w.length < 4) continue;
      const hit = named.filter((r) => tokens(r.name!).includes(w));
      if (hit.length === 1) out.push(hit[0]!);
    }
    return out;
  }

  private async items(ids: string[]): Promise<Map<string, Item[]>> {
    if (!ids.length) return new Map();
    const { rows } = await this.db.query<{ id: string; items: Item[] | null }>(
      `SELECT id, breakdown->'items' AS items FROM screening WHERE id = ANY($1::char(26)[])`,
      [ids],
    );
    return new Map(rows.map((r) => [r.id, r.items ?? []]));
  }

  private which(c: ToolCtx, head: TKey) {
    c.a.kind = 'ask_which';
    c.a.headline = tsay(c.a.language, head);
    c.a.options = c.live.slice(0, 8).map((v) => ({ id: v.id, title: v.title, status: v.status }));
    c.a.flags = ['ask_which'];
  }

  /** One vacancy for a tool that needs exactly one; asks when it cannot tell. */
  private oneVacancy(c: ToolCtx, head: TKey): VacancyRef | null {
    if (c.list.length === 1) return c.list[0]!;
    if (c.live.length === 1) return c.live[0]!;
    this.which(c, head);
    return null;
  }

  // ------------------------------------------------------------------ compare

  private async compare(c: ToolCtx) {
    const { a } = c;
    const lang = a.language;
    const picks = await this.resolve(c, 3);
    if (picks.length < 2) {
      a.kind = 'help';
      a.headline = tsay(lang, 'compareWho');
      a.flags = ['not_understood'];
      return;
    }
    if (new Set(picks.map((r) => r.vacancyId)).size > 1) {
      a.kind = 'help';
      a.headline = tsay(lang, 'compareSameVacancy');
      a.flags = ['compare_mixed_vacancies'];
      return;
    }
    const items = await this.items(picks.map((r) => r.matchId));
    const texts: { text: string; classification: string }[] = [];
    for (const m of picks) {
      for (const i of items.get(m.matchId) ?? []) {
        if (i.classification === 'informational' || i.classification === 'disqualifier') continue;
        if (!texts.some((t) => t.text === i.text))
          texts.push({ text: i.text, classification: i.classification });
      }
    }
    const cell = (matchId: string, text: string) => {
      const it = (items.get(matchId) ?? []).find((i) => i.text === text);
      return it ? tsay(lang, STATUS[it.status] ?? 'st_not_found') : tsay(lang, 'st_not_found');
    };
    const table: AnswerTable = {
      head: [tsay(lang, 'hRequirement'), ...picks.map((r) => r.label)],
      rows: [
        {
          cells: [
            tsay(lang, 'hScore'),
            ...picks.map((r) => `${Math.round(r.score)}% · ${BAND_WORD[lang][r.band]}`),
          ],
        },
        ...texts.map((t) => ({
          cells: [t.text, ...picks.map((r) => cell(r.matchId, t.text))],
          tag: t.classification === 'mandatory' ? ('must' as const) : ('nice' as const),
        })),
      ],
    };
    a.kind = 'pool';
    a.vacancy = c.live.find((v) => v.id === picks[0]!.vacancyId) ?? null;
    a.table = table;
    a.subjects = picks.map((r) => r.pseudonym);
    a.headline = tsay(lang, 'compareHead', {
      title: picks[0]!.vacancyTitle,
      names: picks.map((r) => r.label).join(', '),
    });
    a.notes = [tsay(lang, 'compareNote')];
    a.flags = ['compare'];
  }

  // ------------------------------------------------------------------ doctor

  private async doctor(c: ToolCtx) {
    const { a } = c;
    const lang = a.language;
    const v = this.oneVacancy(c, 'whatIfNeedsVacancy');
    if (!v) return;
    a.kind = 'pool';
    a.vacancy = { id: v.id, title: v.title, status: v.status };
    a.flags = ['doctor'];
    const rows = await this.pool.rows([v.id]);
    if (!rows.length) {
      a.headline = tsay(lang, 'doctorNone', { title: v.title });
      return;
    }
    const items = await this.items(rows.map((r) => r.matchId));
    const agg = new Map<string, { kind: string; met: number; n: number; pos: number }>();
    for (const r of rows) {
      let pos = 0;
      for (const i of items.get(r.matchId) ?? []) {
        pos += 1;
        if (i.classification !== 'mandatory' && i.classification !== 'preferred') continue;
        const e = agg.get(i.text) ?? { kind: i.classification, met: 0, n: 0, pos };
        e.n += 1;
        if (i.status === 'met') e.met += 1;
        agg.set(i.text, e);
      }
    }
    const list = [...agg.entries()]
      .map(([text, e]) => ({ text, ...e, share: e.n ? e.met / e.n : 1 }))
      .sort(
        (x, y) =>
          Number(y.kind === 'mandatory') - Number(x.kind === 'mandatory') ||
          x.share - y.share ||
          x.pos - y.pos,
      );
    const must = list.filter((x) => x.kind === 'mandatory');
    const strong = rows.filter((r) => r.band === 'strong').length;
    a.table = {
      head: [tsay(lang, 'hRequirement'), tsay(lang, 'hMet')],
      rows: list.slice(0, 12).map((x) => ({
        cells: [x.text, `${x.met} / ${x.n} (${Math.round(x.share * 100)}%)`],
        tag: x.kind === 'mandatory' ? ('must' as const) : ('nice' as const),
      })),
    };
    if (must.length) {
      const rare = must[0]!;
      a.headline = tsay(lang, 'doctorHead', {
        title: v.title,
        strong,
        n: rows.length,
        req: rare.text,
        met: rare.met,
      });
      a.suggestions = must.slice(0, 2).map((x) => tsay(lang, 'doctorWhatIf', { req: x.text }));
    } else {
      a.headline = tsay(lang, 'doctorNoMust', { title: v.title, strong, n: rows.length });
    }
    a.notes = [tsay(lang, 'doctorNote')];
  }

  // ------------------------------------------------------------------ changes

  private async changes(c: ToolCtx) {
    const { a, q } = c;
    const lang = a.language;
    const list = c.list.length ? c.list : c.live;
    const one = list.length === 1 ? list[0]! : null;
    const scope = one ? one.title : tsay(lang, 'everywhere');
    const notes: string[] = [];
    let since = q.since;
    if (!since) {
      since = bakuDate(new Date(c.now.getTime() - 7 * 86400000));
      notes.push(tsay(lang, 'changesDefault'));
    }
    const from = new Date(`${since}T00:00:00+04:00`).toISOString();
    const rows = await this.pool.rows(list.map((v) => v.id));
    const fresh = rows.filter((r) => r.analyzedAt >= from);
    const marked = rows.filter((r) => r.decision !== 'new' && r.decidedAt && r.decidedAt >= from);
    const events = [
      ...fresh.map((r) => ({
        r,
        at: r.analyzedAt,
        what: `${tsay(lang, 'changesNew')}: ${Math.round(r.score)}% · ${BAND_WORD[lang][r.band]}`,
      })),
      ...marked.map((r) => ({
        r,
        at: r.decidedAt!,
        what: `${tsay(lang, 'changesMark')}: ${MARK_WORD[lang][r.decision]}`,
      })),
    ].sort((x, y) => y.at.localeCompare(x.at));
    a.kind = 'pool';
    a.vacancy = one ? { id: one.id, title: one.title, status: one.status } : null;
    a.flags = ['changes'];
    a.subjects = [...new Set(events.slice(0, 15).map((e) => e.r.pseudonym))];
    if (!events.length) {
      a.headline = tsay(lang, 'changesNone', { scope, date: since });
    } else {
      a.headline = tsay(lang, 'changesHead', {
        scope,
        date: since,
        fresh: fresh.length,
        marked: marked.length,
      });
      a.table = {
        head: [tsay(lang, 'hCandidate'), tsay(lang, 'hWhat'), tsay(lang, 'hWhen')],
        rows: events.slice(0, 15).map((e) => ({
          cells: [e.r.label, e.what, bakuDate(new Date(e.at))],
        })),
      };
    }
    a.notes = notes;
  }

  // ------------------------------------------------------------------ what if

  private async whatIf(c: ToolCtx) {
    const { a, q } = c;
    const lang = a.language;
    const v = this.oneVacancy(c, 'whatIfNeedsVacancy');
    if (!v) return;
    a.vacancy = { id: v.id, title: v.title, status: v.status };
    a.flags = ['what_if'];
    const w = q.whatIf ?? { text: '', to: 'nice' as const };
    const set = (await this.adj.currentSet(v.id)).filter(
      (r) => r.classification !== 'disqualifier',
    );
    const want = tokens(w.text).filter((t) => t.length >= 3);
    const scored = set
      .map((r) => {
        const have = new Set(tokens(r.text));
        const hit = want.filter(
          (t) => have.has(t) || [...have].some((h) => h.startsWith(t) || t.startsWith(h)),
        );
        return { r, n: hit.length };
      })
      .sort((x, y) => y.n - x.n);
    const best = scored[0];
    const unique = best && best.n > 0 && (scored.length < 2 || scored[1]!.n < best.n);
    if (!unique) {
      a.kind = 'help';
      a.headline = tsay(lang, want.length ? 'whatIfNoReq' : 'whatIfWhich');
      a.suggestions = set
        .slice(0, 6)
        .map((r) =>
          tsay(lang, w.to === 'nice' ? 'doctorWhatIf' : 'whatIfChipMust', { req: r.text }),
        );
      return;
    }
    const req = best.r;
    const overlay = await this.adj.overlay(v.id);
    overlay.set(req.id, w.to === 'nice' ? 'preferred' : 'mandatory');
    const rows = await this.pool.rows([v.id]);
    const rescored = await this.adj.rescore(
      rows.map((r) => r.matchId),
      overlay,
    );
    const after = rows.map((r) => {
      const s = rescored.get(r.matchId)?.score;
      const score = s === null || s === undefined ? r.score : s;
      return { r, score, band: bandOf(score) };
    });
    const s0 = rows.filter((r) => r.band === 'strong').length;
    const s1 = after.filter((x) => x.band === 'strong').length;
    const moved = after.filter((x) => x.band !== x.r.band);
    a.kind = 'pool';
    a.subjects = moved.slice(0, 10).map((x) => x.r.pseudonym);
    a.headline = tsay(lang, 'whatIfHead', {
      req: req.text,
      to: tsay(lang, w.to === 'nice' ? 'whatIfNice' : 'whatIfMust'),
      s0,
      s1,
      moved: moved.length,
    });
    const changed = after
      .filter((x) => x.band !== x.r.band || Math.abs(x.score - x.r.score) >= 5)
      .sort((x, y) => y.score - x.score)
      .slice(0, 10);
    if (changed.length)
      a.table = {
        head: [tsay(lang, 'hCandidate'), tsay(lang, 'hNow'), tsay(lang, 'hIf')],
        rows: changed.map((x) => ({
          cells: [
            x.r.label,
            `${Math.round(x.r.score)}% · ${BAND_WORD[lang][x.r.band]}`,
            `${Math.round(x.score)}% · ${BAND_WORD[lang][x.band]}`,
          ],
        })),
      };
    a.notes = [tsay(lang, 'whatIfNote')];
    a.actions = [
      { label: tsay(lang, 'openVacancy', { title: v.title }), href: `#/vacancies/${v.id}` },
    ];
  }

  // ------------------------------------------------------------------ open and interview

  private async open(c: ToolCtx) {
    const { a } = c;
    const lang = a.language;
    const picks = await this.resolve(c, 3);
    if (picks.length) {
      a.kind = 'pool';
      a.headline = tsay(lang, 'openHead');
      a.actions = picks.map((r) => ({
        label: tsay(lang, 'openCandidate', { name: r.label }),
        href: `#/candidates/${r.matchId}`,
      }));
      a.subjects = picks.map((r) => r.pseudonym);
      a.flags = ['open'];
      return;
    }
    const v = c.named ?? (c.list.length === 1 ? c.list[0]! : null);
    if (v) {
      a.kind = 'pool';
      a.vacancy = { id: v.id, title: v.title, status: v.status };
      a.headline = tsay(lang, 'openHead');
      a.actions = [
        { label: tsay(lang, 'openVacancy', { title: v.title }), href: `#/vacancies/${v.id}` },
      ];
      a.flags = ['open'];
      return;
    }
    a.kind = 'help';
    a.headline = tsay(lang, 'openWhich');
    a.flags = ['not_understood'];
  }

  private async interview(c: ToolCtx) {
    const { a } = c;
    const lang = a.language;
    const picks = await this.resolve(c, 2);
    if (picks.length !== 1) {
      a.kind = 'help';
      a.headline = tsay(lang, 'interviewWho');
      a.flags = ['not_understood'];
      return;
    }
    const r = picks[0]!;
    a.kind = 'pool';
    a.headline = tsay(lang, 'interviewHead');
    a.notes = [tsay(lang, 'interviewNote')];
    a.actions = [
      { label: tsay(lang, 'openCandidate', { name: r.label }), href: `#/candidates/${r.matchId}` },
    ];
    a.subjects = [r.pseudonym];
    a.flags = ['interview_pointer'];
  }

  // ------------------------------------------------------------------ recall, about

  /** What the person concluded before: their own conversations only, headlines only. */
  private async recall(c: ToolCtx) {
    const { a, q } = c;
    const lang = a.language;
    const terms = q.skills.map((s) => `%${s.label}%`);
    const { rows } = await this.db.query<{ title: string; headline: string; at: Date }>(
      `SELECT cv.title, m.content->>'headline' AS headline, m.created_at AS at
         FROM assistant_pool_message m JOIN assistant_conversation cv ON cv.id = m.conversation_id
        WHERE cv.user_id = $1 AND cv.deleted_at IS NULL AND m.role = 'assistant'
          AND m.content->>'kind' = 'pool'
          AND ($2::text[] = '{}' OR m.content->>'headline' ILIKE ANY($2::text[]) OR cv.title ILIKE ANY($2::text[]))
        ORDER BY m.created_at DESC LIMIT 5`,
      [c.p.userId, terms],
    );
    a.kind = 'help';
    a.flags = ['recall'];
    if (!rows.length) {
      a.headline = tsay(lang, 'recallNone');
      return;
    }
    a.headline = tsay(lang, 'recallHead');
    a.table = {
      head: [tsay(lang, 'hWhen'), tsay(lang, 'hQuestion'), tsay(lang, 'hAnswer')],
      rows: rows.map((r) => ({
        cells: [bakuDate(new Date(r.at)), r.title, r.headline ?? ''],
      })),
    };
  }

  private about(c: ToolCtx) {
    const { a, reg } = c;
    const lang: Lang = a.language;
    a.kind = 'help';
    a.flags = ['about'];
    a.headline = tsay(lang, 'aboutHead');
    a.notes = [tsay(lang, 'aboutSees'), tsay(lang, 'aboutDoes')];
    if (reg?.q) {
      a.notes.push(
        tsay(lang, 'aboutLast', { read: describe(reg.q) }),
        tsay(lang, reg.q.source === 'model' ? 'aboutLastModel' : 'aboutLastRules'),
      );
    }
  }
}
