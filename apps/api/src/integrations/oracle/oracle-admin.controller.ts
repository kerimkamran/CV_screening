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
  UseGuards,
} from '@nestjs/common';
import { newId } from '@cv/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuditService } from '../../audit/audit.service';
import { CurrentPrincipal, Roles } from '../../auth/decorators';
import type { Principal } from '../../auth/principal';
import { SettingsCrypto } from '../../ai/settings-crypto';
import { parse } from '../../common/validate';
import { DbService } from '../../db/db.service';
import { finishRun } from '../import-runs';
import {
  ORACLE_EXAMPLE_ADDRESS,
  ORACLE_HOST_SUFFIX,
  oracleOrigin,
  resolvesPublic,
} from './oracle-address';
import { SourceError } from '../import-source';
import {
  aadFor,
  AuthCircuitOpen,
  categoryKey,
  isRsaPrivateKey,
  OracleConnectionService,
  type ConnectionRow,
  type OracleSettings,
} from './oracle-connection.service';
import { DOWNLOAD_ROUTES } from './oracle-hcm.client';
import { OracleEnabledGuard } from './oracle-enabled.guard';
import { refuse } from './oracle-refusals';

export type ActivateCode =
  'ok' | 'auth_failed' | 'empty_scope' | 'unreachable' | 'not_oracle_address';
export const NOT_ORACLE_ADDRESS = `This is not an Oracle address. It must start with https:// and end in ${ORACLE_HOST_SUFFIX}.`;
/** How many applications "Find category names" reads at most (each costs one attachments call). */
const CATEGORY_SAMPLE = 20;
const TEST_EVERY_MS = 5 * 60_000;
const DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable()
  .optional();

/**
 * Stage 3, S3-INT-09 (plan 15.3 note 1, 15): the one admin card. Activate is the one call behind the
 * one button: validate the address, store the password encrypted, make one test call, switch on.
 * Its result is one of five codes. The password goes in and never comes out (not in an answer, a
 * log line or an audit row). No database connection is held during the test call.
 */
