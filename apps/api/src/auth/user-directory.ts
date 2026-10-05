import { Inject, Injectable } from '@nestjs/common';
import { newId, ROLES, type Role } from '@cv/shared';
import { AuditService } from '../audit/audit.service';
import { ENV, type Env } from '../config/env';
import { DbService } from '../db/db.service';
import { LOCAL_IDP } from './local-session';
import { AuthError } from './token-verifier';
import type { Principal, TokenIdentity } from './principal';

export const USER_DIRECTORY = Symbol('USER_DIRECTORY');

export interface UserDirectory {
  resolve(identity: TokenIdentity): Promise<Principal>;
}

/**
 * IAM-03. Maps a verified token identity to an application user and its granted roles.
 * First sign-in provisions the user with NO roles, so a new user can see nothing until an
 * admin grants access.
 */
@Injectable()
export class DbUserDirectory implements UserDirectory {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  resolve(identity: TokenIdentity): Promise<Principal> {
    return this.db.withTx(async (tx) => {
      type UserRow = {
        id: string;
        status: string;
        actor_kind: string;
        stale: boolean;
        email: string | null;
        display_name: string | null;
      };
      const find = () =>
        tx.query<UserRow>(
          `SELECT id, status, actor_kind, email, display_name,
                  last_seen_at < now() - interval '1 minute' AS stale
             FROM app_user WHERE issuer = $1 AND subject = $2`,
          [identity.issuer, identity.subject],
        );
      let found = await find();
      if (!found.rowCount) {
        // First sign-in: provision with NO roles. DO NOTHING + re-select handles a concurrent first sign-in.
        await tx.query(
          `INSERT INTO app_user (id, issuer, subject, actor_kind) VALUES ($1,$2,$3,$4)
           ON CONFLICT (issuer, subject) DO NOTHING`,
          [newId(), identity.issuer, identity.subject, identity.actorType],
        );
        found = await find();
      }
      const user = found.rows[0]!;
      // Touch last_seen_at at most once a minute so reads don't become row writes.
      if (user.stale)
        await tx.query(`UPDATE app_user SET last_seen_at = now() WHERE id = $1`, [user.id]);
      if (user.status !== 'active') throw new AuthError('user disabled');
      // The stored kind is authoritative: a human identity presenting an app-only token (or the
      // reverse) is refused rather than silently re-classified.
      if (user.actor_kind !== identity.actorType) throw new AuthError('actor kind mismatch');

      // Built-in accounts: a password change or reset ends every earlier session, and a user who
      // has not yet chosen their own password is flagged so the guard confines them to that step.
      let mustChangePassword: boolean | undefined;
      if (identity.issuer === LOCAL_IDP) {
        const cred = await tx.query<{ must_change: boolean; session_version: number }>(
          `SELECT must_change, session_version FROM local_credential WHERE user_id = $1`,
          [user.id],
        );
        const c = cred.rows[0];
        if (!c || c.session_version !== identity.sessionVersion) {
          throw new AuthError('session superseded');
        }
        mustChangePassword = c.must_change;
      }

      await this.maybeBootstrapAdmin(tx, user.id, identity);

      const granted = await tx.query<{ role: Role }>(
        `SELECT role FROM role_assignment WHERE user_id = $1 AND revoked_at IS NULL`,
        [user.id],
      );
      const active = new Set(granted.rows.map((r) => r.role));
      return {
        userId: user.id,
        subject: identity.subject,
        issuer: identity.issuer,
        actorType: identity.actorType,
        roles: ROLES.filter((r) => active.has(r)),
        email: user.email,
        displayName: user.display_name,
        ...(mustChangePassword !== undefined ? { mustChangePassword } : {}),
      };
    });
  }

  private async maybeBootstrapAdmin(
    tx: import('pg').PoolClient,
    userId: string,
    identity: TokenIdentity,
  ) {
    if (identity.subject !== this.env.BOOTSTRAP_ADMIN_SUBJECT || identity.actorType !== 'human') {
      return;
    }
    // Serialise so two simultaneous first sign-ins cannot both bootstrap.
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext('bootstrap_admin'))`);
    const existing = await tx.query(
      `SELECT 1 FROM role_assignment WHERE role = 'ADMIN' AND revoked_at IS NULL LIMIT 1`,
    );
    if (existing.rowCount) return;
    const id = newId();
    await tx.query(
      `INSERT INTO role_assignment (id, user_id, role, granted_by) VALUES ($1,$2,'ADMIN',$2)`,
      [id, userId],
    );
    await this.audit.record(tx, {
      actorId: userId,
      actorType: 'human',
      action: 'role.bootstrap',
      entityType: 'role_assignment',
      entityId: id,
      after: { userId, role: 'ADMIN' },
    });
  }
}
