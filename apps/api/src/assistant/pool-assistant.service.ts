import { Injectable, NotFoundException } from '@nestjs/common';
import { BAND_LABEL, MARK_LABEL, newId, type Mark } from '@cv/shared';
import { AuditService } from '../audit/audit.service';
import type { Principal } from '../auth/principal';
import { DbService } from '../db/db.service';
import { PoolService, type PoolRow } from '../pipeline/pool.service';
import { VacancyScope } from '../vacancy/vacancy-scope.service';
import { asksDecision, asksProtected, hijacks } from './assistant-rules';
import { AssistantOff, AssistantService } from './assistant.service';
import {
  SUGGESTIONS,
  detectLanguage,
  parseQuestion,
  resolveVacancy,
  say,
  type Lang,
  type VacancyRef,
} from './pool-assistant';

export interface PoolAnswerRow {
  matchId: string;
  label: string;
  pseudonym: string;
  score: number;
  band: PoolRow['band'];
  bandLabel: string;
  mustFound: number;
  mustTotal: number;
  decision: Mark;
  decisionLabel: string;
  outOfDate: boolean;
  /** Requirement wording only (recruiter-written), never resume text. */
  strengths: string[];
  missing: string[];
}

export interface PoolAnswer {
  kind: 'pool' | 'ask_which' | 'confirm' | 'no_match' | 'decline' | 'help';
  headline: string;
  notes: string[];
  vacancy: { id: string; title: string; status: string } | null;
  /** A choice the person must make; picking one sends the question again with that vacancy. */
  options: { id: string; title: string; status: string }[];
  counts: {
    total: number;
    analyzed: number;
    strong: number;
    good: number;
    partial: number;
    limited: number;
    shortlist: number;
    outOfDate: number;
    running: number;
    needsLook: number;
  } | null;
  rows: PoolAnswerRow[];
  /** Candidates that exist beyond the ones shown. */
  more: number;
  asOf: string;
  suggestions: string[];
  flags: string[];
  language: Lang;
}

export interface PoolAskInput {
  message: string;
  conversationId?: string;
  /** Where the person is (a vacancy page): used only when the question names no vacancy. */
  vacancyId?: string;
  /** The person picked this vacancy from the options. */
  pick?: string;
  showAll?: boolean;
  language?: Lang;
}

const empty = (language: Lang, now: string): PoolAnswer => ({
  kind: 'help',
  headline: '',
  notes: [],
  vacancy: null,
  options: [],
  counts: null,
  rows: [],
  more: 0,
  asOf: now,
  suggestions: [],
  flags: [],
  language,
});

/**
 * Pool answers (WP 4.4). Every number is counted from PoolService rows, the order is the pool's
 * order, and the sentences are written in pool-assistant.ts. The question is kept with the
 * answer; the person's name is never part of either.
 */
