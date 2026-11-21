import { Injectable } from '@nestjs/common';
import { ROLES, type Role } from '@cv/shared';
import type { Principal } from '../auth/principal';
import { DbService } from '../db/db.service';

/** The person who started (or confirmed) an import can no longer act: the run fails `actor_revoked`. */
export class ActorRevokedError extends Error {
  constructor(reason: string) {
    super(`actor revoked: ${reason}`);
  }
}

/**
 * Stage 3, S3-INT-03 (plan 15.3 note 8): rebuilds the clicking user's Principal from the database for
 * every item, with the checks `DbUserDirectory.resolve` makes, without a token: status active, kind
 * human, no pending password change, roles not revoked; and a recruiting role, because the role guard
 * is not on this path. It reads only: no `last_seen_at`, no first-admin path.
 */
@Injectable()
export class PrincipalLoader {
  constructor(private readonly db: DbService) {}

  async byUserId(userId: string): Promise<Principal> {
    const u = (
      await this.db.query<{
        id: string;
        issuer: string;
        subject: string;
        status: string;
        actor_kind: 'human' | 'service';
        email: string | null;
        display_name: string | null;
        must_change: boolean | null;
      }>(
        `SELECT u.id, u.issuer, u.subject, u.status, u.actor_kind, u.email, u.display_name, c.must_change
           FROM app_user u LEFT JOIN local_credential c ON c.user_id = u.id
          WHERE u.id = $1`,
        [userId],
      )
    ).rows[0];
    if (!u) throw new ActorRevokedError('no such user');
    if (u.status !== 'active') throw new ActorRevokedError('user disabled');
    if (u.actor_kind !== 'human') throw new ActorRevokedError('not a person');
    if (u.must_change) throw new ActorRevokedError('password change pending');
    const granted = await this.db.query<{ role: Role }>(
      `SELECT role FROM role_assignment WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
    const active = new Set(granted.rows.map((r) => r.role));
    const roles = ROLES.filter((r) => active.has(r));
    if (!roles.includes('TA_PARTNER') && !roles.includes('TA_LEAD'))
      throw new ActorRevokedError('no recruiting role');
    return {
      userId: u.id,
      subject: u.subject,
      issuer: u.issuer,
      actorType: 'human',
      roles,
      email: u.email,
      displayName: u.display_name,
    };
  }
}
