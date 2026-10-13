/**
 * The deeper SenAI tools (plan 5.1 F6 F8 F9, 5.2 M2 M3 M4 M6, 5.4 S4, 6.4): interview kit, consistency
 * mirror, data quality, JD coach, similar vacancies, rediscovery, the pushback check and preferences.
 * All read-only except the person's own typed preference. Fixed wording; nothing here judges a person.
 */
import { Injectable } from '@nestjs/common';
import { fold, skillsInTokens, tokens } from '@cv/shared';
import { DbService } from '../../db/db.service';
import { anonymise } from '../../pipeline/anonymise';
import { AdjustmentService } from '../../pipeline/adjustments.service';
import { PoolService, type PoolRow } from '../../pipeline/pool.service';
import { MARK_WORD, type VacancyRef } from '../pool-assistant';
import { NOT_JOB_RELATED, dsay } from './deep-words';
import { tsay } from './tools-words';
import { searchText, PoolSearch } from './search';
import type { ToolCtx } from './tools';

interface Item {
  text: string;
  classification: string;
  status: string;
}

const pct = (n: number) => Math.round(n * 100);

/** Five-word shingles of a folded text, for comparing two resumes. */
function shingles(text: string): Set<string> {
  const w = tokens(text);
  const out = new Set<string>();
  for (let i = 0; i + 5 <= w.length; i++) out.add(w.slice(i, i + 5).join(' '));
  return out;
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

@Injectable()
export class DeepTools {
  constructor(
    private readonly db: DbService,
    private readonly pool: PoolService,
    private readonly adj: AdjustmentService,
    private readonly search: PoolSearch,
  ) {}

  private async items(ids: string[]): Promise<Map<string, Item[]>> {
    if (!ids.length) return new Map();
    const { rows } = await this.db.query<{ id: string; items: Item[] | null }>(
      `SELECT id, breakdown->'items' AS items FROM screening WHERE id = ANY($1::char(26)[])`,
      [ids],
    );
    return new Map(rows.map((r) => [r.id, r.items ?? []]));
  }

  private vacancyOrAsk(c: ToolCtx): VacancyRef | null {
    const one = c.list.length === 1 ? c.list[0]! : c.live.length === 1 ? c.live[0]! : null;
    if (one) return one;
    c.a.kind = 'ask_which';
    c.a.headline = dsay(c.a.language, 'needVacancy');
    c.a.options = c.live.slice(0, 8).map((v) => ({ id: v.id, title: v.title, status: v.status }));
    c.a.flags = ['ask_which'];
    return null;
  }

  // ------------------------------------------------------------------ preferences

  async prefs(c: ToolCtx) {
    const n = c.q.top ?? 5;
    await this.db.query(
      `INSERT INTO assistant_preference (user_id, top_n) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET top_n = $2, updated_at = now()`,
      [c.p.userId, n],
    );
    c.a.kind = 'help';
    c.a.headline = dsay(c.a.language, 'prefSaved', { n });
    c.a.flags = ['preference'];
  }

  async prefTop(userId: string): Promise<number | null> {
    const { rows } = await this.db.query<{ top_n: number | null }>(
      `SELECT top_n FROM assistant_preference WHERE user_id = $1`,
      [userId],
    );
    return rows[0]?.top_n ?? null;
  }

  /** The person's own saved "always show N", from the account menu (plan F6). */
  async clearPref(userId: string): Promise<void> {
    await this.db.query(`DELETE FROM assistant_preference WHERE user_id = $1`, [userId]);
  }
  async setPref(userId: string, n: number): Promise<void> {
    await this.db.query(
      `INSERT INTO assistant_preference (user_id, top_n) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET top_n = $2, updated_at = now()`,
      [userId, n],
    );
  }

  // ------------------------------------------------------------------ interview kit

  /** Same core question per requirement for everyone, a rubric, and probes from this resume. */
  async kit(c: ToolCtx, row: PoolRow) {
    const lang = c.a.language;
    const items = (await this.items([row.matchId])).get(row.matchId) ?? [];
    const reqs = items.filter(
      (i) => i.classification === 'mandatory' || i.classification === 'preferred',
    );
    c.a.kind = 'pool';
    c.a.vacancy = c.live.find((v) => v.id === row.vacancyId) ?? null;
    c.a.headline = dsay(lang, 'kitHead', { name: row.label });
    c.a.table = {
      head: [dsay(lang, 'hQuestion2'), dsay(lang, 'hRubric'), dsay(lang, 'hProbe')],
      rows: reqs.map((r) => ({
        cells: [
          dsay(lang, 'kitQuestion', { req: r.text }),
          dsay(lang, 'kitRubric'),
          dsay(
            lang,
            r.status === 'met'
              ? 'kitProbeMet'
              : r.status === 'partially_met'
                ? 'kitProbePartly'
                : 'kitProbeNone',
          ),
        ],
        tag: r.classification === 'mandatory' ? ('must' as const) : ('nice' as const),
      })),
    };
    c.a.notes = [dsay(lang, 'kitNote')];
    c.a.subjects = [row.pseudonym];
    c.a.copyable = true;
    c.a.flags = ['interview_kit'];
  }

  // ------------------------------------------------------------------ consistency mirror

  async consistency(c: ToolCtx) {
    const lang = c.a.language;
    const list = c.list.length ? c.list : c.live;
    const one = list.length === 1 ? list[0]! : null;
    const scope = one ? one.title : tsay(lang, 'everywhere');
    const rows = await this.pool.rows(list.map((v) => v.id));
    // Only the person's own marks are read.
    const { rows: own } = await this.db.query<{ document_id: string }>(
      `SELECT DISTINCT ON (s.document_id) s.document_id
         FROM decision x JOIN screening s ON s.id = x.screening_id
        WHERE s.document_id = ANY($1::char(26)[]) AND x.decided_by = $2
        ORDER BY s.document_id, x.decided_at DESC, x.id DESC`,
      [rows.map((r) => r.documentId), c.p.userId],
    );
    const mine = new Set(own.map((r) => r.document_id));
    const items = await this.items(rows.map((r) => r.matchId));
    const sig = (r: PoolRow) =>
      (items.get(r.matchId) ?? [])
        .filter((i) => i.classification === 'mandatory')
        .map((i) => `${i.text}:${i.status}`)
        .sort()
        .join('|');
    const marked = rows.filter((r) => mine.has(r.documentId) && r.decision !== 'new');
    const pairs: [PoolRow, PoolRow][] = [];
    for (let i = 0; i < marked.length; i++)
      for (let j = i + 1; j < marked.length; j++) {
        const a = marked[i]!;
        const b = marked[j]!;
        if (a.vacancyId !== b.vacancyId || !sig(a)) continue;
        if (sig(a) !== sig(b)) continue;
        const pos = (d: string) => d === 'shortlist' || d === 'maybe';
        if (
          (pos(a.decision) && b.decision === 'not_now') ||
          (pos(b.decision) && a.decision === 'not_now')
        )
          pairs.push([a, b]);
      }
    const notes: string[] = [];
    for (const r of marked.filter((x) => x.decision === 'not_now' && x.decisionNote)) {
      if (NOT_JOB_RELATED.test(r.decisionNote!) || NOT_JOB_RELATED.test(fold(r.decisionNote!)))
        notes.push(dsay(lang, 'consReason', { name: r.label, note: r.decisionNote!.slice(0, 60) }));
    }
    const miss1 = rows.filter(
      (r) =>
        r.band === 'partial' &&
        r.decision === 'new' &&
        r.mustTotal - r.mustFound === 1 &&
        r.mustTotal > 0,
    ).length;
    if (miss1) notes.push(dsay(lang, 'consOne', { n: miss1 }));
    c.a.kind = 'pool';
    c.a.vacancy = one ? { id: one.id, title: one.title, status: one.status } : null;
    c.a.flags = ['consistency'];
    c.a.subjects = [...new Set(pairs.flatMap(([a, b]) => [a.pseudonym, b.pseudonym]))];
    if (pairs.length) {
      c.a.headline = dsay(lang, 'consHead', { n: pairs.length, scope });
      c.a.table = {
        head: [
          tsay(lang, 'hCandidate'),
          tsay(lang, 'hCandidate'),
          dsay(lang, 'hSame'),
          dsay(lang, 'hMarks'),
        ],
        rows: pairs.slice(0, 10).map(([a, b]) => ({
          cells: [
            a.label,
            b.label,
            `${a.mustFound}/${a.mustTotal}`,
            `${MARK_WORD[lang][a.decision]} / ${MARK_WORD[lang][b.decision]}`,
          ],
        })),
      };
    } else c.a.headline = dsay(lang, 'consNone', { scope });
    c.a.notes = [...notes, dsay(lang, 'consNote')];
  }

  // ------------------------------------------------------------------ data quality

  async quality(c: ToolCtx) {
    const lang = c.a.language;
    const list = c.list.length ? c.list : c.live;
    const one = list.length === 1 ? list[0]! : null;
    const scope = one ? one.title : tsay(lang, 'everywhere');
    const rows = (await this.pool.rows(list.map((v) => v.id))).slice(0, 300);
    const { rows: docs } = await this.db.query<{ id: string; text: string | null }>(
      `SELECT id, text FROM cv_document WHERE id = ANY($1::char(26)[]) AND erased_at IS NULL`,
      [rows.map((r) => r.documentId)],
    );
    const text = new Map(docs.map((d) => [d.id, d.text ?? '']));
    const sh = new Map(rows.map((r) => [r.documentId, shingles(text.get(r.documentId) ?? '')]));
    const out: { cells: string[] }[] = [];
    let dups = 0;
    let thin = 0;
    let ru = 0;
    for (let i = 0; i < rows.length; i++)
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i]!;
        const b = rows[j]!;
        const s = jaccard(sh.get(a.documentId)!, sh.get(b.documentId)!);
        if (s >= 0.9) {
          dups += 1;
          if (out.length < 15)
            out.push({
              cells: [
                `${a.label} / ${b.label}`,
                dsay(lang, 'qualDup', { a: a.label, b: b.label, pct: pct(s) }),
              ],
            });
        }
      }
    for (const r of rows) {
      const t = text.get(r.documentId) ?? '';
      if (t.trim().length < 400) {
        thin += 1;
        if (out.length < 15) out.push({ cells: [r.label, dsay(lang, 'qualThin')] });
      }
      const letters = t.match(/\p{L}/gu)?.length ?? 0;
      const cyr = t.match(/[Ѐ-ӿ]/g)?.length ?? 0;
      if (letters > 200 && cyr / letters > 0.3) {
        ru += 1;
        if (out.length < 15) out.push({ cells: [r.label, dsay(lang, 'qualRu')] });
      }
    }
    c.a.kind = 'pool';
    c.a.vacancy = one ? { id: one.id, title: one.title, status: one.status } : null;
    c.a.flags = ['data_quality'];
    c.a.subjects = rows.slice(0, 15).map((r) => r.pseudonym);
    if (!out.length) {
      c.a.headline = dsay(lang, 'qualNone', { scope });
      return;
    }
    c.a.headline = dsay(lang, 'qualHead', { scope, dups, thin, ru });
    c.a.table = { head: [tsay(lang, 'hCandidate'), dsay(lang, 'hIssue')], rows: out };
    c.a.notes = [dsay(lang, 'qualNote')];
  }

  // ------------------------------------------------------------------ JD coach

  /** The suggestions for a vacancy's wording and requirements. Read-only; never blocks or edits. */
  async jdTips(
    v: { id: string; title: string },
    lang: ToolCtx['a']['language'],
  ): Promise<{ tips: string[]; empty: boolean }> {
    const set = (await this.adj.currentSet(v.id)).filter(
      (r) => r.classification !== 'disqualifier',
    );
    const { rows } = await this.db.query<{ body: string }>(
      `SELECT body FROM job_description_version WHERE vacancy_id = $1 ORDER BY version DESC LIMIT 1`,
      [v.id],
    );
    const body = rows[0]?.body ?? '';
    if (!set.length && !body.trim()) return { tips: [], empty: true };
    const f = fold(`${v.title} ${body}`);
    const tips: string[] = [];
    const must = set.filter((r) => r.classification === 'mandatory').length;
    if (must > 8) tips.push(dsay(lang, 'jdMany', { n: must }));
    const years = /(\d{1,2})\s*\+?\s*(?:years?|il|yil|лет|года?)/.exec(f);
    if (
      /\b(junior|entry level|entry-level|baslangic|начинающ\w*|джуниор)\b/.test(f) &&
      years &&
      Number(years[1]) >= 5
    )
      tips.push(dsay(lang, 'jdJunior', { years: years[1]! }));
    const wording =
      /\b(young|youthful|native speaker|energetic young|under \d\d|up to \d\d years old|gənc|genc kollektiv|yas ?\d\d|кандидат моложе|молод\w+ коллектив|носитель языка)\b/.exec(
        f,
      );
    if (wording) tips.push(dsay(lang, 'jdWording', { w: wording[0] }));
    if (body.trim() && !years) tips.push(dsay(lang, 'jdNoRange'));
    const reqText = fold(set.map((r) => r.text).join(' '));
    const seen = new Set<string>();
    for (const h of skillsInTokens(tokens(body))) {
      if (seen.has(h.skill.id)) continue;
      seen.add(h.skill.id);
      const inReq = skillsInTokens(tokens(reqText)).some((x) => x.skill.id === h.skill.id);
      if (!inReq) tips.push(dsay(lang, 'jdMissing', { skill: h.skill.label }));
      if (tips.length >= 8) break;
    }
    return { tips, empty: false };
  }

  async jd(c: ToolCtx) {
    const lang = c.a.language;
    const v = this.vacancyOrAsk(c);
    if (!v) return;
    c.a.vacancy = { id: v.id, title: v.title, status: v.status };
    c.a.flags = ['jd_check'];
    c.a.kind = 'pool';
    const { tips, empty } = await this.jdTips(v, lang);
    if (empty) {
      c.a.headline = dsay(lang, 'jdNoReqs');
      return;
    }
    c.a.headline = tips.length
      ? dsay(lang, 'jdHead', { title: v.title, n: tips.length })
      : dsay(lang, 'jdClean', { title: v.title });
    c.a.notes = tips;
    c.a.actions = [{ label: v.title, href: `#/vacancies/${v.id}` }];
  }

  // ------------------------------------------------------------------ similar vacancies

  async similar(c: ToolCtx) {
    const lang = c.a.language;
    const v = this.vacancyOrAsk(c);
    if (!v) return;
    c.a.vacancy = { id: v.id, title: v.title, status: v.status };
    c.a.flags = ['similar_vacancies'];
    const mine = (await this.adj.currentSet(v.id)).filter(
      (r) => r.classification !== 'disqualifier',
    );
    const sig = (t: string) => new Set(tokens(t).filter((w) => w.length > 2));
    const near = (a: Set<string>, b: Set<string>) => {
      if (!a.size || !b.size) return false;
      let k = 0;
      for (const x of a) if (b.has(x)) k += 1;
      return k / Math.min(a.size, b.size) >= 0.7;
    };
    const mineSig = mine.map((r) => sig(r.text));
    const out: { v: VacancyRef; shared: number }[] = [];
    for (const o of c.live.filter((x) => x.id !== v.id)) {
      const theirs = (await this.adj.currentSet(o.id))
        .filter((r) => r.classification !== 'disqualifier')
        .map((r) => sig(r.text));
      const shared = mineSig.filter((m) => theirs.some((t) => near(m, t))).length;
      if (mine.length && shared / mine.length >= 0.5) out.push({ v: o, shared });
    }
    out.sort((a, b) => b.shared - a.shared);
    c.a.kind = 'pool';
    if (!out.length) {
      c.a.headline = dsay(lang, 'simNone', { title: v.title });
      return;
    }
    c.a.headline = dsay(lang, 'simHead', { n: out.length, title: v.title });
    c.a.table = {
      head: [dsay(lang, 'hVacancy'), dsay(lang, 'hShared')],
      rows: out.slice(0, 6).map((x) => ({ cells: [x.v.title, `${x.shared} / ${mine.length}`] })),
    };
    c.a.actions = out.slice(0, 3).map((x) => ({ label: x.v.title, href: `#/vacancies/${x.v.id}` }));
  }

  // ------------------------------------------------------------------ rediscovery (switch)

  async rediscover(c: ToolCtx, enabled: boolean) {
    const lang = c.a.language;
    if (!enabled) {
      c.a.kind = 'help';
      c.a.headline = dsay(lang, 'redOff');
      c.a.flags = ['switch_off:rediscovery'];
      return;
    }
    const v = this.vacancyOrAsk(c);
    if (!v) return;
    c.a.vacancy = { id: v.id, title: v.title, status: v.status };
    c.a.flags = ['rediscovery'];
    const must = (await this.adj.currentSet(v.id)).filter((r) => r.classification === 'mandatory');
    const skills = new Map<string, ReturnType<typeof skillsInTokens>[number]['skill']>();
    for (const r of must)
      for (const h of skillsInTokens(tokens(r.text))) skills.set(h.skill.id, h.skill);
    c.a.kind = 'pool';
    if (!skills.size) {
      c.a.headline = dsay(lang, 'redNoSkills', { title: v.title });
      return;
    }
    const others = (
      await this.pool.rows(c.live.filter((x) => x.id !== v.id).map((x) => x.id))
    ).filter(
      (r) =>
        r.band === 'strong' ||
        r.band === 'good' ||
        r.decision === 'shortlist' ||
        r.decision === 'maybe',
    );
    const per = new Map<string, string[]>();
    for (const s of skills.values()) {
      const found = await this.search.skills(
        others,
        [{ id: s.id, label: s.label, phrase: null, words: [] }],
        false,
      );
      for (const r of others)
        if (found.has(r.documentId)) per.set(r.matchId, [...(per.get(r.matchId) ?? []), s.label]);
    }
    const need = Math.max(2, Math.ceil(skills.size * 0.6));
    const hit = others
      .filter((r) => (per.get(r.matchId)?.length ?? 0) >= Math.min(need, skills.size))
      .sort(
        (a, b) =>
          per.get(b.matchId)!.length - per.get(a.matchId)!.length || PoolService.byMatch(a, b),
      )
      .slice(0, 8);
    if (!hit.length) {
      c.a.headline = dsay(lang, 'redNone', { title: v.title });
      return;
    }
    c.a.headline = dsay(lang, 'redHead', { n: hit.length, title: v.title });
    c.a.table = {
      head: [tsay(lang, 'hCandidate'), dsay(lang, 'hVacancy'), dsay(lang, 'hMentions')],
      rows: hit.map((r) => ({
        cells: [
          r.label,
          r.vacancyTitle,
          `${per.get(r.matchId)!.length} / ${skills.size}: ${per.get(r.matchId)!.join(', ')}`,
        ],
      })),
    };
    c.a.actions = hit
      .slice(0, 3)
      .map((r) => ({ label: r.label, href: `#/candidates/${r.matchId}` }));
    c.a.analyze = hit.map((r) => ({ matchId: r.matchId, vacancyId: v.id, label: r.label }));
    c.a.subjects = hit.map((r) => r.pseudonym);
    c.a.notes = [dsay(lang, 'redNote')];
  }

  // ------------------------------------------------------------------ pushback: hold or update

  /** "But he does know Kubernetes": the resume text is checked; the stored state is never changed here. */
  async challenge(c: ToolCtx, picks: PoolRow[]) {
    const lang = c.a.language;
    if (picks.length !== 1) {
      c.a.kind = 'help';
      c.a.headline = dsay(lang, 'chlWho');
      c.a.flags = ['not_understood'];
      return;
    }
    const r = picks[0]!;
    const skill = c.q.skills.map((s) => s.label).join(', ');
    const { rows } = await this.db.query<{ text: string | null }>(
      `SELECT text FROM cv_document WHERE id = $1 AND erased_at IS NULL`,
      [r.documentId],
    );
    const raw = rows[0]?.text ?? '';
    const hit = raw ? searchText(raw, c.q.skills, c.q.mode === 'any') : null;
    c.a.kind = 'pool';
    c.a.vacancy = c.live.find((v) => v.id === r.vacancyId) ?? null;
    c.a.subjects = [r.pseudonym];
    if (hit && hit.passages.length) {
      c.a.headline = dsay(lang, 'chlFound', { skill, name: r.label });
      c.a.table = {
        head: [tsay(lang, 'hCandidate'), '…'],
        rows: hit.passages.map((p) => ({
          cells: [p.skill, anonymise(raw.slice(p.start, p.end), [r.label]).text.trim()],
        })),
      };
      c.a.actions = [
        { label: dsay(lang, 'chlReanalyze', { name: r.label }), href: `#/candidates/${r.matchId}` },
      ];
      c.a.flags = ['possible_missed_evidence'];
    } else {
      c.a.headline = dsay(lang, 'chlNotFound', { skill, name: r.label });
      c.a.flags = ['pushback_held'];
    }
    c.a.notes = [dsay(lang, 'chlNote')];
  }
}
