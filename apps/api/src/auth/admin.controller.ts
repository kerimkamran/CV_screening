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
  Req,
} from '@nestjs/common';
import { newId, ROLES } from '@cv/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { parse, ulidSchema } from '../common/validate';
import { DbService } from '../db/db.service';
import { CurrentPrincipal, Roles } from './decorators';
import type { Principal } from './principal';

const roleSchema = z.enum(ROLES);

/** IAM-03 / IAM-09 groundwork: grant and revoke roles. Every change is audited in the same transaction. */
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  @Get('users')
  async users() {
    const { rows } = await this.db.query(
      `SELECT u.id, u.issuer, u.subject, u.email, u.display_name AS "displayName",
              u.actor_kind AS "actorKind", u.status, u.last_seen_at AS "lastSeenAt",
              COALESCE(c.must_change, false) AS "mustChangePassword",
              COALESCE(array_agg(r.role::text ORDER BY r.role) FILTER (WHERE r.role IS NOT NULL), '{}'::text[]) AS roles
         FROM app_user u
         LEFT JOIN role_assignment r ON r.user_id = u.id AND r.revoked_at IS NULL
         LEFT JOIN local_credential c ON c.user_id = u.id
        WHERE u.issuer <> 'system'
        GROUP BY u.id, c.must_change ORDER BY u.created_at`,
    );
    return rows;
  }

  @Post('users/:userId/roles')
  @HttpCode(201)
  grant(
    @Param('userId') userId: string,
    @Body() body: unknown,
    @CurrentPrincipal() actor: Principal,
    @Req() req: FastifyRequest,
  ) {
    const uid = parse(ulidSchema, userId);
    const { role } = parse(z.object({ role: roleSchema }), body);
    return this.db.withTx(async (tx) => {
      const target = await tx.query<{ actor_kind: string; status: string }>(
        `SELECT actor_kind, status FROM app_user WHERE id = $1 FOR UPDATE`,
        [uid],
      );
      const t = target.rows[0];
      if (!t) throw new NotFoundException();
      if (t.status !== 'active') throw new ConflictException('user is disabled');
      // Least privilege: service accounts hold only SERVICE; humans never hold SERVICE.
      if ((role === 'SERVICE') !== (t.actor_kind === 'service')) {
        throw new BadRequestException(
          'SERVICE role is for service principals only, and only that role',
        );
      }
      const id = newId();
      const ins = await tx.query(
        `INSERT INTO role_assignment (id, user_id, role, granted_by) VALUES ($1,$2,$3,$4)
         ON CONFLICT (user_id, role) WHERE revoked_at IS NULL DO NOTHING`,
        [id, uid, role, actor.userId],
      );
      if (!ins.rowCount) return { userId: uid, role, changed: false };
      await this.audit.record(tx, {
        actorId: actor.userId,
        actorType: actor.actorType,
        actorRole: 'ADMIN',
        sourceIp: req.ip,
        action: 'role.grant',
        entityType: 'role_assignment',
        entityId: id,
        after: { userId: uid, role },
      });
      return { userId: uid, role, changed: true };
    });
  }

  @Delete('users/:userId/roles/:role')
  revoke(
    @Param('userId') userId: string,
    @Param('role') roleParam: string,
    @CurrentPrincipal() actor: Principal,
    @Req() req: FastifyRequest,
  ) {
    const uid = parse(ulidSchema, userId);
    const role = parse(roleSchema, roleParam);
    return this.db.withTx(async (tx) => {
      // Lock the ADMIN set so two concurrent revokes cannot remove the last admin between them.
      await tx.query(`SELECT pg_advisory_xact_lock(hashtext('admin_roles'))`);
      if (role === 'ADMIN') {
        const { rows } = await tx.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM role_assignment WHERE role = 'ADMIN' AND revoked_at IS NULL`,
        );
        if (rows[0]!.n <= 1) throw new ConflictException('cannot revoke the last active ADMIN');
      }
      const upd = await tx.query<{ id: string }>(
        `UPDATE role_assignment SET revoked_at = now(), revoked_by = $3
          WHERE user_id = $1 AND role = $2 AND revoked_at IS NULL RETURNING id`,
        [uid, role, actor.userId],
      );
      const row = upd.rows[0];
      if (!row) throw new NotFoundException();
      await this.audit.record(tx, {
        actorId: actor.userId,
        actorType: actor.actorType,
        actorRole: 'ADMIN',
        sourceIp: req.ip,
        action: 'role.revoke',
        entityType: 'role_assignment',
        entityId: row.id,
        before: { userId: uid, role },
      });
      return { userId: uid, role, changed: true };
    });
  }
}
