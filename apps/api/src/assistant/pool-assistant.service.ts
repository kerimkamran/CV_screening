import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { BAND_LABEL, MARK_LABEL, fold, newId, type Mark } from '@cv/shared';
import { AiGateway } from '../ai/ai-gateway.service';
import { AuditService } from '../audit/audit.service';
import type { Principal } from '../auth/principal';
import { DbService } from '../db/db.service';
import { PoolService, type PoolRow } from '../pipeline/pool.service';
import { VacancyScope } from '../vacancy/vacancy-scope.service';
import { asksDecision, asksProtected, hijacks } from './assistant-rules';
import { AssistantOff, AssistantService, type Settings } from './assistant.service';
import {
  BAND_WORD,
  MARK_WORD,
  SUGGESTIONS,
  detectLanguage,
  looksEnglish,
  resolveVacancy,
  say,
  type Lang,
  type VacancyRef,
} from './pool-assistant';
import { describe, type Query } from './senai/query';
import { PoolSearch, stripPassages, type PassageRef } from './senai/search';
import { PoolTools, type AnswerAction, type AnswerTable } from './senai/tools';
import { understand } from './senai/understand';
import {
  UNDERSTAND_FIELDS,
  UNDERSTAND_PROMPT_VERSION,
  parseModelQuery,
  toQuery,
  understandSystem,
  understandUser,
} from './senai/understand-model';

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
  /** The vacancy the resume was analyzed for (shown when an answer spans vacancies). */
  vacancyTitle?: string;
  /** Skill search: how many times each asked skill is written in the resume. */
  skillHits?: { skill: string; count: number }[];
  /** Skill search: where it is written. The text is read again when the answer is shown. */
  passages?: PassageRef[];
}

/** What an answer was built from, so the person can see it and take any part away (SenAI plan F1). */
export interface UsedChip {
  kind: 'vacancy' | 'everywhere' | 'skill' | 'band' | 'mark' | 'top' | 'since';
  text: string;
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
  /** Skill search only: the skills that were looked for. */
  skills?: string[];
  /** Compare, doctor, changes, what-if, recall: a small table the tool filled. */
  table?: AnswerTable;
  /** Where to go next (open a candidate or a vacancy). */
  actions?: AnswerAction[];
  /** Pseudonyms of the candidates a tool answer is about (for the audit trail; names never go there). */
  subjects?: string[];
  /** How the question was read: what the answer is about. */
  used: UsedChip[];
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

/** What the last answer was about, kept with the conversation so a follow-up can be read (migration 0028). */
export interface Register {
  q: Query;
  scope: { vacancyId: string | null; everywhere: boolean };
  /** Match ids of the candidates the last answer listed, in order. */
  shown: string[];
  language: Lang;
}

const empty = (language: Lang, now: string): PoolAnswer => ({
  kind: 'help',
  headline: '',
  notes: [],
  vacancy: null,
  options: [],
  counts: null,
  rows: [],
  used: [],
  more: 0,
  asOf: now,
  suggestions: [],
  flags: [],
  language,
});

const TOOL_INTENTS: Query['intent'][] = [
  'compare',
  'doctor',
  'changes',
  'what_if',
  'open',
  'interview',
  'recall',
  'about',
  'help',
];

/** Intents whose answer lists candidates: only these change what a follow-up refers to. */
const LISTING: Query['intent'][] = ['find', 'count', 'shortlist', 'skills'];

const CONTACT = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+|\+?\d[\d\s().-]{7,}\d/g;

/**
 * Pool answers (WP 4.4). The question is read into a typed query (rules, then a model for what
 * the rules cannot read), the query is run against the pool's own rows and the resumes, and the
 * sentences are written in pool-assistant.ts. Every number is counted from PoolService rows, the
 * order is the pool's order, and no resume text ever goes to a model.
 */
@Injectable()
export class PoolAssistantService {
  private readonly log = new Logger('pool-assistant');

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly scope: VacancyScope,
    private readonly pool: PoolService,
    private readonly assistant: AssistantService,
    private readonly gateway: AiGateway,
    private readonly search: PoolSearch,
    private readonly tools: PoolTools,
  ) {}

