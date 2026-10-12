import {
  BadGatewayException,
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { EXPERIENCE_LINE, type ExperienceRange } from '@cv/shared';
import type { FastifyRequest } from 'fastify';
import { AiGateway } from '../ai/ai-gateway.service';
import { ProviderError } from '../ai/providers';
import { AuditService } from '../audit/audit.service';
import { CurrentPrincipal, Roles } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { parse, ulidSchema } from '../common/validate';
import { DbService } from '../db/db.service';
import { VacancyScope } from '../vacancy/vacancy-scope.service';
import { CriteriaSets, type ReqInput } from './criteria-sets';
import { EXTRACT_SYSTEM, extractUser } from './prompts';
import { extractionOutput, parseJsonLoose, requirementsInput } from './schemas';
import { z } from 'zod';

const HUMAN = ['TA_PARTNER', 'TA_LEAD'] as const;

/** JOB-02..07: AI proposes criteria from the JD; the recruiter edits and freezes them. */
@Roles(...HUMAN)
@Controller('vacancies/:id/criteria')
export class CriteriaController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly scope: VacancyScope,
    private readonly ai: AiGateway,
    private readonly sets: CriteriaSets,
  ) {}

  private async view(vid: string) {
    const sets = await this.db.query<{ id: string; version: number; frozenAt: Date | null }>(
      `SELECT id, version, frozen_at AS "frozenAt" FROM requirement_set
        WHERE vacancy_id = $1 ORDER BY version DESC`,
      [vid],
    );
    const current = sets.rows[0];
    if (!current) return { versions: [], current: null };
    const reqs = await this.db.query(
      `SELECT id, text, classification, weight::float AS weight, rule, extraction_conf AS confidence
         FROM requirement WHERE requirement_set_id = $1 ORDER BY position, id`,
      [current.id],
    );
    return {
      versions: sets.rows,
      current: {
        id: current.id,
        version: current.version,
        frozen: current.frozenAt !== null,
        requirements: reqs.rows,
      },
    };
  }

  @Get()
  async get(@Param('id') id: string, @CurrentPrincipal() p: Principal) {
    const vid = parse(ulidSchema, id);
    await this.scope.assert(p, vid);
    return this.view(vid);
  }

  /** JOB-02: propose criteria from the latest JD. Always lands as an editable draft. */
  @Post('extract')
  @HttpCode(200)
  async extract(
    @Param('id') id: string,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ) {
    const vid = parse(ulidSchema, id);
    await this.scope.assert(p, vid);
    const jd = (
      await this.db.query<{ id: string; body: string }>(
        `SELECT id, body FROM job_description_version WHERE vacancy_id = $1 ORDER BY version DESC LIMIT 1`,
        [vid],
      )
    ).rows[0]!;
    // The experience range is a chip on the Role card, not part of the pasted text: add it here.
    const exp = (
      await this.db.query<{ r: ExperienceRange }>(
        `SELECT experience_range AS r FROM vacancy WHERE id = $1`,
        [vid],
      )
    ).rows[0]!.r;
    const jdBody = [jd.body.trim(), EXPERIENCE_LINE[exp]].filter(Boolean).join('\n\n');

    let proposed: ReqInput[];
    let used: { provider: string; model: string };
    try {
      const out = await this.ai.complete({
        system: EXTRACT_SYSTEM,
        user: extractUser(jdBody),
        json: true,
        maxTokens: 4000,
      });
      used = out;
      const parsed = extractionOutput.parse(parseJsonLoose(out.text));
      proposed = parsed.requirements
        .map((r) => ({
          text: r.text.trim().slice(0, 500),
          classification: r.classification,
          weight:
            r.classification === 'mandatory' || r.classification === 'preferred'
              ? Math.min(
                  100,
                  Math.max(1, Math.round(r.weight ?? (r.classification === 'mandatory' ? 10 : 5))),
                )
              : null,
          rule: r.classification === 'disqualifier' ? (r.rule ?? null) : null,
          confidence: r.confidence ?? 'unknown',
        }))
        // A disqualifier without a usable rule cannot be evaluated deterministically: keep it as
        // a mandatory criterion rather than silently dropping the JD's statement.
        .map((r) =>
          r.classification === 'disqualifier' && !r.rule
            ? { ...r, classification: 'mandatory' as const, weight: 10 }
            : r,
        )
        .filter((r) => r.text.length >= 3)
        .slice(0, 40) as ReqInput[];
      if (!proposed.length) throw new Error('no criteria extracted');
    } catch (e) {
      if (e instanceof ProviderError) throw new BadGatewayException(e.message);
      if (e instanceof HttpException) throw e; // e.g. no provider active (503)
      throw new BadGatewayException(
        'The AI provider returned output that could not be used. Try again.',
      );
    }

    await this.db.withTx(async (tx) => {
      const prev = await this.sets.latest(tx, vid);
      const before = prev ? await this.sets.requirements(tx, prev.id) : [];
      const setId = await this.sets.draftSet(tx, vid, p.userId, jd.id, true);
      await this.sets.replaceRequirements(tx, setId, proposed);
      const changes = this.sets.diff(before, proposed);
      if (changes.length) await this.sets.bump(tx, vid, p.userId, 'edit', changes, jd.body, null);
      await this.audit.record(tx, {
        actorId: p.userId,
        actorType: p.actorType,
        sourceIp: req.ip,
        action: 'criteria.extract',
        entityType: 'vacancy',
        entityId: vid,
        after: { count: proposed.length, provider: used.provider, model: used.model },
      });
    });
    return this.view(vid);
  }

  /** JOB-03/04: the recruiter's edits replace the draft. */
  @Put()
  async replace(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ) {
    const vid = parse(ulidSchema, id);
    const { requirements } = parse(z.object({ requirements: requirementsInput }), body);
    await this.scope.assert(p, vid);
    await this.db.withTx(async (tx) => {
      const latest = await this.sets.latest(tx, vid);
      if (!latest || latest.frozen) {
        throw new ConflictException(
          'Criteria are frozen or not started. Create a new version first.',
        );
      }
      const before = await this.sets.requirements(tx, latest.id);
      await this.sets.replaceRequirements(tx, latest.id, requirements);
      const changes = this.sets.diff(before, requirements);
      if (changes.length) {
        const jd = await this.sets.latestJd(tx, vid);
        await this.sets.bump(tx, vid, p.userId, 'edit', changes, jd?.body ?? null, null);
      }
      await this.audit.record(tx, {
        actorId: p.userId,
        actorType: p.actorType,
        sourceIp: req.ip,
        action: 'criteria.edit',
        entityType: 'vacancy',
        entityId: vid,
        after: { count: requirements.length },
      });
    });
    return this.view(vid);
  }

  /** Start a draft with no AI help (blank) or a copy of the frozen set so it can be changed. */
  @Post('new-version')
  @HttpCode(201)
  async newVersion(
    @Param('id') id: string,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ) {
    const vid = parse(ulidSchema, id);
    await this.scope.assert(p, vid);
    await this.db.withTx(async (tx) => {
      await tx.query(`SELECT 1 FROM vacancy WHERE id = $1 FOR UPDATE`, [vid]);
      const latest = await this.sets.latest(tx, vid);
      if (latest && !latest.frozen) throw new ConflictException('A draft already exists');
      const jd = (
        await tx.query<{ id: string }>(
          `SELECT id FROM job_description_version WHERE vacancy_id = $1 ORDER BY version DESC LIMIT 1`,
          [vid],
        )
      ).rows[0]!;
      const setId = await this.sets.draftSet(tx, vid, p.userId, jd.id, false);
      if (latest) await this.sets.copyRequirements(tx, latest.id, setId);
      await this.audit.record(tx, {
        actorId: p.userId,
        actorType: p.actorType,
        sourceIp: req.ip,
        action: 'criteria.new_version',
        entityType: 'vacancy',
        entityId: vid,
      });
    });
    return this.view(vid);
  }

  /** JOB-07: freeze. From here the set is immutable (database trigger) and screenings reference it. */
  @Post('freeze')
  @HttpCode(200)
  async freeze(
    @Param('id') id: string,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ) {
    const vid = parse(ulidSchema, id);
    await this.scope.assert(p, vid);
    await this.db.withTx(async (tx) => {
      const latest = await this.sets.latest(tx, vid);
      if (!latest || latest.frozen) throw new ConflictException('There is no draft to freeze');
      const n = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM requirement
          WHERE requirement_set_id = $1 AND classification IN ('mandatory','preferred')`,
        [latest.id],
      );
      if (n.rows[0]!.n < 1) {
        throw new BadRequestException(
          'Add at least one mandatory or preferred criterion to score against',
        );
      }
      await tx.query(
        `UPDATE requirement_set SET frozen_at = now(),
                requirements_version = (SELECT requirements_version FROM vacancy WHERE id = $2)
          WHERE id = $1`,
        [latest.id, vid],
      );
      await this.audit.record(tx, {
        actorId: p.userId,
        actorType: p.actorType,
        sourceIp: req.ip,
        action: 'criteria.freeze',
        entityType: 'requirement_set',
        entityId: latest.id,
        after: { vacancyId: vid, version: latest.version },
      });
    });
    return this.view(vid);
  }
}
