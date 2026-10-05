import {
  BadRequestException,
  Body,
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
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { CurrentPrincipal, Roles } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { parse } from '../common/validate';
import { DbService } from '../db/db.service';
import { AiGateway } from './ai-gateway.service';
import { PROVIDERS, type ProviderKind } from './providers';
import { SettingsCrypto } from './settings-crypto';

const providerSchema = z.enum(PROVIDERS);

/**
 * ADMIN-only. Keys go in, never out: responses carry only `hasKey` and the last four characters.
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
    const { rows } = await this.db.query(
      `SELECT c.provider, c.model, (c.key_ciphertext IS NOT NULL) AS "hasKey", c.key_hint AS "keyHint",
              COALESCE(s.active_provider = c.provider, false) AS "isActive", c.updated_at AS "updatedAt"
         FROM ai_provider_config c CROSS JOIN ai_setting s ORDER BY c.provider`,
    );
    return rows;
  }

  @Put('active')
  async setActive(
    @Body() body: unknown,
    @CurrentPrincipal() actor: Principal,
    @Req() req: FastifyRequest,
  ) {
    const { provider } = parse(z.object({ provider: providerSchema }), body);
    return this.db.withTx(async (tx) => {
      const has = await tx.query(
        `SELECT 1 FROM ai_provider_config WHERE provider = $1 AND key_ciphertext IS NOT NULL`,
        [provider],
      );
      if (!has.rowCount) throw new BadRequestException('Add an API key for this provider first');
      await tx.query(
        `UPDATE ai_setting SET active_provider = $1, updated_by = $2, updated_at = now()`,
        [provider, actor.userId],
      );
      await this.audit.record(tx, {
        actorId: actor.userId,
        actorType: actor.actorType,
        actorRole: 'ADMIN',
        sourceIp: req.ip,
        action: 'ai.activate',
        entityType: 'ai_provider',
        entityId: actor.userId,
        after: { provider },
      });
      return { active: provider };
    });
  }

  @Put(':provider')
  async upsert(
    @Param('provider') p: string,
    @Body() body: unknown,
    @CurrentPrincipal() actor: Principal,
    @Req() req: FastifyRequest,
  ) {
    const provider = parse(providerSchema, p);
    const { apiKey, model } = parse(
      z.object({
        apiKey: z.string().trim().min(8).max(500).optional(),
        model: z
          .string()
          .trim()
          .min(1)
          .max(100)
          .regex(/^[\w.\-:/]+$/)
          .optional(),
      }),
      body,
    );
    if (!apiKey && !model) throw new BadRequestException('Nothing to update');
    const cipher = apiKey ? this.crypto.encrypt(apiKey, provider) : undefined;
    return this.db.withTx(async (tx) => {
      await tx.query(
        `UPDATE ai_provider_config SET
            model = COALESCE($2, model),
            key_ciphertext = COALESCE($3, key_ciphertext),
            key_hint = COALESCE($4, key_hint),
            updated_by = $5, updated_at = now()
          WHERE provider = $1`,
        [provider, model ?? null, cipher ?? null, apiKey ? apiKey.slice(-4) : null, actor.userId],
      );
      await this.audit.record(tx, {
        actorId: actor.userId,
        actorType: actor.actorType,
        actorRole: 'ADMIN',
        sourceIp: req.ip,
        action: 'ai.configure',
        entityType: 'ai_provider',
        entityId: actor.userId,
        after: { provider, model: model ?? undefined, keyReplaced: Boolean(apiKey) },
      });
      return { provider, saved: true };
    });
  }

  @Delete(':provider/key')
  removeKey(
    @Param('provider') p: string,
    @CurrentPrincipal() actor: Principal,
    @Req() req: FastifyRequest,
  ) {
    const provider = parse(providerSchema, p);
    return this.db.withTx(async (tx) => {
      const upd = await tx.query(
        `UPDATE ai_provider_config SET key_ciphertext = NULL, key_hint = NULL,
                updated_by = $2, updated_at = now() WHERE provider = $1 AND key_ciphertext IS NOT NULL`,
        [provider, actor.userId],
      );
      if (!upd.rowCount) throw new NotFoundException();
      // Never leave a provider active without a key.
      await tx.query(
        `UPDATE ai_setting SET active_provider = NULL, updated_by = $2, updated_at = now()
          WHERE active_provider = $1`,
        [provider, actor.userId],
      );
      await this.audit.record(tx, {
        actorId: actor.userId,
        actorType: actor.actorType,
        actorRole: 'ADMIN',
        sourceIp: req.ip,
        action: 'ai.key_removed',
        entityType: 'ai_provider',
        entityId: actor.userId,
        after: { provider },
      });
      return { provider, removed: true };
    });
  }

  /** Sends a trivial prompt (no candidate data) to prove the key and model work. */
  @Post(':provider/test')
  @HttpCode(200)
  async test(@Param('provider') p: string) {
    const provider: ProviderKind = parse(providerSchema, p);
    const started = Date.now();
    try {
      const r = await this.gateway.complete(
        { system: 'Reply with the single word: ok', user: 'ping', maxTokens: 16 },
        provider,
      );
      return { ok: r.text.trim().length > 0, ms: Date.now() - started, model: r.model };
    } catch (e) {
      return { ok: false, ms: Date.now() - started, error: (e as Error).message.slice(0, 200) };
    }
  }
}
