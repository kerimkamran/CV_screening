import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { BAND_LABEL, MARK_LABEL, fold, newId, tokens, type Mark } from '@cv/shared';
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
import { dsay, declineFor } from './senai/deep-words';
import { describe, type Query } from './senai/query';
import { PoolSearch, stripPassages, type PassageRef } from './senai/search';
import { DeepTools } from './senai/deep-tools';
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
  /** Rediscovery only: a button per resume, "Analyze for this vacancy" (switch on). */
  analyze?: { matchId: string; vacancyId: string; label: string }[];
  /** Skill search only: the skills that were looked for. */
  skills?: string[];
  /** Skill search: words the dictionary does not know, searched as written (a person may suggest them). */
  unknownSkills?: string[];
  /** Skill search across vacancies: the vacancies shown, each with how many resumes mention the skills. */
  groups?: { vacancyId: string; title: string; total: number }[];
  /** Similar vacancies: an offer to review their requirements in this vacancy's Role card. */
  copy?: { fromId: string; toId: string; title: string; shared: number; of: number }[];
  /** Compare, doctor, changes, what-if, recall: a small table the tool filled. */
  table?: AnswerTable;
  /** Where to go next (open a candidate or a vacancy). */
  actions?: AnswerAction[];
  /** "How I got this": what the question was read as, what it used and when. */
  receipt?: {
    read: string;
    by: 'rules' | 'model';
    promptVersion: string | null;
    model: string | null;
    asOf: string;
    sources: string[];
  };
  /** The table can be copied as text (interview kit). */
  copyable?: boolean;
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
  /** A chip removed from the last answer (SenAI plan F1). */
  without?: { kind: 'skill' | 'band' | 'mark' | 'top'; text?: string };
}

/** What the last answer was about, kept with the conversation so a follow-up can be read (migration 0028). */
/** Exactly one open vacancy has this title (as the model copied it). */
const hasTitle = (live: VacancyRef[], title: string): boolean =>
  live.filter((v) => fold(v.title) === fold(title)).length === 1;

