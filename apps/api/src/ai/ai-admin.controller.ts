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
import { COMPANIES, COMPANY_IDS, publicCatalog, validateSettings, type CompanyId } from './catalog';
import { ProviderError, type ModelInfo } from './providers';
import { SettingsCrypto } from './settings-crypto';

const companySchema = z.enum(COMPANY_IDS);
const keySchema = z.string().trim().min(8).max(500);
const modelIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(150)
  .regex(/^[\w.\-:/@]+$/, 'model id has unsupported characters');
const settingsSchema = z.record(z.string().max(40), z.unknown()).optional();
const modelsSchema = z
  .array(z.object({ modelId: modelIdSchema, label: z.string().trim().max(150).optional() }))
  .max(100);

/** Applies the company's own rules to its options, as a 400 on failure. */
function settingsFor(company: CompanyId, raw: Record<string, unknown> | undefined) {
  try {
    return validateSettings(company, raw);
  } catch (e) {
    throw new BadRequestException((e as Error).message);
  }
}

/**
 * ADMIN-only. The admin chooses a supported AI company, chooses models from that company's list,
 * and adds ONE api key for the company; then decides which one model is active.
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

  /** The companies the admin can choose from, with their options and documented models. */
  @Get('catalog')
  catalog() {
    return { companies: publicCatalog() };
  }

  @Get()
  async list() {
    const conns = await this.db.query<{
      id: string;
      company: string;
      name: string;
      settings: Record<string, string>;
      keyHint: string;
      updatedAt: string;
    }>(
      `SELECT id, company, name, settings, key_hint AS "keyHint", updated_at AS "updatedAt"
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

  /** Adds a company with its one key, and (optionally) the models picked for it, in one step. */
  @Post('connections')
  async create(
    @Body() body: unknown,
    @CurrentPrincipal() actor: Principal,
    @Req() req: FastifyRequest,
  ) {
    const b = parse(
      z.object({
        company: companySchema,
        apiKey: keySchema,
        settings: settingsSchema,
        models: modelsSchema.optional(),
      }),
      body,
    );
    const settings = settingsFor(b.company, b.settings);
    const name = COMPANIES[b.company].name;
    const id = newId();
    const aad = `conn:${id}`;
    const cipher = this.crypto.encrypt(b.apiKey, aad);
    return this.db.withTx(async (tx) => {
      await this.guardDuplicate(tx, name, async () => {
        await tx.query(
          `INSERT INTO ai_connection (id, company, name, settings, key_ciphertext, key_hint, key_aad, updated_by)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)`,
          [
            id,
            b.company,
            name,
            JSON.stringify(settings),
            cipher,
            b.apiKey.slice(-4),
            aad,
            actor.userId,
          ],
        );
      });
      const added = await this.insertModels(tx, id, b.models ?? []);
      await this.record(tx, actor, req, 'ai.connection_added', id, {
        company: b.company,
        settings,
        models: (b.models ?? []).map((m) => m.modelId),
      });
      return { id, added };
    });
  }

  /** Replaces the key and/or the options of a company. */
  @Put('connections/:id')
  async update(
    @Param('id') rawId: string,
    @Body() body: unknown,
    @CurrentPrincipal() actor: Principal,
    @Req() req: FastifyRequest,
  ) {
    const id = parse(ulidSchema, rawId);
    const b = parse(z.object({ apiKey: keySchema.optional(), settings: settingsSchema }), body);
    if (!b.apiKey && !b.settings) throw new BadRequestException('Nothing to update');
    return this.db.withTx(async (tx) => {
      const cur = await tx.query<{ company: CompanyId; key_aad: string }>(
        `SELECT company, key_aad FROM ai_connection WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const c = cur.rows[0];
      if (!c) throw new NotFoundException();
      const settings = b.settings ? settingsFor(c.company, b.settings) : null;
      await tx.query(
        `UPDATE ai_connection SET
            settings = COALESCE($2::jsonb, settings),
            key_ciphertext = COALESCE($3, key_ciphertext), key_hint = COALESCE($4, key_hint),
            updated_by = $5, updated_at = now()
          WHERE id = $1`,
        [
          id,
          settings ? JSON.stringify(settings) : null,
          b.apiKey ? this.crypto.encrypt(b.apiKey, c.key_aad) : null,
          b.apiKey ? b.apiKey.slice(-4) : null,
          actor.userId,
        ],
      );
      await this.record(tx, actor, req, 'ai.connection_updated', id, {
        settings,
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

  /**
   * Every model of a company that a key can use. For a company that is already added, the stored
   * key is used. Before it is added, the admin may send the key once (it is used for this one
   * request and neither stored nor logged). If the company offers no live list, the models from
   * its documentation are returned and the admin can still type any model id.
   */
  @Post('discover')
  @HttpCode(200)
  async discover(@Body() body: unknown) {
    const b = parse(
      z.object({ company: companySchema, apiKey: keySchema, settings: settingsSchema }),
      body,
    );
    const settings = settingsFor(b.company, b.settings);
    return this.live(b.company, () =>
      this.gateway.discover({ company: b.company, key: b.apiKey, settings }),
    );
  }

  @Get('connections/:id/available-models')
  async available(@Param('id') rawId: string) {
    const id = parse(ulidSchema, rawId);
    const row = await this.db.query<{ company: CompanyId }>(
      `SELECT company FROM ai_connection WHERE id = $1`,
      [id],
    );
    if (!row.rows[0]) throw new NotFoundException();
    return this.live(row.rows[0].company, () => this.gateway.listModels(id));
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
    const { models } = parse(z.object({ models: modelsSchema.min(1) }), body);
    return this.db.withTx(async (tx) => {
      const exists = await tx.query(`SELECT 1 FROM ai_connection WHERE id = $1`, [id]);
      if (!exists.rowCount) throw new NotFoundException();
      const added = await this.insertModels(tx, id, models);
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
      const detail = e instanceof ProviderError && e.detail ? ` (${e.detail})` : '';
      return {
        ok: false,
        ms: Date.now() - started,
        error: `${(e as Error).message}${detail}`.slice(0, 400),
      };
    }
  }

  /** The company's live list, or (200, with a message) its documented models when it has none. */
  private async live(company: CompanyId, fetchLive: () => Promise<ModelInfo[]>) {
    try {
      const models = await fetchLive();
      if (models.length) return { live: true, models };
      return {
        live: false,
        models: this.known(company),
        error: 'The company returned no models for this key; showing its documented models.',
      };
    } catch (e) {
      if (e instanceof NotFoundException) throw e;
      const detail = e instanceof ProviderError && e.detail ? ` (${e.detail})` : '';
      return {
        live: false,
        models: this.known(company),
        error:
          `${(e as Error).message}${detail}`.slice(0, 300) +
          `. Showing the documented models; you can also type a model id.`,
      };
    }
  }

  private known(company: CompanyId): ModelInfo[] {
    return COMPANIES[company].knownModels.map((m) => ({ id: m.id, label: m.label }));
  }

  private async insertModels(
    tx: Queryable,
    connectionId: string,
    models: { modelId: string; label?: string | undefined }[],
  ): Promise<number> {
    let added = 0;
    for (const m of models) {
      const r = await tx.query(
        `INSERT INTO ai_model (id, connection_id, model_id, label) VALUES ($1, $2, $3, $4)
         ON CONFLICT (connection_id, model_id) DO NOTHING`,
        [newId(), connectionId, m.modelId, m.label || m.modelId],
      );
      added += r.rowCount ?? 0;
    }
    return added;
  }

  /** Runs `write`, turning the one-connection-per-company violation into a clear 409. */
  private async guardDuplicate(tx: Queryable, name: string, write: () => Promise<void>) {
    try {
      await tx.query('SAVEPOINT dup_guard');
      await write();
      await tx.query('RELEASE SAVEPOINT dup_guard');
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        await tx.query('ROLLBACK TO SAVEPOINT dup_guard');
        throw new ConflictException(
          `${name} is already added. Add more models to it, or replace its key.`,
        );
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
