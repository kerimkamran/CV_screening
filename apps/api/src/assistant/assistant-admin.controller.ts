import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AiGateway } from '../ai/ai-gateway.service';
import { AuditService } from '../audit/audit.service';
import { CurrentPrincipal, Roles } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { parse, ulidSchema } from '../common/validate';
import { DbService } from '../db/db.service';
import { buildPackage, parseModel, systemPrompt, userPrompt, verify } from './assistant-rules';
import { AssistantService } from './assistant.service';

/** A fixed, valid id for the audit trail of the one settings row. */
const SETTINGS_ENTITY = '0000000000000000000000ASST';
const TEST_VALID_FOR_MS = 60 * 60 * 1000;

const putSchema = z.object({
  enabled: z.boolean(),
  name: z.string().trim().min(1).max(30),
  modelRowId: ulidSchema.nullable(),
  features: z.object({
    challenge: z.boolean(),
    compare: z.boolean(),
    interview: z.boolean(),
    challengeRecruiter: z.boolean(),
  }),
  unavailableMessage: z.string().trim().min(1).max(300),
  regionAllowed: z.string().trim().max(200),
  dataTerms: z.enum(['unknown', 'no_retention', 'retained_no_training', 'retained_may_train']),
  attest: z.boolean().default(false),
  dailyCap: z.number().int().min(0).max(1_000_000).nullable(),
  monthlyCap: z.number().int().min(0).max(10_000_000).nullable(),
  warnPct: z.number().int().min(1).max(100),
});
const testSchema = z.object({ modelRowId: ulidSchema.nullable().default(null) });