  async ask(p: Principal, input: PoolAskInput, ip: string | undefined) {
    const s = await this.assistant.settings();
    if (!s.enabled) throw new AssistantOff();
    const text = input.message.trim().slice(0, 1000);
    const reg = input.conversationId ? await this.register(p, input.conversationId) : null;
    const lang = this.language(text, input.language, reg);
    const now = new Date();
    const a = empty(lang, now.toISOString());

    const ids = await this.scope.visibleIds(p, true);
    const { rows: vrows } = ids.length
      ? await this.db.query<VacancyRef & { archived: boolean }>(
          `SELECT id, title, status, archived_at IS NOT NULL AS archived FROM vacancy
            WHERE id = ANY($1::char(26)[]) ORDER BY updated_at DESC`,
          [ids],
        )
      : { rows: [] };
    const live = vrows.filter((v) => !v.archived);

    const pickOptions = (list: VacancyRef[]) =>
      list.slice(0, 8).map((v) => ({ id: v.id, title: v.title, status: v.status }));
    let q: Query | null = null;
    let model: string | null = null;
    let counted = false;

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
      // Which vacancy does the question name?
      let named: VacancyRef | null = null;
      let ambiguous: VacancyRef[] = [];
      const res = input.pick
        ? (() => {
            const hit = live.find((v) => v.id === input.pick);
            if (!hit) throw new NotFoundException();
            return { tier: 'exact' as const, matches: [hit] };
          })()
        : resolveVacancy(text, live);
      const strong = res.tier === 'exact' || res.tier === 'close';
      if (strong && res.matches.length === 1) named = res.matches[0]!;
      else if (strong) ambiguous = res.matches;

      // Which vacancy words are never a skill.
      const titleWords = new Set(live.flatMap((v) => fold(v.title).split(' ')));
      // The vacancy's own title is a name, not a command: "Open Source Engineer" is not "open".
      const forRules = named ? this.withoutTitle(text, named.title) : text;
      const rules = understand(forRules, {
        last: reg?.q ?? null,
        shown: reg?.shown.length ?? 0,
        titleWords,
        namesVacancy: strong,
        now,
      });
      q = rules;
      // A question that half-names a vacancy is for the person to settle ('which one?'), not the model.
      const halfNamed = res.tier === 'partial' && rules.intent === 'find';
      if (rules.confidence === 'low' && !halfNamed) {
        const m = await this.viaModel(s, text, reg, live, input.vacancyId, now);
        if (m) {
          q = m.q;
          model = m.model;
          counted = true;
        }
      }
      if (named && !q.trigger) {
        // "Python Developer": a word of the vacancy's own title is the job, not a skill to search for.
        const own = new Set(fold(named.title).split(' '));
        q.skills = q.skills.filter(
          (sk) => !(sk.words.length > 0 && sk.words.every((w) => own.has(w))),
        );
        if (q.intent === 'skills' && q.skills.length === 0) q.intent = 'find';
      }

      const page = input.vacancyId ? live.find((v) => v.id === input.vacancyId) : undefined;
      const follow = q.followUp !== 'new' && reg ? reg.scope : null;
      const followVacancy = follow?.vacancyId
        ? live.find((v) => v.id === follow.vacancyId)
        : undefined;
      // The vacancies this question is about, and where that came from.
      let list: VacancyRef[] = [];
      let source: 'named' | 'everywhere' | 'follow' | 'page' | 'none' = 'none';
      if (named) {
        list = [named];
        source = 'named';
      } else if (q.everywhere) {
        list = live;
        source = 'everywhere';
      } else if (followVacancy) {
        list = [followVacancy];
        source = 'follow';
      } else if (follow?.everywhere) {
        list = live;
        source = 'follow';
      } else if (page) {
        list = [page];
        source = 'page';
      }

      const handled = TOOL_INTENTS.includes(q.intent)
        ? await this.tools.run({
            a,
            q,
            reg,
            text,
            list: list.length || !reg ? list : this.scopeOf(reg, live),
            named,
            live,
            now,
            p,
          })
        : false;

      if (handled) {
        // answered by a tool
      } else if (q.intent === 'skills') {
        if (ambiguous.length) this.askWhich(a, ambiguous, lang, pickOptions);
        else {
          if (source === 'none') {
            list = live;
            source = 'everywhere';
          }
          await this.answerSkills(a, list, q, reg, input.showAll === true, source === 'page');
        }
      } else if (q.intent === 'find' || q.intent === 'count' || q.intent === 'shortlist') {
        if (ambiguous.length) this.askWhich(a, ambiguous, lang, pickOptions);
        else if (source !== 'none') await this.answerFor(a, list, q, input.showAll === true);
        else if (res.tier === 'partial') {
          Object.assign(a, {
            kind: res.matches.length === 1 ? 'confirm' : 'ask_which',
            headline: say(lang, res.matches.length === 1 ? 'confirm' : 'which'),
            options: pickOptions(res.matches),
            flags: ['ask_which'],
          });
        } else {
          const archivedHit = vrows.find(
            (v) => v.archived && ['exact', 'close'].includes(resolveVacancy(text, [v]).tier),
          );
          if (archivedHit) {
            Object.assign(a, {
              kind: 'no_match',
              headline: say(lang, 'archived', { title: archivedHit.title }),
              flags: ['archived_excluded'],
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
      } else {
        // Not understood, or an intent that is not built yet: one short question, not a dead end.
        if (!live.length) Object.assign(a, { kind: 'help', headline: say(lang, 'noVacancies') });
        else
          Object.assign(a, {
            kind: 'help',
            headline: say(lang, q.intent === 'unknown' ? 'clarify' : 'help'),
            suggestions: this.suggest(lang, (page ?? live[0])?.title),
            flags: ['not_understood'],
          });
      }
      if (a.kind === 'pool' && !handled) a.used = this.used(q, a, lang);
    }

    return this.save(p, input, text, a, ip, { q, model, counted, reg });
  }

  /** The message with the vacancy's full title taken out (only when the whole title is written). */
  private withoutTitle(text: string, title: string): string {
    const f = ` ${fold(text)} `;
    const t = ` ${fold(title)} `;
    return f.includes(t) ? f.replace(t, ' ').trim() : text;
  }

  /** The vacancies a conversation was about, for tools that read the conversation's scope. */
  private scopeOf(reg: Register, live: VacancyRef[]): VacancyRef[] {
    if (reg.scope.vacancyId) return live.filter((v) => v.id === reg.scope.vacancyId);
    return reg.scope.everywhere ? live : [];
  }

  private askWhich(
    a: PoolAnswer,
    list: VacancyRef[],
    lang: Lang,
    pick: (l: VacancyRef[]) => PoolAnswer['options'],
  ) {
    Object.assign(a, {
      kind: 'ask_which',
      headline: say(lang, 'which'),
      options: pick(list),
      flags: ['ask_which'],
    });
  }

  private language(text: string, hint: Lang | undefined, reg: Register | null): Lang {
    const d = detectLanguage(text);
    if (d && d !== 'en') return d;
    // "ingilis dili" alone has no Azerbaijani letters: the conversation's language decides.
    if (d === 'en' && reg && reg.language !== 'en' && !looksEnglish(text)) return reg.language;
    return d ?? reg?.language ?? hint ?? 'en';
  }

  private suggest(lang: Lang, title?: string): string[] {
    const t = title ?? '…';
    return SUGGESTIONS[lang].map((x) => x.replace('{vacancy}', t));
  }

  /** The chips that show what an answer is about. */
  private used(q: Query, a: PoolAnswer, lang: Lang): UsedChip[] {
    const out: UsedChip[] = [];
    out.push(
      a.vacancy
        ? { kind: 'vacancy', text: a.vacancy.title }
        : { kind: 'everywhere', text: say(lang, 'scopeAll') },
    );
    for (const sk of q.skills) out.push({ kind: 'skill', text: sk.label });
    for (const b of q.bands) out.push({ kind: 'band', text: BAND_WORD[lang][b]! });
    for (const m of q.decisions) out.push({ kind: 'mark', text: MARK_WORD[lang][m]! });
    if (q.top) out.push({ kind: 'top', text: `Top ${q.top}` });
    return out;
  }

  // ------------------------------------------------------------------ understanding with a model

  /** The model reads a question the rules could not. It sees the question and titles, never a resume. */
  private async viaModel(
    s: Settings,
    text: string,
    reg: Register | null,
    live: VacancyRef[],
    pageId: string | undefined,
    now: Date,
  ): Promise<{ q: Query; model: string } | null> {
    try {
      if (!s.modelRowId && !(await this.gateway.active())) return null;
      if (await this.assistant.capReached(s)) return null;
      const page = pageId ? live.find((v) => v.id === pageId) : undefined;
      const user = understandUser({
        message: text.replace(CONTACT, '[contact hidden]'),
        previous: reg?.q ?? null,
        page: page?.title ?? null,
        vacancies: live.map((v) => v.title),
        shown: reg?.shown.length ?? 0,
      });
      const keys = Object.keys(JSON.parse(user) as object);
      if (keys.some((k) => !UNDERSTAND_FIELDS.includes(k))) return null;
      const res = await this.gateway.complete(
        { system: understandSystem(), user, json: true, maxTokens: 400 },
        s.modelRowId ?? undefined,
      );
      const mq = parseModelQuery(res.text);
      if (!mq) return null;
      const q = toQuery(mq, text, { shown: reg?.shown.length ?? 0, now });
      return { q, model: `${res.provider} / ${res.model}` };
    } catch (e) {
      this.log.warn(`understanding by model failed: ${(e as Error).message}`);
      return null;
    }
  }

  // ------------------------------------------------------------------ answers

  private async answerFor(a: PoolAnswer, list: VacancyRef[], q: Query, showAll: boolean) {
    const lang = a.language;
    const ids = list.map((v) => v.id);
    const one = list.length === 1 ? list[0]! : null;
    const rows = (await this.pool.rows(ids)).sort(PoolService.byMatch);
    const { rows: stat } = await this.db.query<{ docs: number; running: number }>(
      `SELECT count(*)::int AS docs,
              count(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM screening s WHERE s.document_id = d.id AND s.state IN ('queued', 'processing')
                   AND s.cancelled_at IS NULL))::int AS running
         FROM cv_document d WHERE d.vacancy_id = ANY($1::char(26)[]) AND d.erased_at IS NULL`,
      [ids],
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
    a.vacancy = one ? { id: one.id, title: one.title, status: one.status } : null;
    a.counts = counts;
    a.kind = 'pool';
    const title = one ? one.title : say(lang, 'scopeAll');
    const notes: string[] = [];
    const limit = q.showAll || showAll ? 50 : (q.top ?? 5);
    const filtered = (list0: PoolRow[]) =>
      list0.filter(
        (r) =>
          (!q.bands.length || q.bands.includes(r.band)) &&
          (!q.decisions.length || q.decisions.includes(r.decision)),
      );
    const filters = [
      ...q.bands.map((b) => BAND_WORD[lang][b]!),
      ...q.decisions.map((m) => MARK_WORD[lang][m]!),
    ];

    if (docs === 0) {
      a.headline = say(lang, 'noResumes', { title });
      a.flags.push('no_resumes');
      return;
    }
    if (analyzed === 0) {
      a.headline = say(lang, 'noneAnalyzed', { title });
      a.flags.push('none_analyzed');
    } else if (q.intent === 'count') {
      a.headline = say(lang, 'count', {
        n: analyzed,
        title,
        strong: counts.strong,
        shortlist: counts.shortlist,
      });
    } else if (q.intent === 'shortlist') {
      const sl = rows.filter((r) => r.decision === 'shortlist');
      const sel = filtered(sl);
      a.headline = sel.length
        ? say(lang, 'shortlist', { n: sel.length, title })
        : say(lang, 'shortlistNone', { title });
      await this.fill(a, sel, limit);
    } else {
      const sel = filtered(rows);
      a.headline = filters.length
        ? say(lang, 'filtered', { n: sel.length, analyzed, title })
        : say(lang, 'found', {
            n: analyzed,
            title,
            strong: counts.strong,
            good: counts.good,
            partial: counts.partial,
            limited: counts.limited,
          });
      if (filters.length) notes.push(say(lang, 'filterNote', { filters: filters.join(', ') }));
      await this.fill(a, sel, limit);
      if (a.more > 0 && !(q.showAll || showAll)) notes.push(say(lang, 'top', { k: a.rows.length }));
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

  /**
   * "Who knows Excel?": the resumes of the analyzed candidates are searched for the skills. The
   * order is the pool's order; the resume text is read here, and only places in it are kept.
   */
  private async answerSkills(
    a: PoolAnswer,
    list: VacancyRef[],
    q: Query,
    reg: Register | null,
    showAll: boolean,
    pageOnly: boolean,
  ) {
    const lang = a.language;
    const ids = list.map((v) => v.id);
    const pool = (await this.pool.rows(ids)).sort(PoolService.byMatch);
    const { rows: stat } = await this.db.query<{ docs: number }>(
      `SELECT count(*)::int AS docs FROM cv_document
        WHERE vacancy_id = ANY($1::char(26)[]) AND erased_at IS NULL`,
      [ids],
    );
    const unsearched = Math.max(0, (stat[0]?.docs ?? 0) - pool.length);
    const found = await this.search.skills(pool, q.skills, q.mode === 'any');
    let matched = pool.filter((r) => found.has(r.documentId));
    if (list.length > 1) {
      // Across vacancies: grouped by vacancy, each in the pool's order.
      const rank = new Map(list.map((v, i) => [v.id, i]));
      matched = [...matched].sort((x, y) => rank.get(x.vacancyId)! - rank.get(y.vacancyId)!);
    }
    const sel = matched.filter(
      (r) =>
        (!q.bands.length || q.bands.includes(r.band)) &&
        (!q.decisions.length || q.decisions.includes(r.decision)),
    );
    const skills = q.skills.map((x) => x.label).join(q.mode === 'any' ? ' / ' : ' + ');
    const one = list.length === 1 ? list[0]! : null;
    const place = one ? one.title : say(lang, 'scopeAll');

    a.kind = 'pool';
    a.vacancy = one ? { id: one.id, title: one.title, status: one.status } : null;
    a.flags = ['skill_search'];
    a.skills = q.skills.map((x) => x.label);
    a.headline = sel.length
      ? say(lang, 'skillFound', { skills, n: sel.length, scope: place })
      : say(lang, 'skillNone', { skills, scope: place });
    if (sel.length && !q.countOnly) {
      const limit = q.showAll || showAll ? 50 : (q.top ?? 10);
      await this.fill(a, sel, limit);
      for (const row of a.rows) {
        const src = sel.find((r) => r.matchId === row.matchId)!;
        const f = found.get(src.documentId)!;
        row.skillHits = f.hits;
        row.passages = f.passages;
      }
    }
    const notes: string[] = [];
    const filters = [
      ...q.bands.map((b) => BAND_WORD[lang][b]!),
      ...q.decisions.map((m) => MARK_WORD[lang][m]!),
    ];
    if (filters.length) notes.push(say(lang, 'filterNote', { filters: filters.join(', ') }));
    if (q.followUp === 'replace' && reg?.q.skills.length) {
      notes.push(say(lang, 'followReplace', { skills }));
      a.suggestions = reg.q.skills
        .filter((p) => !q.skills.some((x) => (x.id ?? x.phrase) === (p.id ?? p.phrase)))
        .map((p) => say(lang, 'alsoChip', { skill: p.label }));
    }
    if (sel.length) notes.push(say(lang, 'skillNote'));
    if (pageOnly && one) notes.push(say(lang, 'skillScopePage', { title: one.title }));
    if (unsearched) {
      notes.push(say(lang, 'skillUnsearched', { n: unsearched }));
      a.flags.push('unanalyzed');
    }
    a.notes = notes;
    a.counts = null;
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
        vacancyTitle: r.vacancyTitle,
      };
    });
  }

  // ------------------------------------------------------------------ conversation memory

  private async register(p: Principal, conversationId: string): Promise<Register | null> {
    const { rows } = await this.db.query<{ register: Register | null }>(
      `SELECT register FROM assistant_conversation WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [conversationId, p.userId],
    );
    if (!rows.length) throw new NotFoundException();
    return rows[0]!.register;
  }

  private async save(
    p: Principal,
    input: PoolAskInput,
    text: string,
    a: PoolAnswer,
    ip: string | undefined,
    meta: { q: Query | null; model: string | null; counted: boolean; reg: Register | null },
  ) {
    const stored = stripPassages(a);
    // A conversation remembers the last answer that listed candidates; questions and refusals leave it as it was.
    const register: Register | null =
      a.kind === 'pool' && meta.q && LISTING.includes(meta.q.intent)
        ? {
            q: meta.q,
            scope: { vacancyId: a.vacancy?.id ?? null, everywhere: a.vacancy === null },
            shown: a.rows.map((r) => r.matchId),
            language: a.language,
          }
        : meta.reg;
    const out = await this.db.withTx(async (tx) => {
      let cid = input.conversationId;
      if (cid) {
        const own = await tx.query(
          `SELECT 1 FROM assistant_conversation WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
          [cid, p.userId],
        );
        if (!own.rows.length) throw new NotFoundException();
        await tx.query(
          `UPDATE assistant_conversation SET updated_at = now(), register = $2 WHERE id = $1`,
          [cid, register ? JSON.stringify(register) : null],
        );
      } else {
        cid = newId();
        await tx.query(
          `INSERT INTO assistant_conversation (id, user_id, title, vacancy_id, register) VALUES ($1,$2,$3,$4,$5)`,
          [
            cid,
            p.userId,
            (text || '…').slice(0, 200),
            a.vacancy?.id ?? null,
            register ? JSON.stringify(register) : null,
          ],
        );
      }
      await tx.query(
        `INSERT INTO assistant_pool_message (id, conversation_id, role, content) VALUES ($1,$2,'user',$3)`,
        [newId(), cid, JSON.stringify({ text, pick: input.pick ?? null })],
      );
      const mid = newId();
      await tx.query(
        `INSERT INTO assistant_pool_message (id, conversation_id, role, content, flags, counted, model) VALUES ($1,$2,'assistant',$3,$4,$5,$6)`,
        [mid, cid, JSON.stringify(stored), a.flags, meta.counted, meta.model],
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
          skills: a.skills ?? null,
          read: meta.q
            ? {
                by: meta.model ? 'model' : 'rules',
                promptVersion: meta.model ? UNDERSTAND_PROMPT_VERSION : null,
                query: describe(meta.q),
              }
            : null,
          // Pseudonyms only: names are never written to the audit trail.
          shown: [...a.rows.map((r) => r.pseudonym), ...(a.subjects ?? [])],
        },
      });
      return { conversationId: cid, messageId: mid, at: new Date().toISOString() };
    });
    return { ...out, answer: await this.search.hydrate(a) };
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
    const messages = await Promise.all(
      rows.map(async (r) => ({
        ...r,
        content:
          r.role === 'assistant'
            ? await this.search.hydrate(r.content as { rows: PoolAnswerRow[] })
            : r.content,
        at: new Date(r.at).toISOString(),
      })),
    );
    return { ...c, messages };
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
