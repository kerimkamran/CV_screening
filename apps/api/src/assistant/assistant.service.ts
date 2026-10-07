import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { matchBand, newId, pseudonyms, type RankRow } from '@cv/shared';
import { AiGateway } from '../ai/ai-gateway.service';
import { AuditService } from '../audit/audit.service';
import type { Principal } from '../auth/principal';
import { DbService, type Queryable } from '../db/db.service';
import { CandidatesService } from '../pipeline/candidates.service';
import { redact } from '../pipeline/report.service';
import { localiseAnswer } from './assistant-az';
import { eraseAssistantForDocument } from './assistant-erase';
import { VacancyScope } from '../vacancy/vacancy-scope.service';
import {
  asksDecision,
  asksProtected,
  buildPackage,
  changeAnswer,
  checkAnswer,
  declineDecision,
  DECLINE_HIJACK,
  DECLINE_PROTECTED,
  evidencePointedAnswer,
  hijacks,
  holdAnswer,
  PACKAGE_VERSION,
  parseModel,
  PROMPT_VERSION,
  pushesBack,
  QUESTION_FOR,
  quotedFromCv,
  systemPrompt,
  UNREAD_ANSWER,
  userPrompt,
  verify,
  type Answer,
  type BuiltPackage,
  type Intent,
  type ModelIntent,
  type RecordItem,
} from './assistant-rules';

export interface Settings {
  enabled: boolean;
  name: string;
  modelRowId: string | null;
  features: {
    challenge: boolean;
    compare: boolean;
    interview: boolean;
    challengeRecruiter: boolean;
  };
  unavailableMessage: string;
  regionAllowed: string;
  dataTerms: 'unknown' | 'no_retention' | 'retained_no_training' | 'retained_may_train';
  attestedBy: string | null;
  attestedAt: string | null;
  dailyCap: number | null;
  monthlyCap: number | null;
  warnPct: number;
  testedModelKey: string | null;
  testedAt: string | null;
}

export class AssistantOff extends NotFoundException {
  constructor() {
    super({ message: 'The assistant is off', code: 'ASSISTANT_OFF' });
  }
}
export class FeatureOff extends NotFoundException {
  constructor(feature: string) {
    super({ message: `${feature} is switched off`, code: 'FEATURE_OFF' });
  }
}

export interface AskInput {
  message: string;
  intent: Intent;
  /** Other candidates (screening ids) for a comparison. */
  compareWith?: string[];
  /** The recruiter's own read, for "Challenge this match". */
  read?: string;
  language?: 'en' | 'az';
}

export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant';
  content: unknown;
  at: string;
}