/** A message of up to this many words, read by the rules alone when they are sure of it. */
const PLAIN_WORDS = 4;

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
  'prefs',
  'jd',
  'consistency',
  'quality',
  'similar',
  'rediscover',
  'challenge',
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
    private readonly deep: DeepTools,
  ) {}

  /**
   * "Analyze for this vacancy" (plan M3, 7 action tiers "Change state"): the person asks for a resume of
   * another vacancy to be scored here too. Only with the rediscovery switch on; a button, never automatic.
   * The resume is copied into this vacancy (the copy points at the original, so erasing one erases both)
   * and queued like any upload. Nothing is scored or ranked until it has been analyzed here.
   */
  async analyzeHere(p: Principal, matchId: string, vacancyId: string, ip: string | undefined) {
    const s = await this.assistant.settings();
    if (!s.enabled) throw new AssistantOff();
    if (!s.features.rediscovery)
      throw new ForbiddenException('Suggestions from other vacancies are switched off');
    await this.scope.assert(p, vacancyId);
    const target = await this.db.query<{ id: string; archived: boolean; title: string }>(
      `SELECT id, archived_at IS NOT NULL AS archived, title FROM vacancy WHERE id = $1`,
      [vacancyId],
    );
    if (!target.rows[0]) throw new NotFoundException();
    if (target.rows[0].archived) throw new ConflictException('This vacancy is archived');
    const src = await this.db.query<{
      id: string;
      vacancyId: string;
      filename: string;
      mime: string;
      size: number;
      sha: string;
      content: Buffer | null;
      text: string | null;
      truncated: boolean;
      pageStarts: unknown;
    }>(
      `SELECT d.id, d.vacancy_id AS "vacancyId", d.filename, d.mime, d.size_bytes AS size, d.sha256 AS sha,
              d.content, d.text, d.text_truncated AS truncated, d.page_starts AS "pageStarts"
         FROM screening m JOIN cv_document d ON d.id = m.document_id
        WHERE m.id = $1 AND d.erased_at IS NULL AND d.parse_status = 'parsed'`,
      [matchId],
    );
    const d = src.rows[0];
    if (!d || !d.content || !d.text) throw new NotFoundException();
    await this.scope.assert(p, d.vacancyId);
    if (d.vacancyId === vacancyId) throw new ConflictException('This resume is already here');
    const dup = await this.db.query<{ id: string }>(
      `SELECT id FROM cv_document WHERE vacancy_id = $1 AND sha256 = $2`,
      [vacancyId, d.sha],
    );
    if (dup.rows[0]) throw new ConflictException('This resume is already in this vacancy');
    const set = await this.db.query<{ id: string }>(
      `SELECT id FROM requirement_set WHERE vacancy_id = $1 AND frozen_at IS NOT NULL ORDER BY version DESC LIMIT 1`,
      [vacancyId],
    );
    if (!set.rows[0])
      throw new ConflictException('Add the requirements to this vacancy first, then analyze');
    const docId = newId();
    await this.db.withTx(async (tx) => {
      await tx.query(
        `INSERT INTO cv_document
           (id, vacancy_id, filename, mime, size_bytes, sha256, content, text, text_truncated,
            parse_status, uploaded_by, page_starts, copied_from)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'parsed',$10,$11,$12)`,
        [
          docId,
          vacancyId,
          d.filename,
          d.mime,
          d.size,
          d.sha,
          d.content,
          d.text,
          d.truncated,
          p.userId,
          d.pageStarts ? JSON.stringify(d.pageStarts) : null,
          d.id,
        ],
      );
      await tx.query(
        `INSERT INTO screening (id, document_id, requirement_set_id, state) VALUES ($1,$2,$3,'queued')`,
        [newId(), docId, set.rows[0]!.id],
      );
      await this.audit.record(tx, {
        actorId: p.userId,
        actorType: p.actorType,
        sourceIp: ip,
        action: 'assistant.rediscovery_analyze',
        entityType: 'document',
        entityId: docId,
        after: { vacancyId, copiedFrom: d.id, fromVacancyId: d.vacancyId },
      });
    });
    return { documentId: docId, vacancyId, vacancyTitle: target.rows[0].title, queued: true };
  }

  /**
   * The JD coach on save (plan M6, F8): suggestions about the wording and the requirements of one vacancy.
   * Read-only and rule-based: no model is called, nothing is stored, nothing is blocked or edited.
   */
  async coach(p: Principal, vacancyId: string, language: Lang) {
    const s = await this.assistant.settings();
    if (!s.enabled) throw new AssistantOff();
    await this.scope.assert(p, vacancyId);
    const { rows } = await this.db.query<{ id: string; title: string }>(
      `SELECT id, title FROM vacancy WHERE id = $1`,
      [vacancyId],
    );
    if (!rows[0]) throw new NotFoundException();
    const { tips, empty } = await this.deep.jdTips(rows[0], language);
    return {
      vacancyId,
      language,
      tips,
      headline: empty
        ? dsay(language, 'jdNoReqs')
        : tips.length
          ? dsay(language, 'jdHead', { title: rows[0].title, n: tips.length })
          : dsay(language, 'jdClean', { title: rows[0].title }),
    };
  }

  async ask(p: Principal, input: PoolAskInput, ip: string | undefined) {
    const s = await this.assistant.settings();
    if (!s.enabled) throw new AssistantOff();
    const text =
      input.message.trim().slice(0, 1000) ||
      (input.without ? `− ${input.without.text ?? input.without.kind}` : '');
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
    let safeMode = false;

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
    } else if (declineFor(text)) {
      const d = declineFor(text)!;
      Object.assign(a, { kind: 'decline', headline: dsay(lang, d.key), flags: [d.flag] });
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
      const edit = input.without && reg ? this.without(reg.q, input.without) : null;
      const rules =
        edit ??
        understand(forRules, {
          last: reg?.q ?? null,
          shown: reg?.shown.length ?? 0,
          titleWords,
          namesVacancy: strong,
          now,
        });
      q = rules;
      // A question that half-names a vacancy is for the person to settle ('which one?'), not the model.
      const halfNamed = res.tier === 'partial' && rules.intent === 'find';
      // The rules answer on their own only when they are sure AND the message is short and plain.
      // Anything longer or looser (typos, broken grammar, informal talk) is read by the model, like a
      // person would read it; the rules stay as the fast path and as the fallback when the model is
      // off, over its cap, down, or cannot tell.
      const plain = rules.confidence === 'high' && tokens(forRules).length <= PLAIN_WORDS;
      const redo = !!(input.pick || input.showAll);
      const askModel =
        !edit && s.features.understand && (rules.confidence === 'low' || (!plain && !redo));
      if (askModel) {
        const read = await this.viaModel(
          s,
          text,
          reg,
          live,
          input.vacancyId,
          now,
          input.conversationId,
        );
        const m = read && !('down' in read) ? read : null;
        // A question that only half-names a vacancy stays for the person to settle ("which one?"), unless
        // the model could point at exactly one title.
        const settled = !halfNamed || (m?.vacancy ? hasTitle(live, m.vacancy) : false);
        if (read && 'down' in read) safeMode = rules.confidence === 'high';
        if (m && settled && (m.q.intent !== 'unknown' || rules.confidence === 'low')) {
          q = m.q;
          model = m.model;
          counted = true;
          if (!named && m.vacancy) {
            const want = fold(m.vacancy);
            const hit = live.filter((v) => fold(v.title) === want);
            if (hit.length === 1) {
              named = hit[0]!;
              ambiguous = [];
            }
          }
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

      // "Always show the top 10": the person's own typed preference, unless the question says a number.
      if (
        LISTING.includes(q.intent) &&
        q.top === null &&
        !q.showAll &&
        !input.showAll &&
        !input.without
      ) {
        const pref = await this.tools.prefTop(p.userId);
        if (pref) q.top = pref;
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
            features: s.features,
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

    // Safe mode (plan 9): the answer is complete and comes from the records; only the reading was by rules.
    if (safeMode && (a.kind === 'pool' || a.kind === 'help')) {
      a.notes = [...a.notes, say(lang, 'safeMode')];
      a.flags = [...a.flags, 'safe_mode'];
    }

    if (q && (a.kind === 'pool' || a.kind === 'help'))
      a.receipt = {
        read: describe(q),
        by: model ? 'model' : 'rules',
        promptVersion: model ? UNDERSTAND_PROMPT_VERSION : null,
        model,
        asOf: a.asOf,
        sources: [
          'pool analysis',
          ...(q.skills.length ? ['resume text'] : []),
          ...(a.table ? ['stored assessments'] : []),
        ],
      };
    return this.save(p, input, text, a, ip, { q, model, counted, reg });
  }

  /** The last query without one chip: the same question again, no model and no new reading. */
  private without(last: Query, w: NonNullable<PoolAskInput['without']>): Query {
    const q: Query = JSON.parse(JSON.stringify(last)) as Query;
    q.followUp = 'refine';
    q.confidence = 'high';
    q.source = 'rules';
    q.refs = [];
    if (w.kind === 'skill')
      q.skills = q.skills.filter((x) => x.label.toLowerCase() !== (w.text ?? '').toLowerCase());
    else if (w.kind === 'band')
      q.bands = q.bands.filter((b) => !Object.values(BAND_WORD).some((m) => m[b] === w.text));
    else if (w.kind === 'mark')
      q.decisions = q.decisions.filter(
        (m) => !Object.values(MARK_WORD).some((x) => x[m] === w.text),
      );
    else q.top = null;
    if (q.intent === 'skills' && q.skills.length === 0) q.intent = 'find';
    return q;
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
    conversationId: string | undefined,
  ): Promise<{ q: Query; model: string; vacancy: string | null } | { down: true } | null> {
    try {
      if (!s.modelRowId && !(await this.gateway.active())) return null;
      if (await this.assistant.capReached(s)) return { down: true };
      const page = pageId ? live.find((v) => v.id === pageId) : undefined;
      const user = understandUser({
        message: text.replace(CONTACT, '[contact hidden]'),
        previous: reg?.q ?? null,
        page: page?.title ?? null,
        vacancies: live.map((v) => v.title),
        shown: reg?.shown.length ?? 0,
        recent: await this.recent(conversationId),
      });
      const keys = Object.keys(JSON.parse(user) as object);
      if (keys.some((k) => !UNDERSTAND_FIELDS.includes(k))) return null;
      const ask = { system: understandSystem(), user, json: true, maxTokens: 400 };
      // The faster reader model, when one is set; if it fails the answer model reads the question.
      let res;
      if (s.understandModelRowId) {
        try {
          res = await this.gateway.complete(ask, s.understandModelRowId);
        } catch (e) {
          this.log.warn(`reader model failed, using the answer model: ${(e as Error).message}`);
        }
      }
      res ??= await this.gateway.complete(ask, s.modelRowId ?? undefined);
      const mq = parseModelQuery(res.text);
      if (!mq) return null;
      const q = toQuery(mq, text, { shown: reg?.shown.length ?? 0, now });
      return { q, model: `${res.provider} / ${res.model}`, vacancy: mq.vacancy };
    } catch (e) {
      this.log.warn(`understanding by model failed: ${(e as Error).message}`);
      return { down: true };
    }
  }

  /** What SenAI remembers about the person: only "show N", and only when they asked for it. */
  async preferences(p: Principal) {
    return { top: await this.deep.prefTop(p.userId) };
  }
  async setPreferences(p: Principal, top: number | null) {
    if (top === null) await this.deep.clearPref(p.userId);
    else await this.deep.setPref(p.userId, top);
    return this.preferences(p);
  }

  /** The person's own last messages in this chat, oldest first: what "them" and "same for Python" point at. */
  private async recent(conversationId: string | undefined): Promise<string[]> {
    if (!conversationId) return [];
    const { rows } = await this.db.query<{ content: { text?: string } }>(
      `SELECT content FROM assistant_pool_message
        WHERE conversation_id = $1 AND role = 'user' ORDER BY created_at DESC, id DESC LIMIT 3`,
      [conversationId],
    );
    return rows
      .map((r) => (r.content.text ?? '').replace(CONTACT, '[contact hidden]').slice(0, 300))
      .filter(Boolean)
      .reverse();
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
    const unknown = q.skills.filter((x) => x.id === null).map((x) => x.label);
    if (unknown.length) a.unknownSkills = unknown;
    a.headline = sel.length
      ? say(lang, 'skillFound', { skills, n: sel.length, scope: place })
      : say(lang, 'skillNone', { skills, scope: place });
    if (sel.length && !q.countOnly) {
      const all = q.showAll || showAll;
      // Across vacancies (plan S1): at most 5 vacancies, the first 3 resumes of each, each group
      // headed by its vacancy; "Show all" lifts the caps.
      let view = sel;
      if (list.length > 1 && !all) {
        const order: string[] = [];
        for (const r of sel) if (!order.includes(r.vacancyId)) order.push(r.vacancyId);
        const keep = new Set(order.slice(0, 5));
        const per = new Map<string, number>();
        view = sel.filter((r) => {
          if (!keep.has(r.vacancyId)) return false;
          const n = (per.get(r.vacancyId) ?? 0) + 1;
          per.set(r.vacancyId, n);
          return n <= (q.top ?? 3);
        });
      }
      if (list.length > 1) {
        const total = new Map<string, { title: string; n: number }>();
        for (const r of sel) {
          const g = total.get(r.vacancyId) ?? { title: r.vacancyTitle, n: 0 };
          g.n += 1;
          total.set(r.vacancyId, g);
        }
        a.groups = [...new Set(view.map((r) => r.vacancyId))].map((id) => ({
          vacancyId: id,
          title: total.get(id)!.title,
          total: total.get(id)!.n,
        }));
      }
      await this.fill(a, view, all ? 50 : list.length > 1 ? 50 : (q.top ?? 10));
      a.more = Math.max(0, sel.length - a.rows.length);
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
                intent: meta.q.intent,
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
