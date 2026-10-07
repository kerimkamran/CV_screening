import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { SettingsCrypto } from '../ai/settings-crypto';
import { AuditService } from '../audit/audit.service';
import { parse } from '../common/validate';
import { DbService } from '../db/db.service';
import { AnyAuthenticated, CurrentPrincipal } from './decorators';
import { verifyPassword } from './password';
import type { Principal } from './principal';
import { newRecoveryCodes, newSecret, otpauthUri, verifyTotp } from './totp';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const codeSchema = z.object({ code: z.string().min(6).max(32) });

/** Two-step sign-in with an authenticator app (TOTP). Optional per account; the setup is the user's own. */
@AnyAuthenticated()
@Controller('auth/mfa')
export class MfaController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly crypto: SettingsCrypto,
  ) {}

  @Get()
  async status(@CurrentPrincipal() p: Principal) {
    const { rows } = await this.db.query<{ on: boolean; codes: number }>(
      `SELECT totp_secret IS NOT NULL AS on, cardinality(recovery_hashes) AS codes
         FROM local_credential WHERE user_id = $1`,
      [p.userId],
    );
    return {
      enabled: rows[0]?.on ?? false,
      recoveryCodesLeft: rows[0]?.codes ?? 0,
      available: Boolean(rows[0]),
    };
  }

  /** Starts enrolment: a fresh secret, not active until a code from the app proves it works. */
  @Post('setup')
  @HttpCode(200)
  async setup(@CurrentPrincipal() p: Principal) {
    const st = await this.status(p);
    if (!st.available)
      throw new BadRequestException(
        'Two-step sign-in is for accounts that sign in with a password here',
      );
    if (st.enabled) throw new ConflictException('Two-step sign-in is already on');
    const secret = newSecret();
    await this.db.query(`UPDATE local_credential SET totp_pending = $2 WHERE user_id = $1`, [
      p.userId,
      this.crypto.encrypt(secret, `totp:${p.userId}`),
    ]);
    return { secret, uri: otpauthUri(secret, p.email ?? p.userId) };
  }

  @Post('enable')
  @HttpCode(200)
  async enable(
    @Body() body: unknown,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ) {
    const { code } = parse(codeSchema, body);
    return this.db.withTx(async (tx) => {
      const { rows } = await tx.query<{ totp_pending: string | null }>(
        `SELECT totp_pending FROM local_credential WHERE user_id = $1 FOR UPDATE`,
        [p.userId],
      );
      const pending = rows[0]?.totp_pending;
      if (!pending) throw new BadRequestException('Start the setup first');
      const secret = this.crypto.decrypt(pending, `totp:${p.userId}`);
      const step = verifyTotp(secret, code, null);
      if (step === null)
        throw new BadRequestException(
          'That code is not right. Check the time on your phone and try again.',
        );
      const recovery = newRecoveryCodes();
      await tx.query(
        `UPDATE local_credential SET totp_secret = totp_pending, totp_pending = NULL, totp_enabled_at = now(),
                totp_last_step = $2, recovery_hashes = $3::text[]
          WHERE user_id = $1`,
        [p.userId, step, recovery.map((c) => sha256(c))],
      );
      await this.audit.record(tx, {
        actorId: p.userId,
        actorType: p.actorType,
        sourceIp: req.ip,
        action: 'auth.mfa_enabled',
        entityType: 'app_user',
        entityId: p.userId,
      });
      // Shown once; only hashes are kept.
      return { enabled: true, recoveryCodes: recovery };
    });
  }

  @Post('disable')
  @HttpCode(200)
  async disable(
    @Body() body: unknown,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ) {
    const { password } = parse(z.object({ password: z.string().min(1).max(256) }), body);
    return this.db.withTx(async (tx) => {
      const { rows } = await tx.query<{ password_hash: string }>(
        `SELECT password_hash FROM local_credential WHERE user_id = $1 FOR UPDATE`,
        [p.userId],
      );
      if (!rows[0] || !(await verifyPassword(password, rows[0].password_hash)))
        throw new UnauthorizedException('Password is incorrect');
      await tx.query(
        `UPDATE local_credential SET totp_secret = NULL, totp_pending = NULL, totp_enabled_at = NULL,
                totp_last_step = NULL, recovery_hashes = '{}' WHERE user_id = $1`,
        [p.userId],
      );
      await this.audit.record(tx, {
        actorId: p.userId,
        actorType: p.actorType,
        sourceIp: req.ip,
        action: 'auth.mfa_disabled',
        entityType: 'app_user',
        entityId: p.userId,
      });
      return { enabled: false };
    });
  }
}