/** The assistant: settings, evidence packages, the model call and everything checked around it. */
@Injectable()
export class AssistantService {
  private readonly log = new Logger('assistant');

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly scope: VacancyScope,
    private readonly cands: CandidatesService,
    private readonly gateway: AiGateway,
  ) {}

  // ----------------------------------------------------------------------- settings

  async settings(q: Queryable = this.db): Promise<Settings> {
    const { rows } = await q.query<{
      enabled: boolean;
      name: string;
      model_row_id: string | null;
      feat_challenge: boolean;
      feat_compare: boolean;
      feat_interview: boolean;
      feat_challenge_recruiter: boolean;
      unavailable_message: string;
      region_allowed: string;
      data_terms: Settings['dataTerms'];
      attested_by: string | null;
      attested_at: Date | null;
      daily_cap: number | null;
      monthly_cap: number | null;
      warn_pct: number;
      tested_model_key: string | null;
      tested_at: Date | null;
    }>(`SELECT * FROM assistant_setting`);
    const r = rows[0]!;
    return {
      enabled: r.enabled,
      name: r.name,
      modelRowId: r.model_row_id,
      features: {
        challenge: r.feat_challenge,
        compare: r.feat_compare,
        interview: r.feat_interview,
        challengeRecruiter: r.feat_challenge_recruiter,
      },
      unavailableMessage: r.unavailable_message,
      regionAllowed: r.region_allowed,
      dataTerms: r.data_terms,
      attestedBy: r.attested_by,
      attestedAt: r.attested_at ? new Date(r.attested_at).toISOString() : null,
      dailyCap: r.daily_cap,
      monthlyCap: r.monthly_cap,
      warnPct: r.warn_pct,
      testedModelKey: r.tested_model_key,
      testedAt: r.tested_at ? new Date(r.tested_at).toISOString() : null,
    };
  }

  /** Answers given today and this month (UTC), counted only when a model was called. */
  async usage() {
    const { rows } = await this.db.query<{ today: string; month: string }>(
      `SELECT count(*) FILTER (WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc') AS today,
              count(*) AS month
         FROM assistant_message
        WHERE counted AND created_at >= date_trunc('month', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc'`,
    );
    return { today: Number(rows[0]!.today), month: Number(rows[0]!.month) };
  }

  // ----------------------------------------------------------------------- threads

  async thread(p: Principal, screeningId: string) {
    await this.scope.assertScreening(p, screeningId);
    const t = (
      await this.db.query<{ id: string }>(
        `SELECT id FROM assistant_thread WHERE screening_id = $1 AND user_id = $2 AND deleted_at IS NULL`,
        [screeningId, p.userId],
      )
    ).rows[0];
    if (!t) return { thread: null as null | { id: string; messages: StoredMessage[] } };
    const { rows } = await this.db.query<{
      id: string;
      role: 'user' | 'assistant';
      content: unknown;
      at: Date;
    }>(
      `SELECT id, role, content, created_at AS at FROM assistant_message
        WHERE thread_id = $1 ORDER BY created_at, id`,
      [t.id],
    );
    return {
      thread: {
        id: t.id,
        messages: rows.map((r) => ({
          id: r.id,
          role: r.role,
          content: r.content,
          at: new Date(r.at).toISOString(),
        })),
      },
    };
  }

  async deleteThread(p: Principal, screeningId: string, ip: string | undefined) {
    const { vacancyId } = await this.scope.assertScreening(p, screeningId);
    await this.db.withTx(async (tx) => {
      const r = await tx.query<{ id: string }>(
        `UPDATE assistant_thread SET deleted_at = now()
          WHERE screening_id = $1 AND user_id = $2 AND deleted_at IS NULL RETURNING id`,
        [screeningId, p.userId],
      );
      for (const t of r.rows) {
        await this.audit.record(tx, {
          actorId: p.userId,
          actorType: p.actorType,
          sourceIp: ip,
          action: 'assistant.thread_deleted',
          entityType: 'assistant_thread',
          entityId: t.id,
          after: { vacancyId },
        });
      }
    });
    return { deleted: true };
  }

  /** A resume was erased: its conversations go with it (spec 6.6.6). */
  async eraseForDocument(tx: Queryable, documentId: string): Promise<void> {
    await eraseAssistantForDocument(tx, documentId);
  }

  // ----------------------------------------------------------------------- the record

  /** Everything the package is built from, for one screening, from the same rows as the screen. */
  private async record(vid: string, screeningId: string) {
    const rows = await this.cands.rows(vid);
    const row = rows.find((r) => r.screeningId === screeningId);
    if (!row) throw new NotFoundException();
    const labels = pseudonyms(rows.filter((r) => !r.erased) as unknown as RankRow[]);
    return { row, label: labels.get(row.documentId) ?? 'Candidate', rows };
  }

  private async evidenceFor(screeningId: string) {
    const { rows } = await this.db.query<{
      requirement_id: string;
      evidence: { quote?: string }[] | null;
    }>(`SELECT requirement_id, evidence FROM requirement_assessment WHERE screening_id = $1`, [
      screeningId,
    ]);
    const m = new Map<string, string[]>();
    for (const r of rows) {
      m.set(
        r.requirement_id,
        (r.evidence ?? []).map((e) => e.quote ?? '').filter((q) => q.length > 0),
      );
    }
    const sc = (
      await this.db.query<{ summary: string | null; injection: boolean; text: string | null }>(
        `SELECT sc.summary, sc.injection_suspected AS injection, d.text
           FROM screening sc JOIN cv_document d ON d.id = sc.document_id WHERE sc.id = $1`,
        [screeningId],
      )
    ).rows[0]!;
    return { evidence: m, summary: sc.summary, injection: sc.injection, cvText: sc.text ?? '' };
  }

  private async build(vid: string, screeningId: string, prefix: string) {
    const { row, label } = await this.record(vid, screeningId);
    const readable =
      !row.erased && row.state === 'completed' && row.score !== null && row.band !== 'needs_review';
    if (!readable) return { unread: true as const, label, row };
    const ev = await this.evidenceFor(screeningId);
    const items = (row.score!.breakdown.items ?? []) as unknown as RecordItem[];
    const built: BuiltPackage = buildPackage(
      {
        label,
        band: matchBand(row as unknown as RankRow),
        items,
        evidence: ev.evidence,
        reason: ev.summary,
        candidateName: row.candidateName,
        injectionSuspected: ev.injection,
      },
      prefix,
    );
    return { unread: false as const, label, row, built, cvText: ev.cvText };
  }

  // ----------------------------------------------------------------------- ask

  async ask(p: Principal, screeningId: string, input: AskInput, ip: string | undefined) {
    const s = await this.settings();
    if (!s.enabled) throw new AssistantOff();
    const { vacancyId } = await this.scope.assertScreening(p, screeningId);
    if (input.intent === 'challenge' && !s.features.challenge) throw new FeatureOff('Challenge');
    if (input.intent === 'compare' && !s.features.compare) throw new FeatureOff('Compare');
    if (input.intent === 'interview' && !s.features.interview)
      throw new FeatureOff('Interview questions');

    const main = await this.build(vacancyId, screeningId, input.intent === 'compare' ? 'A.' : '');
    // The question as asked, with the person's name taken out: a reveal on screen is never fed back.
    const text0 = input.intent === 'ask' ? input.message : QUESTION_FOR[input.intent];
    const text = redact(text0, main.row.candidateName).slice(0, 1000);
    const read = input.read ? redact(input.read, main.row.candidateName).slice(0, 400) : undefined;

    let answer: Answer;
    let model: string | null = null;
    let counted = false;
    const flagsExtra: string[] = [];

    if (main.unread) {
      answer = UNREAD_ANSWER(main.label);
    } else if (input.intent === 'ask' && hijacks(text)) {
      answer = DECLINE_HIJACK(main.label);
    } else if (input.intent === 'ask' && asksProtected(text)) {
      answer = DECLINE_PROTECTED(main.label);
    } else if (input.intent === 'ask' && asksDecision(text)) {
      answer = declineDecision(main.built);
    } else if (input.intent === 'ask' && pushesBack(text)) {
      answer = holdAnswer(main.built);
    } else if (input.intent === 'ask' && quotedFromCv(text, main.cvText)) {
      answer = evidencePointedAnswer(main.built, quotedFromCv(text, main.cvText)!);
    } else if (input.intent === 'change') {
      answer = changeAnswer(main.built);
    } else if (input.intent === 'check') {
      answer = checkAnswer(main.built);
    } else {
      // The model is called. First the limits, then the packages, then the checks.
      const cap = await this.capReached(s);
      if (cap) {
        answer = this.unavailable(main.label, cap, 'cap');
      } else {
        const packages: BuiltPackage[] = [main.built];
        if (input.intent === 'compare') {
          const others = [...new Set(input.compareWith ?? [])]
            .filter((x) => x !== screeningId)
            .slice(0, 2);
          const letters = ['B.', 'C.'];
          for (const [i, sid] of others.entries()) {
            const w = await this.scope.assertScreening(p, sid);
            if (w.vacancyId !== vacancyId) throw new NotFoundException();
            const b = await this.build(vacancyId, sid, letters[i]!);
            if (!b.unread) packages.push(b.built);
          }
        }
        const history = await this.history(p.userId, screeningId);
        const modelIntent: ModelIntent =
          input.intent === 'ask' ? 'ask' : (input.intent as ModelIntent);
        try {
          const res = await this.gateway.complete(
            {
              system: systemPrompt(
                s.name,
                modelIntent,
                input.language ?? 'en',
                s.features.challengeRecruiter,
              ),
              user: userPrompt(
                packages.map((b) => b.pkg),
                text,
                history,
                read,
              ),
              json: true,
              maxTokens: 900,
            },
            s.modelRowId ?? undefined,
          );
          model = `${res.provider} / ${res.model}`;
          counted = true;
          answer = verify(parseModel(res.text), { packages, intent: input.intent });
        } catch (e) {
          this.log.warn(`assistant call failed: ${(e as Error).message}`);
          answer = this.unavailable(main.label, s.unavailableMessage, 'unavailable');
        }
      }
    }
    answer = localiseAnswer(answer, input.language);
    if (input.intent === 'ask' && answer.flags.length === 0) flagsExtra.push('free_question');
    const flags = [...answer.flags, ...flagsExtra];

    const out = await this.db.withTx(async (tx) => {
      let thread = (
        await tx.query<{ id: string }>(
          `SELECT id FROM assistant_thread WHERE screening_id = $1 AND user_id = $2 AND deleted_at IS NULL`,
          [screeningId, p.userId],
        )
      ).rows[0];
      if (!thread) {
        thread = { id: newId() };
        await tx.query(
          `INSERT INTO assistant_thread (id, vacancy_id, screening_id, user_id) VALUES ($1,$2,$3,$4)`,
          [thread.id, vacancyId, screeningId, p.userId],
        );
      }
      const userId = newId();
      await tx.query(
        `INSERT INTO assistant_message (id, thread_id, role, content, label)
         VALUES ($1,$2,'user',$3,$4)`,
        [
          userId,
          thread.id,
          JSON.stringify({ text, intent: input.intent, read: read ?? null }),
          main.label,
        ],
      );
      const aid = newId();
      await tx.query(
        `INSERT INTO assistant_message
           (id, thread_id, role, content, label, model, prompt_version, package_version, flags, counted)
         VALUES ($1,$2,'assistant',$3,$4,$5,$6,$7,$8,$9)`,
        [
          aid,
          thread.id,
          JSON.stringify(answer),
          main.label,
          model,
          PROMPT_VERSION,
          PACKAGE_VERSION,
          flags,
          counted,
        ],
      );
      await this.audit.record(tx, {
        actorId: p.userId,
        actorType: p.actorType,
        sourceIp: ip,
        action: flags.some((f) => f.startsWith('refused')) ? 'assistant.refused' : 'assistant.turn',
        entityType: 'assistant_thread',
        entityId: thread.id,
        after: {
          vacancyId,
          label: main.label,
          intent: input.intent,
          kind: answer.kind,
          flags,
          model,
          promptVersion: PROMPT_VERSION,
          packageVersion: PACKAGE_VERSION,
        },
      });
      return { threadId: thread.id, messageId: aid };
    });
    return { ...out, answer, name: s.name, at: new Date().toISOString() };
  }

  private async history(userId: string, screeningId: string) {
    const { rows } = await this.db.query<{
      role: 'user' | 'assistant';
      content: { text?: string; headline?: string };
    }>(
      `SELECT m.role, m.content FROM assistant_message m
         JOIN assistant_thread t ON t.id = m.thread_id
        WHERE t.screening_id = $1 AND t.user_id = $2 AND t.deleted_at IS NULL
        ORDER BY m.created_at DESC, m.id DESC LIMIT 6`,
      [screeningId, userId],
    );
    return rows
      .reverse()
      .map((r) => ({
        role: r.role,
        text: (r.role === 'user' ? r.content.text : r.content.headline) ?? '',
      }))
      .filter((h) => h.text);
  }

  private async capReached(s: Settings): Promise<string | null> {
    if (s.dailyCap === null && s.monthlyCap === null) return null;
    const u = await this.usage();
    if (s.dailyCap !== null && u.today >= s.dailyCap)
      return `${s.name} has reached today's limit. The results and the evidence are still here.`;
    if (s.monthlyCap !== null && u.month >= s.monthlyCap)
      return `${s.name} has reached this month's limit. The results and the evidence are still here.`;
    return null;
  }

  private unavailable(label: string, message: string, flag: string): Answer {
    return {
      kind: 'unavailable',
      headline: message,
      claims: [],
      cantSee: '',
      questions: [],
      outcome: null,
      handoff: [],
      facts: [],
      flags: [flag],
      about: [label],
    };
  }
}