@Injectable()
export class PoolAssistantService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly scope: VacancyScope,
    private readonly pool: PoolService,
    private readonly assistant: AssistantService,
  ) {}

  async ask(p: Principal, input: PoolAskInput, ip: string | undefined) {
    const s = await this.assistant.settings();
    if (!s.enabled) throw new AssistantOff();
    const text = input.message.trim().slice(0, 1000);
    const lang: Lang = detectLanguage(text) ?? input.language ?? 'en';
    const now = new Date().toISOString();
    const a = empty(lang, now);

    const ids = await this.scope.visibleIds(p, true);
    const { rows: vrows } = ids.length
      ? await this.db.query<VacancyRef & { archived: boolean }>(
          `SELECT id, title, status, archived_at IS NOT NULL AS archived FROM vacancy
            WHERE id = ANY($1::char(26)[]) ORDER BY updated_at DESC`,
          [ids],
        )
      : { rows: [] };
    const live = vrows.filter((v) => !v.archived);

    let vacancy: VacancyRef | null = null;
    const pickOptions = (list: VacancyRef[]) =>
      list.slice(0, 8).map((v) => ({ id: v.id, title: v.title, status: v.status }));

    if (hijacks(text)) {
      Object.assign(a, {
        kind: 'decline',
        headline: say(lang, 'hijack'),
        flags: ['refused:instruction_override'],
      });
    } else if (asksProtected(text)) {
      Object.assign(a, {
        kind: 'decline',
        headline: say(lang, 'protectedAttr'),
        flags: ['refused:protected_attribute'],
      });
    } else if (asksDecision(text)) {
      Object.assign(a, {
        kind: 'decline',
        headline: say(lang, 'decision'),
        flags: ['refused:decision'],
      });
    } else {
      const parsed = parseQuestion(text);
      let confirmed = false;
      if (input.pick) {
        const hit = live.find((v) => v.id === input.pick);
        if (!hit) throw new NotFoundException();
        vacancy = hit;
        confirmed = true;
      } else {
        const res = resolveVacancy(text, live);
        if (res.tier === 'exact' || res.tier === 'close') {
          if (res.matches.length === 1) vacancy = res.matches[0]!;
          else
            Object.assign(a, {
              kind: 'ask_which',
              headline: say(lang, 'which'),
              options: pickOptions(res.matches),
              flags: ['ask_which'],
            });
        } else if (res.tier === 'partial') {
          Object.assign(a, {
            kind: res.matches.length === 1 ? 'confirm' : 'ask_which',
            headline: say(lang, res.matches.length === 1 ? 'confirm' : 'which'),
            options: pickOptions(res.matches),
            flags: ['ask_which'],
          });
        } else {
          // Nothing named: the page the person is on, if any.
          const page = input.vacancyId ? live.find((v) => v.id === input.vacancyId) : undefined;
          if (page) vacancy = page;
          else {
            const archivedHit = vrows.find(
              (v) => v.archived && ['exact', 'close'].includes(resolveVacancy(text, [v]).tier),
            );
            if (archivedHit) {
              Object.assign(a, {
                kind: 'no_match',
                headline: say(lang, 'archived', { title: archivedHit.title }),
                flags: ['archived_excluded'],
              });
            } else if (parsed.ask === 'unknown' && !live.length) {
              Object.assign(a, { kind: 'help', headline: say(lang, 'noVacancies') });
            } else if (parsed.ask === 'unknown') {
              Object.assign(a, {
                kind: 'help',
                headline: say(lang, 'help'),
                suggestions: this.suggest(lang, live[0]?.title),
              });
            } else {
              Object.assign(a, {
                kind: 'no_match',
                headline: live.length ? say(lang, 'noMatch') : say(lang, 'noVacancies'),
                options: pickOptions(live),
                flags: ['no_match'],
              });
            }
          }
        }
      }
      void confirmed;
      if (vacancy) await this.answerFor(a, vacancy, parsed, input.showAll === true);
    }

    return this.save(p, input, text, a, ip);
  }

  private suggest(lang: Lang, title?: string): string[] {
    const t = title ?? '…';
    return SUGGESTIONS[lang].map((x) => x.replace('{vacancy}', t));
  }

  private async answerFor(
    a: PoolAnswer,
    v: VacancyRef,
    parsed: ReturnType<typeof parseQuestion>,
    showAll: boolean,
  ) {
    const lang = a.language;
    const rows = (await this.pool.rows([v.id])).sort(PoolService.byMatch);
    const { rows: stat } = await this.db.query<{ docs: number; running: number }>(
      `SELECT count(*)::int AS docs,
              count(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM screening s WHERE s.document_id = d.id AND s.state IN ('queued', 'processing')
                   AND s.cancelled_at IS NULL))::int AS running
         FROM cv_document d WHERE d.vacancy_id = $1 AND d.erased_at IS NULL`,
      [v.id],
    );
    const docs = stat[0]!.docs;
    const analyzed = rows.length;
    const runningNoResult = Math.max(
      0,
      stat[0]!.running - rows.filter((r) => r.reanalyzing).length,
    );
    const needsLook = Math.max(0, docs - analyzed - runningNoResult);
    const by = (b: PoolRow['band']) => rows.filter((r) => r.band === b).length;
    const counts = {
      total: docs,
      analyzed,
      strong: by('strong'),
      good: by('good'),
      partial: by('partial'),
      limited: by('limited'),
      shortlist: rows.filter((r) => r.decision === 'shortlist').length,
      outOfDate: rows.filter((r) => r.outOfDate).length,
      running: stat[0]!.running,
      needsLook,
    };
    a.vacancy = { id: v.id, title: v.title, status: v.status };
    a.counts = counts;
    a.kind = 'pool';
    const title = v.title;
    const notes: string[] = [];

    if (docs === 0) {
      a.headline = say(lang, 'noResumes', { title });
      a.flags.push('no_resumes');
      return;
    }
    if (analyzed === 0) {
      a.headline = say(lang, 'noneAnalyzed', { title });
      a.flags.push('none_analyzed');
    } else if (parsed.ask === 'count') {
      a.headline = say(lang, 'count', {
        n: analyzed,
        title,
        strong: counts.strong,
        shortlist: counts.shortlist,
      });
    } else if (parsed.ask === 'shortlist') {
      const list = rows.filter((r) => r.decision === 'shortlist');
      a.headline = list.length
        ? say(lang, 'shortlist', { n: list.length, title })
        : say(lang, 'shortlistNone', { title });
      await this.fill(a, list, parsed.all || showAll ? 50 : parsed.top);
    } else {
      a.headline = say(lang, 'found', {
        n: analyzed,
        title,
        strong: counts.strong,
        good: counts.good,
        partial: counts.partial,
        limited: counts.limited,
      });
      await this.fill(a, rows, parsed.all || showAll ? 50 : parsed.top);
      if (a.more > 0 && !(parsed.all || showAll))
        notes.push(say(lang, 'top', { k: a.rows.length }));
    }
    if (counts.outOfDate) {
      notes.push(say(lang, 'outOfDate', { n: counts.outOfDate }));
      a.flags.push('out_of_date');
    }
    if (counts.running) {
      notes.push(say(lang, 'running', { n: counts.running }));
      a.flags.push('running');
    }
    if (counts.needsLook) {
      notes.push(say(lang, 'unanalyzed', { n: counts.needsLook }));
      a.flags.push('unanalyzed');
    }
    a.notes = notes;
  }

  /** The rows shown, each with the requirement wording that explains it. */
  private async fill(a: PoolAnswer, list: PoolRow[], limit: number) {
    const shown = list.slice(0, limit);
    a.more = Math.max(0, list.length - shown.length);
    if (!shown.length) return;
    const { rows } = await this.db.query<{
      id: string;
      items: { text: string; classification: string; status: string; weight: number }[] | null;
    }>(`SELECT id, breakdown->'items' AS items FROM screening WHERE id = ANY($1::char(26)[])`, [
      shown.map((r) => r.matchId),
    ]);
    const items = new Map(rows.map((r) => [r.id, r.items ?? []]));
    a.rows = shown.map((r) => {
      const it = items.get(r.matchId) ?? [];
      const found = it
        .filter((i) => i.status === 'met' && i.classification !== 'informational')
        .sort((x, y) => (y.weight ?? 0) - (x.weight ?? 0))
        .slice(0, 3)
        .map((i) => i.text);
      const missing = it
        .filter(
          (i) =>
            i.classification === 'mandatory' && i.status !== 'met' && i.status !== 'partially_met',
        )
        .slice(0, 3)
        .map((i) => i.text);
      return {
        matchId: r.matchId,
        label: r.label,
        pseudonym: r.pseudonym,
        score: Math.round(r.score),
        band: r.band,
        bandLabel: BAND_LABEL[r.band],
        mustFound: r.mustFound,
        mustTotal: r.mustTotal,
        decision: r.decision,
        decisionLabel: MARK_LABEL[r.decision],
        outOfDate: r.outOfDate,
        strengths: found,
        missing,
      };
    });
  }

  private async save(
    p: Principal,
    input: PoolAskInput,
    text: string,
    a: PoolAnswer,
    ip: string | undefined,
  ) {
    return this.db.withTx(async (tx) => {
      let cid = input.conversationId;
      if (cid) {
        const own = await tx.query(
          `SELECT 1 FROM assistant_conversation WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
          [cid, p.userId],
        );
        if (!own.rows.length) throw new NotFoundException();
        await tx.query(`UPDATE assistant_conversation SET updated_at = now() WHERE id = $1`, [cid]);
      } else {
        cid = newId();
        await tx.query(
          `INSERT INTO assistant_conversation (id, user_id, title, vacancy_id) VALUES ($1,$2,$3,$4)`,
          [cid, p.userId, (text || '…').slice(0, 200), a.vacancy?.id ?? null],
        );
      }
      await tx.query(
        `INSERT INTO assistant_pool_message (id, conversation_id, role, content) VALUES ($1,$2,'user',$3)`,
        [newId(), cid, JSON.stringify({ text, pick: input.pick ?? null })],
      );
      const mid = newId();
      await tx.query(
        `INSERT INTO assistant_pool_message (id, conversation_id, role, content, flags) VALUES ($1,$2,'assistant',$3,$4)`,
        [mid, cid, JSON.stringify(a), a.flags],
      );
      await this.audit.record(tx, {
        actorId: p.userId,
        actorType: p.actorType,
        sourceIp: ip,
        action: a.flags.some((f) => f.startsWith('refused'))
          ? 'assistant.refused'
          : 'assistant.pool_turn',
        entityType: 'assistant_conversation',
        entityId: cid,
        after: {
          vacancyId: a.vacancy?.id ?? null,
          kind: a.kind,
          flags: a.flags,
          language: a.language,
          counts: a.counts,
          // Pseudonyms only: names are never written to the audit trail.
          shown: a.rows.map((r) => r.pseudonym),
        },
      });
      return { conversationId: cid, messageId: mid, answer: a, at: new Date().toISOString() };
    });
  }

  // ------------------------------------------------------------------ conversations

  async list(p: Principal) {
    const { rows } = await this.db.query<{
      id: string;
      title: string;
      vacancyTitle: string | null;
      updatedAt: Date;
    }>(
      `SELECT c.id, c.title, v.title AS "vacancyTitle", c.updated_at AS "updatedAt"
         FROM assistant_conversation c LEFT JOIN vacancy v ON v.id = c.vacancy_id
        WHERE c.user_id = $1 AND c.deleted_at IS NULL ORDER BY c.updated_at DESC LIMIT 30`,
      [p.userId],
    );
    return rows.map((r) => ({ ...r, updatedAt: new Date(r.updatedAt).toISOString() }));
  }

  async one(p: Principal, id: string) {
    const c = (
      await this.db.query<{ id: string; title: string }>(
        `SELECT id, title FROM assistant_conversation WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
        [id, p.userId],
      )
    ).rows[0];
    if (!c) throw new NotFoundException();
    const { rows } = await this.db.query<{ id: string; role: string; content: unknown; at: Date }>(
      `SELECT id, role, content, created_at AS at FROM assistant_pool_message
        WHERE conversation_id = $1 ORDER BY created_at, id`,
      [id],
    );
    return {
      ...c,
      messages: rows.map((r) => ({ ...r, at: new Date(r.at).toISOString() })),
    };
  }

  async remove(p: Principal, id: string, ip: string | undefined) {
    await this.db.withTx(async (tx) => {
      const r = await tx.query(
        `UPDATE assistant_conversation SET deleted_at = now()
          WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL RETURNING id`,
        [id, p.userId],
      );
      if (!r.rows.length) throw new NotFoundException();
      await this.audit.record(tx, {
        actorId: p.userId,
        actorType: p.actorType,
        sourceIp: ip,
        action: 'assistant.conversation_deleted',
        entityType: 'assistant_conversation',
        entityId: id,
      });
    });
    return { deleted: true };
  }
}
