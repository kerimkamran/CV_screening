import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { newId } from '@cv/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { CurrentPrincipal, Roles } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { parse, ulidSchema } from '../common/validate';
import { DbService, type Queryable } from '../db/db.service';
import { AiGateway } from './ai-gateway.service';
import { normaliseBaseUrl, PROVIDER_KINDS, validateBaseUrl } from './providers';
import { SettingsCrypto } from './settings-crypto';

const nameSchema = z.string().trim().min(1).max(60);
const keySchema = z.string().trim().min(8).max(500);
const modelIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(150)
  .regex(/^[\w.\-:/@]+$/, 'model id has unsupported characters');
const baseUrlSchema = z
  .string()
  .trim()
  .max(300)
  .transform((v, ctx) => {
    try {
      validateBaseUrl(v);
      return normaliseBaseUrl(v);
    } catch (e) {
      ctx.addIssue({ code: 'custom', message: (e as Error).message });
      return z.NEVER;
    }
  });

/**
 * ADMIN-only. An admin adds any number of AI companies ("connections"), each with one api key;
 * picks models from the company's own list; and decides which one model is active.
 * Keys go in, never out: responses carry only the last four characters.
 * Every change is audited in the same transaction, without the key.
 */
@Roles('ADMIN')
@Controller('admin/ai')
export class AiAdminController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly crypto: SettingsCrypto,
    private readonly gateway: AiGateway,
  ) {}

  @Get()
  async list() {
    const conns = await this.db.query<{
      id: string;
      name: string;
      kind: string;
      baseUrl: string | null;
      keyHint: string;
      updatedAt: string;
    }>(
      `SELECT id, name, kind, base_url AS "baseUrl", key_hint AS "keyHint", updated_at AS "updatedAt"
         FROM ai_connection ORDER BY lower(name)`,
    );
    const models = await this.db.query<{
      id: string;
      connectionId: string;
      modelId: string;
      label: string;
      isActive: boolean;
    }>(
      `SELECT m.id, m.connection_id AS "connectionId", m.model_id AS "modelId", m.label,
              (s.active_model = m.id) IS TRUE AS "isActive"
         FROM ai_model m CROSS JOIN ai_setting s ORDER BY lower(m.model_id)`,
    );
    const active = await this.gateway.active();
    return {
      active,
      connections: conns.rows.map((c) => ({
        ...c,
        models: models.rows.filter((m) => m.connectionId === c.id),
      })),
    };
  }

  @Post('connections')
  async create(
    @Body() body: unknown,
    @CurrentPrincipal() actor: Principal,
    @Req() req: FastifyRequest,
  ) {
    const b = parse(
      z.object({
        name: nameSchema,
        kind: z.enum(PROVIDER_KINDS),
        baseUrl: baseUrlSchema.optional(),
        apiKey: keySchema,
      }),
      body,
    );
    if (b.kind === 'openai_compatible' && !b.baseUrl) {
      throw new BadRequestException('Base URL is required for an OpenAI-compatible company');
    }
    if (b.kind !== 'openai_compatible' && b.baseUrl) {
      throw new BadRequestException('Base URL applies only to OpenAI-compatible companies');
    }
    if (b.baseUrl) await this.checkHost(b.baseUrl);
    const id = newId();
    const aad = `conn:${id}`;
    const cipher = this.crypto.encrypt(b.apiKey, aad);
    return this.db.withTx(async (tx) => {
      await this.insertConnection(tx, id, b, cipher, aad, actor.userId);
      await this.record(tx, actor, req, 'ai.connection_added', id, {
        name: b.name,
        kind: b.kind,
        baseUrl: b.baseUrl,
      });
      return { id };
    });
  }

  @Put('connections/:id')
  async update(
    @Param('id') rawId: string,
    @Body() body: unknown,
    @CurrentPrincipal() actor: Principal,
    @Req() req: FastifyRequest,
  ) {
    const id = parse(ulidSchema, rawId);
    const b = parse(
      z.object({
        name: nameSchema.optional(),
        baseUrl: baseUrlSchema.optional(),
        apiKey: keySchema.optional(),
      }),
      body,
    );
    if (!b.name && !b.baseUrl && !b.apiKey) throw new BadRequestException('Nothing to update');
    if (b.baseUrl) await this.checkHost(b.baseUrl);
    return this.db.withTx(async (tx) => {
      const cur = await tx.query<{ kind: string; key_aad: string }>(
        `SELECT kind, key_aad FROM ai_connection WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const c = cur.rows[0];
      if (!c) throw new NotFoundException();
      if (b.baseUrl && c.kind !== 'openai_compatible') {
        throw new BadRequestException('Base URL applies only to OpenAI-compatible companies');
      }
      await this.guardName(tx, b.name, id, async () => {
        await tx.query(
          `UPDATE ai_connection SET
              name = COALESCE($2, name), base_url = COALESCE($3, base_url),
              key_ciphertext = COALESCE($4, key_ciphertext), key_hint = COALESCE($5, key_hint),
              updated_by = $6, updated_at = now()
            WHERE id = $1`,
          [
            id,
            b.name ?? null,
            b.baseUrl ?? null,
            b.apiKey ? this.crypto.encrypt(b.apiKey, c.key_aad) : null,
            b.apiKey ? b.apiKey.slice(-4) : null,
            actor.userId,
          ],
        );
      });
      await this.record(tx, actor, req, 'ai.connection_updated', id, {
        name: b.name,
        baseUrl: b.baseUrl,
        keyReplaced: Boolean(b.apiKey),
      });
      return { id, saved: true };
    });
  }

  /** Removes a company, its key and its models. If one of its models was active, nothing is active. */
  @Delete('connections/:id')
  remove(
    @Param('id') rawId: string,
    @CurrentPrincipal() actor: Principal,
    @Req() req: FastifyRequest,
  ) {
    const id = parse(ulidSchema, rawId);
    return this.db.withTx(async (tx) => {
      const del = await tx.query(`DELETE FROM ai_connection WHERE id = $1`, [id]);
      if (!del.rowCount) throw new NotFoundException();
      await this.record(tx, actor, req, 'ai.connection_removed', id, {});
      return { id, removed: true };
    });
  }

  /** The models this company's key can use, for the admin's picker. */
  @Get('connections/:id/available-models')
  async available(@Param('id') rawId: string) {
    const id = parse(ulidSchema, rawId);
    try {
      return { models: await this.gateway.listModels(id) };
    } catch (e) {
      if (e instanceof NotFoundException) throw e;
      // 200 with a message so the UI can fall back to typing a model id.
      return { models: [], error: (e as Error).message.slice(0, 200) };
    }
  }

  /** Adds models to the admin's shortlist for this company (picked from the list, or typed). */
  @Post('connections/:id/models')
  async addModels(
    @Param('id') rawId: string,
    @Body() body: unknown,
    @CurrentPrincipal() actor: Principal,
    @Req() req: FastifyRequest,
  ) {
    const id = parse(ulidSchema, rawId);
    const { models } = parse(
      z.object({
        models: z
          .array(z.object({ modelId: modelIdSchema, label: z.string().trim().max(150).optional() }))
          .min(1)
          .max(100),
      }),
      body,
    );
    return this.db.withTx(async (tx) => {
      const exists = await tx.query(`SELECT 1 FROM ai_connection WHERE id = $1`, [id]);
      if (!exists.rowCount) throw new NotFoundException();
      let added = 0;
      for (const m of models) {
        const r = await tx.query(
          `INSERT INTO ai_model (id, connection_id, model_id, label) VALUES ($1, $2, $3, $4)
           ON CONFLICT (connection_id, model_id) DO NOTHING`,
          [newId(), id, m.modelId, m.label || m.modelId],
        );
        added += r.rowCount ?? 0;
      }
      await this.record(tx, actor, req, 'ai.models_added', id, {
        models: models.map((m) => m.modelId),
      });
      return { added };
    });
  }

  @Delete('models/:id')
  removeModel(
    @Param('id') rawId: string,
    @CurrentPrincipal() actor: Principal,
    @Req() req: FastifyRequest,
  ) {
    const id = parse(ulidSchema, rawId);
    return this.db.withTx(async (tx) => {
      const del = await tx.query<{ model_id: string }>(
        `DELETE FROM ai_model WHERE id = $1 RETURNING model_id`,
        [id],
      );
      if (!del.rowCount) throw new NotFoundException();
      await this.record(tx, actor, req, 'ai.model_removed', id, { model: del.rows[0]!.model_id });
      return { id, removed: true };
    });
  }

  /** Chooses the one model screening uses. */
  @Put('active')
  async setActive(
    @Body() body: unknown,
    @CurrentPrincipal() actor: Principal,
    @Req() req: FastifyRequest,
  ) {
    const { modelId } = parse(z.object({ modelId: ulidSchema }), body);
    return this.db.withTx(async (tx) => {
      const m = await tx.query<{ model_id: string; name: string }>(
        `SELECT m.model_id, c.name FROM ai_model m JOIN ai_connection c ON c.id = m.connection_id
          WHERE m.id = $1`,
        [modelId],
      );
      if (!m.rowCount) throw new NotFoundException('Unknown model');
      await tx.query(
        `UPDATE ai_setting SET active_model = $1, updated_by = $2, updated_at = now()`,
        [modelId, actor.userId],
      );
      await this.record(tx, actor, req, 'ai.activate', modelId, {
        provider: m.rows[0]!.name,
        model: m.rows[0]!.model_id,
      });
      return { active: modelId };
    });
  }

  /** Sends a trivial prompt (no candidate data) to prove the key and this model work. */
  @Post('models/:id/test')
  @HttpCode(200)
  async test(@Param('id') rawId: string) {
    const id = parse(ulidSchema, rawId);
    const started = Date.now();
    try {
      const r = await this.gateway.complete(
        { system: 'Reply with the single word: ok', user: 'ping', maxTokens: 16 },
        id,
      );
      return { ok: r.text.trim().length > 0, ms: Date.now() - started, model: r.model };
    } catch (e) {
      if (e instanceof NotFoundException) throw e;
      return { ok: false, ms: Date.now() - started, error: (e as Error).message.slice(0, 200) };
    }
  }

  private async checkHost(url: string) {
    try {
      await this.gateway.hostCheck(url);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  private async insertConnection(
    tx: Queryable,
    id: string,
    b: { name: string; kind: string; baseUrl?: string; apiKey: string },
    cipher: string,
    aad: string,
    actorId: string,
  ) {
    await this.guardName(tx, b.name, undefined, async () => {
      await tx.query(
        `INSERT INTO ai_connection (id, name, kind, base_url, key_ciphertext, key_hint, key_aad, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, b.name, b.kind, b.baseUrl ?? null, cipher, b.apiKey.slice(-4), aad, actorId],
      );
    });
  }

  /** Runs `write`, turning the unique-name violation into a clear 409. */
  private async guardName(
    tx: Queryable,
    name: string | undefined,
    _selfId: string | undefined,
    write: () => Promise<void>,
  ) {
    try {
      await tx.query('SAVEPOINT name_guard');
      await write();
      await tx.query('RELEASE SAVEPOINT name_guard');
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        await tx.query('ROLLBACK TO SAVEPOINT name_guard');
        throw new ConflictException(`A company named "${name}" already exists`);
      }
      throw e;
    }
  }

  private record(
    tx: Queryable,
    actor: Principal,
    req: FastifyRequest,
    action: string,
    entityId: string,
    after: Record<string, unknown>,
  ) {
    return this.audit.record(tx, {
      actorId: actor.userId,
      actorType: actor.actorType,
      actorRole: 'ADMIN',
      sourceIp: req.ip,
      action,
      entityType: 'ai_provider',
      entityId,
      after,
    });
  }
}