@Roles('ADMIN')
@UseGuards(OracleEnabledGuard)
@Controller('admin/integrations/oracle')
export class OracleAdminController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly crypto: SettingsCrypto,
    private readonly conns: OracleConnectionService,
  ) {}

  /** The operator's own Oracle hosts (`ORACLE_OWN_HOSTS`), allowed besides `*.oraclecloud.com`. */
  private get own() {
    return this.conns.client.ownHosts;
  }

  private async view(row: ConnectionRow | null) {
    const s = this.conns.settings(row);
    const name = async (id: string | null) =>
      id
        ? ((
            await this.db.query<{ n: string }>(
              `SELECT COALESCE(display_name, email) AS n FROM app_user WHERE id = $1`,
              [id],
            )
          ).rows[0]?.n ?? null)
        : null;
    return {
      available: true,
      example: ORACLE_EXAMPLE_ADDRESS,
      suffix: ORACLE_HOST_SUFFIX,
      ownHosts: [...this.own],
      notOracleAddress: NOT_ORACLE_ADDRESS,
      settings: {
        linkPolicy: s.linkPolicy,
        requireEuAi: s.requireEuAi,
        goneInSource: s.goneInSource,
        categories: s.categories,
        clientId: s.clientId ?? null,
        scope: s.scope ?? null,
        keyId: s.keyId ?? null,
        downloadRoute: s.downloadRoute,
        profileFallback: s.profileFallback,
      },
      connection: row
        ? {
            address: row.base_url,
            user: row.principal_name,
            authMode: row.auth_mode,
            tokenUrl: row.token_url,
            enabled: row.enabled,
            enabledAt: row.enabled_at ? new Date(row.enabled_at).toISOString() : null,
            authFailedAt: row.auth_failed_at ? new Date(row.auth_failed_at).toISOString() : null,
            lastTestAt: row.last_test_at ? new Date(row.last_test_at).toISOString() : null,
            lastTestCode: row.last_test_code,
            passwordSaved: Boolean(row.secret_ciphertext),
            passwordSetAt: row.secret_set_at ? new Date(row.secret_set_at).toISOString() : null,
            passwordExpiresOn: row.secret_expires_on,
            clientSecretSaved: Boolean(row.client_secret_ciphertext),
            privateKeySaved: Boolean(row.assertion_key_ciphertext),
            notice: row.notice_attested_at
              ? {
                  by: await name(row.notice_attested_by),
                  at: new Date(row.notice_attested_at).toISOString(),
                  effectiveFrom: row.notice_effective_from,
                }
              : null,
          }
        : null,
    };
  }

  @Get()
  async get() {
    return this.view(await this.conns.row());
  }

  private record(p: Principal, ip: string | undefined, action: string, id: string, after: object) {
    return this.audit.record(this.db, {
      actorId: p.userId,
      actorType: p.actorType,
      sourceIp: ip,
      action,
      entityType: 'integration_connection',
      entityId: id,
      after,
    });
  }

  /** Activate, and on an active connection Replace password (the new one is tested first). */
  @Post('activate')
  @HttpCode(200)
  async activate(
    @Body() body: unknown,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ) {
    const b = parse(
      z.object({
        address: z.string().max(2000).optional(),
        user: z.string().trim().max(200).optional(),
        password: z.string().max(500).optional(),
        notice: z.boolean().optional(),
        noticeEffectiveFrom: DATE,
        passwordExpiresOn: DATE,
      }),
      body ?? {},
    );
    const row = await this.conns.row();
    const active = Boolean(row?.enabled);
    const id = row?.id ?? newId();
    const host = (o: string) => new URL(o).hostname;

    if (active && row) {
      // Replace password: the saved address, user name and tick stand; the new password is tested in memory.
      if (!b.password)
        throw new BadRequestException({ message: 'Type the password.', missing: ['password'] });
      const origin = oracleOrigin(row.base_url, this.own)!;
      const code = await this.conns.client.testCall(
        this.conns.target(row, { origin, user: row.principal_name, password: b.password }),
      );
      if (code === 'ok') {
        await this.db.withTx(async (tx) => {
          await tx.query(
            `UPDATE integration_connection SET secret_ciphertext = $2, secret_hint = '••••••', secret_set_at = now(),
                    secret_expires_on = COALESCE($3::date, secret_expires_on), auth_failed_at = NULL,
                    last_test_at = now(), last_test_code = 'ok', updated_by = $4, updated_at = now()
              WHERE id = $1`,
            [
              id,
              this.crypto.encrypt(b.password!, aadFor(id)),
              b.passwordExpiresOn ?? null,
              p.userId,
            ],
          );
        });
        this.conns.forget(id);
      }
      await this.record(p, req.ip, 'oracle.password_replaced', id, { code, host: host(origin) });
      return { code, enabled: true };
    }

    // A first Activate (or again after Turn off): three values and the tick.
    const keepPassword =
      !b.password &&
      row?.secret_ciphertext &&
      b.address !== undefined &&
      oracleOrigin(b.address, this.own) === oracleOrigin(row.base_url, this.own) &&
      b.user === row.principal_name;
    const missing = [
      !b.address?.trim() && 'address',
      !b.user && 'user',
      !b.password && !keepPassword && 'password',
      b.notice !== true && !(row?.notice_attested_at && keepPassword) && 'notice',
    ].filter(Boolean) as string[];
    if (missing.length) throw new BadRequestException({ message: 'Fill in every field.', missing });
    const origin = oracleOrigin(b.address, this.own);
    if (!origin || !(await resolvesPublic(host(origin), this.conns.client.lookup))) {
      // Nothing is saved; an earlier connection stays as it was.
      await this.record(p, req.ip, 'oracle.activate', id, { code: 'not_oracle_address' });
      return {
        code: 'not_oracle_address' as ActivateCode,
        enabled: false,
        message: NOT_ORACLE_ADDRESS,
      };
    }
    if (row && oracleOrigin(row.base_url, this.own) !== origin) {
      const running = await this.db.query(
        `SELECT 1 FROM import_run WHERE state IN ('queued','running','awaiting_confirm') LIMIT 1`,
      );
      if (running.rowCount) throw refuse('IMPORT_RUNNING');
    }
    // Transaction A: the row, switched off, with the password encrypted and bound to this row.
    await this.db.withTx(async (tx) => {
      await tx.query(
        `INSERT INTO integration_connection (id, system, base_url, principal_name, secret_ciphertext, secret_hint, secret_set_at,
                secret_expires_on, notice_attested_by, notice_attested_at, notice_version, notice_effective_from,
                enabled, auth_failed_at, updated_by)
         VALUES ($1,'oracle_hcm',$2,$3,$4,'••••••',now(),$5,$6,now(),'1',$7,false,NULL,$6)
         ON CONFLICT (system) DO UPDATE SET base_url = EXCLUDED.base_url, principal_name = EXCLUDED.principal_name,
                secret_ciphertext = COALESCE(EXCLUDED.secret_ciphertext, integration_connection.secret_ciphertext),
                secret_set_at = CASE WHEN EXCLUDED.secret_ciphertext IS NULL THEN integration_connection.secret_set_at ELSE now() END,
                secret_expires_on = COALESCE(EXCLUDED.secret_expires_on, integration_connection.secret_expires_on),
                notice_attested_by = CASE WHEN $8 THEN EXCLUDED.notice_attested_by ELSE integration_connection.notice_attested_by END,
                notice_attested_at = CASE WHEN $8 THEN now() ELSE integration_connection.notice_attested_at END,
                notice_effective_from = CASE WHEN $8 THEN EXCLUDED.notice_effective_from ELSE integration_connection.notice_effective_from END,
                enabled = false, auth_failed_at = NULL, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [
          id,
          origin,
          b.user,
          b.password ? this.crypto.encrypt(b.password, aadFor(id)) : null,
          b.passwordExpiresOn ?? null,
          p.userId,
          b.noticeEffectiveFrom ?? null,
          b.notice === true,
        ],
      );
      await this.audit.record(tx, {
        actorId: p.userId,
        actorType: p.actorType,
        sourceIp: req.ip,
        action: 'oracle.connection_saved',
        entityType: 'integration_connection',
        entityId: id,
        after: { host: host(origin), user: b.user, notice: b.notice === true },
      });
    });
    this.conns.forget(id);
    const saved = (await this.conns.row())!;
    // (e) One test call, outside any transaction, with the saved values.
    const code = await this.conns.client.testCall(this.conns.target(saved));
    await this.db.query(
      `UPDATE integration_connection SET last_test_at = now(), last_test_code = $2, enabled = ($2 = 'ok'),
              enabled_at = CASE WHEN $2 = 'ok' THEN now() ELSE enabled_at END,
              auth_failed_at = CASE WHEN $2 = 'ok' THEN NULL ELSE auth_failed_at END
        WHERE id = $1`,
      [saved.id, code],
    );
    await this.record(p, req.ip, 'oracle.activate', saved.id, { code, host: host(origin) });
    return {
      code,
      enabled: code === 'ok',
      ...(code === 'not_oracle_address' ? { message: NOT_ORACLE_ADDRESS } : {}),
    };
  }

  /** Test again: the saved password, at most once every 5 minutes; a refused sign-in switches off. */
  @Post('test')
  @HttpCode(200)
  async test(@CurrentPrincipal() p: Principal, @Req() req: FastifyRequest) {
    const row = await this.conns.row();
    if (!row) throw new ConflictException('Activate first.');
    if (row.last_test_at && Date.now() - new Date(row.last_test_at).getTime() < TEST_EVERY_MS) {
      const left = Math.ceil(
        (TEST_EVERY_MS - (Date.now() - new Date(row.last_test_at).getTime())) / 1000,
      );
      throw refuse('TEST_LIMIT', { secondsLeft: left });
    }
    if (!(await this.conns.client.budgetLeft(row.id))) throw refuse('ORACLE_BUDGET');
    // One shared stop for lookup, import and test while the sign-in circuit is open (S3-INT-14 A10):
    // only Replace password or a new Activate clears it, so a refused password is not tried again.
    if (row.auth_failed_at) throw refuse('ORACLE_AUTH');
    this.conns.forget(row.id);
    const code = await this.conns.client.testCall(this.conns.target(row));
    const r = await this.db.query<{ enabled: boolean }>(
      `UPDATE integration_connection SET last_test_at = now(), last_test_code = $2,
              enabled = CASE WHEN $2 = 'auth_failed' THEN false ELSE enabled END
        WHERE id = $1 RETURNING enabled`,
      [row.id, code],
    );
    await this.record(p, req.ip, 'oracle.test', row.id, {
      code,
      host: new URL(oracleOrigin(row.base_url, this.own) ?? 'https://invalid').hostname,
    });
    return { code, enabled: r.rows[0]!.enabled };
  }

  /**
   * Gap fix: which attachment categories Oracle really uses. For one vacancy number it reads up to
   * 20 applications and lists each category name with how many files carry it, and whether
   * parallax counts it as a CV today. Names and counts only: no file, no applicant.
   */
  @Post('categories')
  @HttpCode(200)
  async categories(
    @Body() body: unknown,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ) {
    const b = parse(
      z.object({
        requisition: z
          .string()
          .trim()
          .min(1)
          .max(64)
          .regex(/^[A-Za-z0-9_.-]+$/),
      }),
      body ?? {},
    );
    const row = await this.conns.row();
    if (!row?.enabled) throw new ConflictException('Activate first.');
    if (row.auth_failed_at) throw refuse('ORACLE_AUTH');
    if (!(await this.conns.client.budgetLeft(row.id))) throw refuse('ORACLE_BUDGET');
    const client = this.conns.client;
    const counted = new Set(this.conns.settings(row).categories.map(categoryKey));
    const seen = new Map<string, number>();
    let apps: Record<string, unknown>[];
    try {
      const req0 = await this.conns.call((t) => client.findRequisition(t, b.requisition));
      if (!req0) {
        await this.record(p, req.ip, 'oracle.categories_checked', row.id, {
          requisition: b.requisition,
          applications: 0,
        });
        return { found: false, applicationsChecked: 0, categories: [] };
      }
      const page = await this.conns.call((t) => client.listApplications(t, req0.id, null));
      apps = page.items.slice(0, CATEGORY_SAMPLE);
      for (const it of apps) {
        const atts = await this.conns.call((t) =>
          client.attachments(t, String(it['JobApplicationId'])),
        );
        for (const a of atts) {
          const name = String(a['CategoryName'] ?? '').trim() || '(none)';
          seen.set(name, (seen.get(name) ?? 0) + 1);
        }
      }
    } catch (e) {
      if (e instanceof AuthCircuitOpen) throw refuse('ORACLE_AUTH');
      if (e instanceof SourceError) {
        if (e.code === 'auth') throw refuse('ORACLE_AUTH');
        if (e.code === 'budget') throw refuse('ORACLE_BUDGET');
        throw refuse('ORACLE_UNAVAILABLE');
      }
      throw e;
    }
    await this.record(p, req.ip, 'oracle.categories_checked', row.id, {
      requisition: b.requisition,
      applications: apps.length,
    });
    return {
      found: true,
      applicationsChecked: apps.length,
      categories: [...seen.entries()]
        .sort((x, y) => y[1] - x[1])
        .map(([name, files]) => ({ name, files, counted: counted.has(categoryKey(name)) })),
    };
  }

  /** Turn off: the import is switched off and every active run is cancelled; CVs already imported stay. */
  @Post('deactivate')
  @HttpCode(200)
  async deactivate(@CurrentPrincipal() p: Principal, @Req() req: FastifyRequest) {
    const row = await this.conns.row();
    if (!row) return { enabled: false, cancelled: 0 };
    let cancelled = 0;
    await this.db.withTx(async (tx) => {
      await tx.query(
        `UPDATE integration_connection SET enabled = false, updated_by = $2, updated_at = now() WHERE id = $1`,
        [row.id, p.userId],
      );
      const runs = await tx.query<{ id: string }>(
        `SELECT id FROM import_run WHERE state IN ('queued','running','awaiting_confirm') FOR UPDATE`,
      );
      for (const r of runs.rows)
        if (await finishRun(tx, r.id, 'cancelled', 'switched_off')) cancelled++;
      await this.audit.record(tx, {
        actorId: p.userId,
        actorType: p.actorType,
        sourceIp: req.ip,
        action: 'oracle.deactivated',
        entityType: 'integration_connection',
        entityId: row.id,
        after: { cancelledRuns: cancelled },
      });
    });
    this.conns.forget(row.id);
    return { enabled: false, cancelled };
  }

  /**
   * The Advanced settings (note 15): no test call, `enabled` untouched, one audit row per changed
   * value with the old and the new value; a secret is recorded only as replaced.
   */
  @Put('settings')
  async settings(
    @Body() body: unknown,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ) {
    const b = parse(
      z.object({
        authMode: z.enum(['basic', 'oauth_client_credentials', 'oauth_jwt_assertion']).optional(),
        tokenUrl: z.string().max(2000).nullable().optional(),
        clientId: z.string().trim().max(500).nullable().optional(),
        clientSecret: z.string().max(2000).optional(),
        scope: z.string().trim().max(500).nullable().optional(),
        keyId: z.string().trim().max(200).nullable().optional(),
        privateKey: z.string().max(10_000).optional(),
        downloadRoute: z.enum(DOWNLOAD_ROUTES).optional(),
        profileFallback: z.boolean().optional(),
        categories: z.array(z.string().trim().min(1).max(100)).min(1).max(20).optional(),
        linkPolicy: z.enum(['open', 'lead_approval']).optional(),
        requireEuAi: z.boolean().optional(),
        goneInSource: z.enum(['flag', 'erase']).optional(),
        passwordExpiresOn: DATE,
        noticeEffectiveFrom: DATE,
      }),
      body ?? {},
    );
    const row = await this.conns.row();
    if (!row) throw new ConflictException('Activate first.');
    if (b.tokenUrl && !oracleOrigin(b.tokenUrl, this.own))
      throw new BadRequestException({ message: NOT_ORACLE_ADDRESS });
    if (b.privateKey && !isRsaPrivateKey(b.privateKey))
      throw new BadRequestException({
        message: 'This is not an RSA private key in PEM form (-----BEGIN PRIVATE KEY-----).',
      });
    const cur = this.conns.settings(row);
    const changes: { field: string; before: unknown; after: unknown }[] = [];
    const next: Partial<OracleSettings> = { ...row.settings };
    for (const k of [
      'linkPolicy',
      'requireEuAi',
      'goneInSource',
      'categories',
      'clientId',
      'scope',
      'keyId',
      'downloadRoute',
      'profileFallback',
    ] as const) {
      if (b[k] === undefined) continue;
      const v = b[k] === null ? undefined : b[k];
      if (JSON.stringify(cur[k]) !== JSON.stringify(v)) {
        changes.push({ field: k, before: cur[k] ?? null, after: v ?? null });
        (next as Record<string, unknown>)[k] = v;
      }
    }
    const cols: string[] = [];
    const vals: unknown[] = [row.id];
    const col = (name: string, before: unknown, after: unknown, value: unknown = after) => {
      if (JSON.stringify(before ?? null) === JSON.stringify(after ?? null)) return;
      vals.push(value);
      cols.push(`${name} = $${vals.length}`);
      changes.push({ field: name, before: before ?? null, after: after ?? null });
    };
    if (b.authMode !== undefined) col('auth_mode', row.auth_mode, b.authMode);
    if (b.tokenUrl !== undefined)
      col(
        'token_url',
        row.token_url,
        b.tokenUrl ? oracleOrigin(b.tokenUrl, this.own) && b.tokenUrl : null,
      );
    if (b.passwordExpiresOn !== undefined)
      col('secret_expires_on', row.secret_expires_on, b.passwordExpiresOn);
    if (b.noticeEffectiveFrom !== undefined)
      col('notice_effective_from', row.notice_effective_from, b.noticeEffectiveFrom);
    if (b.clientSecret) {
      vals.push(this.crypto.encrypt(b.clientSecret, aadFor(row.id, 'client_secret')));
      cols.push(`client_secret_ciphertext = $${vals.length}`);
      changes.push({ field: 'clientSecret', before: null, after: 'replaced' });
    }
    if (b.privateKey) {
      vals.push(this.crypto.encrypt(b.privateKey, aadFor(row.id, 'assertion_key')));
      cols.push(`assertion_key_ciphertext = $${vals.length}`);
      changes.push({ field: 'privateKey', before: null, after: 'replaced' });
    }
    if (!changes.length) return this.view(row);
    await this.db.withTx(async (tx) => {
      vals.push(JSON.stringify(next), p.userId);
      await tx.query(
        `UPDATE integration_connection SET settings = $${vals.length - 1}::jsonb, updated_by = $${vals.length}, updated_at = now()
                ${cols.length ? `, ${cols.join(', ')}` : ''} WHERE id = $1`,
        vals,
      );
      for (const c of changes)
        await this.audit.record(tx, {
          actorId: p.userId,
          actorType: p.actorType,
          sourceIp: req.ip,
          action: 'oracle.setting_changed',
          entityType: 'integration_connection',
          entityId: row.id,
          before: { [c.field]: c.before },
          after: { [c.field]: c.after },
        });
    });
    this.conns.forget(row.id);
    return this.view(await this.conns.row());
  }
}