/** ADMIN controls for the assistant (design spec 6.6.6). */
@Roles('ADMIN')
@Controller('admin/assistant')
export class AssistantAdminController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly svc: AssistantService,
    private readonly gateway: AiGateway,
  ) {}

  private async modelKey(modelRowId: string | null): Promise<string | null> {
    if (modelRowId) return `model:${modelRowId}`;
    const a = await this.gateway.active();
    return a ? `model:${a.modelRowId}` : null;
  }

  @Get()
  async get() {
    const s = await this.svc.settings();
    const models = await this.db.query<{ id: string; modelId: string; label: string; provider: string }>(
      `SELECT m.id, m.model_id AS "modelId", m.label, c.name AS provider
         FROM ai_model m JOIN ai_connection c ON c.id = m.connection_id ORDER BY c.name, m.label`,
    );
    const usage = await this.svc.usage();
    const pct = (n: number, cap: number | null) => (cap && cap > 0 ? Math.round((n / cap) * 100) : null);
    const dayPct = pct(usage.today, s.dailyCap);
    const monthPct = pct(usage.month, s.monthlyCap);
    const key = await this.modelKey(s.modelRowId);
    const fresh =
      !!s.testedAt && Date.now() - new Date(s.testedAt).getTime() < TEST_VALID_FOR_MS && s.testedModelKey === key;
    const log = await this.db.query<{ at: Date; actor: string | null; action: string; after: unknown }>(
      `SELECT e.occurred_at AS at, u.display_name AS actor, e.action, e.after
         FROM audit_event e LEFT JOIN app_user u ON u.id = e.actor_id
        WHERE e.entity_type = 'assistant_setting' ORDER BY e.seq DESC LIMIT 30`,
    );
    return {
      settings: { ...s, attestedByName: await this.name(s.attestedBy) },
      models: models.rows,
      activeModel: await this.gateway.active(),
      usage,
      warn: (dayPct !== null && dayPct >= s.warnPct) || (monthPct !== null && monthPct >= s.warnPct),
      testFresh: fresh,
      log: log.rows.map((r) => ({ at: new Date(r.at).toISOString(), by: r.actor, action: r.action, after: r.after })),
    };
  }

  private async name(id: string | null) {
    if (!id) return null;
    const r = await this.db.query<{ n: string }>(`SELECT display_name AS n FROM app_user WHERE id = $1`, [id]);
    return r.rows[0]?.n ?? null;
  }

  @Put()
  async put(@Body() body: unknown, @CurrentPrincipal() p: Principal, @Req() req: FastifyRequest) {
    const b = parse(putSchema, body);
    const before = await this.svc.settings();
    if (b.modelRowId) {
      const ok = await this.db.query(`SELECT 1 FROM ai_model WHERE id = $1`, [b.modelRowId]);
      if (!ok.rows[0]) throw new BadRequestException('That model is not in the list');
    }
    const key = await this.modelKey(b.modelRowId);
    const modelChanged = b.modelRowId !== before.modelRowId;
    const turningOn = b.enabled && !before.enabled;
    if (b.enabled) {
      if (b.dataTerms === 'unknown')
        throw new BadRequestException('Record what the provider does with the data before turning the assistant on');
      if (b.dataTerms === 'retained_may_train')
        throw new BadRequestException('A provider that may train on this data cannot be used for the assistant');
      if (!key) throw new BadRequestException('Choose a model, or make a scoring model active, first');
      if (turningOn || modelChanged) {
        const fresh =
          before.testedModelKey === key &&
          !!before.testedAt &&
          Date.now() - new Date(before.testedAt).getTime() < TEST_VALID_FOR_MS;
        if (!fresh) throw new ConflictException('Run "Test connection" on this model within the last hour first');
      }
    }
    const termsChanged = b.dataTerms !== before.dataTerms || b.regionAllowed !== before.regionAllowed;
    const attestNow = b.attest;
    if (b.enabled && (termsChanged || turningOn) && !b.attest)
      throw new BadRequestException('Confirm that you checked these data terms before turning the assistant on');
    await this.db.withTx(async (tx) => {
      await tx.query(
        `UPDATE assistant_setting SET
           enabled=$1, name=$2, model_row_id=$3, feat_challenge=$4, feat_compare=$5, feat_interview=$6,
           feat_challenge_recruiter=$7, unavailable_message=$8, region_allowed=$9, data_terms=$10,
           daily_cap=$11, monthly_cap=$12, warn_pct=$13, updated_by=$14, updated_at=now(),
           attested_by = CASE WHEN $15::boolean THEN $16::text::ulid ELSE attested_by END,
           attested_at = CASE WHEN $15::boolean THEN now() ELSE attested_at END`,
        [
          b.enabled, b.name, b.modelRowId, b.features.challenge, b.features.compare, b.features.interview,
          b.features.challengeRecruiter, b.unavailableMessage, b.regionAllowed, b.dataTerms,
          b.dailyCap, b.monthlyCap, b.warnPct, p.userId, attestNow, p.userId,
        ],
      );
      const diff: Record<string, { from: unknown; to: unknown }> = {};
      const mark = (k: string, from: unknown, to: unknown) => {
        if (JSON.stringify(from) !== JSON.stringify(to)) diff[k] = { from, to };
      };
      mark('enabled', before.enabled, b.enabled);
      mark('name', before.name, b.name);
      mark('model', before.modelRowId, b.modelRowId);
      mark('features', before.features, b.features);
      mark('unavailableMessage', before.unavailableMessage, b.unavailableMessage);
      mark('regionAllowed', before.regionAllowed, b.regionAllowed);
      mark('dataTerms', before.dataTerms, b.dataTerms);
      mark('dailyCap', before.dailyCap, b.dailyCap);
      mark('monthlyCap', before.monthlyCap, b.monthlyCap);
      mark('warnPct', before.warnPct, b.warnPct);
      if (attestNow) diff.attested = { from: before.attestedAt, to: 'now' };
      if (Object.keys(diff).length) {
        await this.audit.record(tx, {
          actorId: p.userId,
          actorType: p.actorType,
          sourceIp: req.ip,
          action: 'assistant.setting_changed',
          entityType: 'assistant_setting',
          entityId: SETTINGS_ENTITY,
          before: Object.fromEntries(Object.entries(diff).map(([k, v]) => [k, v.from])),
          after: Object.fromEntries(Object.entries(diff).map(([k, v]) => [k, v.to])),
        });
      }
    });
    return this.get();
  }

  /** Sends a made-up evidence package through the real route and checks that the answer is usable. */
  @Post('test')
  @HttpCode(200)
  async test(@Body() body: unknown, @CurrentPrincipal() p: Principal, @Req() req: FastifyRequest) {
    const b = parse(testSchema, body ?? {});
    const key = await this.modelKey(b.modelRowId);
    if (!key) throw new BadRequestException('Choose a model, or make a scoring model active, first');
    const s = await this.svc.settings();
    const built = buildPackage(
      {
        label: 'Candidate 01',
        band: 'good',
        items: [
          { requirementId: '0000000000000000000000TST1', text: 'Network operations experience', classification: 'mandatory', status: 'met' },
          { requirementId: '0000000000000000000000TST2', text: 'Incident response on call', classification: 'mandatory', status: 'not_found' },
        ],
        evidence: new Map([['0000000000000000000000TST1', ['Operated a 24/7 network operations centre for four years']]]),
        reason: 'Operations background is clear; on-call work is not shown.',
        candidateName: null,
        injectionSuspected: false,
      },
      '',
    );
    let ok = false;
    let detail: string;
    const t0 = Date.now();
    try {
      const res = await this.gateway.complete(
        {
          system: systemPrompt(s.name, 'why', 'en', s.features.challengeRecruiter),
          user: userPrompt([built.pkg], 'Why this band?', [], undefined),
          json: true,
          maxTokens: 600,
        },
        b.modelRowId ?? undefined,
      );
      const parsed = parseModel(res.text);
      const ans = verify(parsed, { packages: [built], intent: 'why' });
      ok = !!parsed && ans.kind === 'answer' && ans.claims.length > 0;
      detail = ok ? `${res.provider} / ${res.model} answered in the expected shape.` : 'The model answered, but not in a form that can be checked.';
    } catch (e) {
      detail = (e as Error).message;
    }
    await this.db.withTx(async (tx) => {
      if (ok) {
        await tx.query(`UPDATE assistant_setting SET tested_model_key=$1, tested_at=now()`, [key]);
      }
      await this.audit.record(tx, {
        actorId: p.userId,
        actorType: p.actorType,
        sourceIp: req.ip,
        action: 'assistant.tested',
        entityType: 'assistant_setting',
        entityId: SETTINGS_ENTITY,
        after: { ok, model: key },
      });
    });
    return { ok, detail, ms: Date.now() - t0 };
  }

  /** Turns the assistant has answered, for the compliance review (flags and model, not CV text). */
  @Get('audit')
  @Roles('ADMIN', 'GOVERNANCE')
  async turns() {
    const { rows } = await this.db.query<{
      at: Date;
      user: string | null;
      label: string | null;
      flags: string[];
      model: string | null;
      prompt: string | null;
      kind: string | null;
      counted: boolean;
    }>(
      `SELECT m.created_at AS at, u.display_name AS "user", m.label, m.flags, m.model,
              m.prompt_version AS prompt, m.content->>'kind' AS kind, m.counted
         FROM assistant_message m JOIN assistant_thread t ON t.id = m.thread_id
         LEFT JOIN app_user u ON u.id = t.user_id
        WHERE m.role = 'assistant' ORDER BY m.created_at DESC, m.id DESC LIMIT 200`,
    );
    return { turns: rows.map((r) => ({ ...r, at: new Date(r.at).toISOString() })) };
  }
}
