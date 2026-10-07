import {
  BadRequestException,
  HttpException,
  HttpStatus,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { newId, type Role } from '@cv/shared';
import type { PoolClient } from 'pg';
import { AuditService } from '../audit/audit.service';
import { RateLimiter } from '../common/rate-limiter';
import { ENV, type Env } from '../config/env';
import { DbService } from '../db/db.service';
import { BRAND_FULL, BRAND_NAME } from '../brand';
import { SettingsCrypto } from '../ai/settings-crypto';
import { EmailService } from './email.service';
import { LOCAL_IDP, signSession } from './local-session';
import {
  DUMMY_HASH,
  generatePassword,
  hashPassword,
  passwordProblem,
  verifyPassword,
} from './password';
import type { Principal } from './principal';
import { verifyTotp } from './totp';

const MAX_FAILURES = 5;
/** Per-IP brake on top of the per-account lockout, so one address cannot spray many accounts. */
const ipLimiter = new RateLimiter(30, 60_000);
const LOCK_MINUTES = 15;
const BAD_CREDENTIALS = 'Invalid email or password';
/** How long an invitation / password-setup link stays usable. It also works only once. */
export const SETUP_LINK_HOURS = 72;
const INVALID_LINK = 'This link is invalid or has expired. Ask your administrator for a new one.';
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

export interface SessionResult {
  token: string;
  expiresIn: number;
  mustChangePassword: boolean;
}

/** A one-time link that lets its holder choose their own password. Shown to the admin once. */
export interface SetupLink {
  /** The secret part. The browser builds the link from its own address: `/#/set-password?token=…`. */
  setupToken: string;
  /** The same link on APP_BASE_URL, when that is configured (this is what the email carries). */
  setupLink?: string;
  expiresAt: string;
}

export interface CredentialsResult extends SetupLink {
  user: { id: string; email: string; displayName: string };
  emailSent: boolean;
}

@Injectable()
export class LocalAuthService {
  private readonly log = new Logger('local-auth');

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly mail: EmailService,
    private readonly crypto: SettingsCrypto,
    @Inject(ENV) private readonly env: Env,
  ) {}

  assertLocal() {
    if (this.env.AUTH_MODE !== 'local') throw new NotFoundException();
  }

  private session(email: string, mustChange: boolean, sv: number): Promise<SessionResult> {
    const ttl = Math.min(this.env.LOCAL_SESSION_SECONDS, this.env.MAX_TOKEN_LIFETIME_SECONDS);
    return signSession(email, this.env.SESSION_SECRET!, ttl, sv).then((token) => ({
      token,
      expiresIn: ttl,
      mustChangePassword: mustChange,
    }));
  }

  async login(
    emailRaw: string,
    password: string,
    ip?: string,
    code?: string,
  ): Promise<SessionResult> {
    this.assertLocal();
    if (ip && !ipLimiter.take(ip)) {
      throw new HttpException(
        'Too many attempts. Try again in a minute.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const email = emailRaw.trim().toLowerCase();
    // The tx returns an outcome instead of throwing so a failed attempt's counter COMMITS.
    const outcome = await this.db.withTx(async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        status: string;
        password_hash: string;
        must_change: boolean;
        session_version: number;
        failed_attempts: number;
        locked: boolean;
        totp_secret: string | null;
        totp_last_step: string | null;
        recovery_hashes: string[];
      }>(
        `SELECT u.id, u.status, c.password_hash, c.must_change, c.session_version, c.failed_attempts,
                COALESCE(c.locked_until > now(), false) AS locked,
                c.totp_secret, c.totp_last_step, c.recovery_hashes
           FROM app_user u JOIN local_credential c ON c.user_id = u.id
          WHERE u.issuer = $1 AND lower(u.email) = $2
          FOR UPDATE OF c`,
        [LOCAL_IDP, email],
      );
      const u = rows[0];
      // Always pay the hashing cost so timing does not reveal whether the account exists.
      const ok = await verifyPassword(password, u?.password_hash ?? DUMMY_HASH);
      if (!u) {
        this.log.warn({ msg: 'login failed: unknown account', ip });
        return { ok: false as const };
      }
      if (u.locked || u.status !== 'active') {
        this.log.warn({ msg: 'login refused: locked or disabled', userId: u.id, ip });
        return { ok: false as const };
      }
      // Second step. A missing code is a prompt, not a failure; a wrong one counts like a wrong password.
      let secondOk = true;
      let usedStep: number | null = null;
      let usedRecovery: string | null = null;
      if (ok && u.totp_secret) {
        if (!code?.trim()) return { ok: false as const, mfa: true as const };
        const secret = this.crypto.decrypt(u.totp_secret, `totp:${u.id}`);
        usedStep = verifyTotp(
          secret,
          code,
          u.totp_last_step === null ? null : Number(u.totp_last_step),
        );
        if (usedStep === null) {
          const h = sha256(code.trim().toLowerCase());
          usedRecovery = u.recovery_hashes.includes(h) ? h : null;
        }
        secondOk = usedStep !== null || usedRecovery !== null;
      }
      if (!ok || !secondOk) {
        const failures = u.failed_attempts + 1;
        const lock = failures >= MAX_FAILURES;
        await tx.query(
          `UPDATE local_credential SET failed_attempts = $2,
                  locked_until = CASE WHEN $3::boolean THEN now() + make_interval(mins => $4::int) ELSE locked_until END
            WHERE user_id = $1`,
          [u.id, lock ? 0 : failures, lock, LOCK_MINUTES],
        );
        await this.audit.record(tx, {
          actorId: u.id,
          actorType: 'human',
          sourceIp: ip,
          action: lock ? 'auth.locked' : 'auth.login_failed',
          entityType: 'app_user',
          entityId: u.id,
        });
        return { ok: false as const };
      }
      await tx.query(
        `UPDATE local_credential SET failed_attempts = 0, locked_until = NULL,
                totp_last_step = COALESCE($2::bigint, totp_last_step),
                recovery_hashes = CASE WHEN $3::text IS NULL THEN recovery_hashes ELSE array_remove(recovery_hashes, $3::text) END
          WHERE user_id = $1`,
        [u.id, usedStep, usedRecovery],
      );
      if (usedRecovery) {
        await this.audit.record(tx, {
          actorId: u.id,
          actorType: 'human',
          sourceIp: ip,
          action: 'auth.mfa_recovery_used',
          entityType: 'app_user',
          entityId: u.id,
        });
      }
      await this.audit.record(tx, {
        actorId: u.id,
        actorType: 'human',
        sourceIp: ip,
        action: 'auth.login',
        entityType: 'app_user',
        entityId: u.id,
      });
      return { ok: true as const, mustChange: u.must_change, sv: u.session_version };
    });
    if (!outcome.ok) {
      if ('mfa' in outcome && outcome.mfa) {
        throw new UnauthorizedException({
          message: 'Enter the 6-digit code from your authenticator app',
          code: 'mfa_required',
        });
      }
      throw new UnauthorizedException(
        code?.trim() ? 'Invalid email, password or code' : BAD_CREDENTIALS,
      );
    }
    return this.session(email, outcome.mustChange, outcome.sv);
  }

  /** Same user, fresh expiry. The old token is not revoked (stateless) but is short-lived. */
  async refresh(p: Principal): Promise<SessionResult> {
    this.assertLocal();
    const { rows } = await this.db.query<{ session_version: number }>(
      `SELECT session_version FROM local_credential WHERE user_id = $1`,
      [p.userId],
    );
    return this.session(p.email!, Boolean(p.mustChangePassword), rows[0]!.session_version);
  }

  async changePassword(
    p: Principal,
    current: string,
    next: string,
    ip?: string,
  ): Promise<SessionResult> {
    this.assertLocal();
    const problem = passwordProblem(next, p.email!);
    if (problem) throw new BadRequestException(`New password ${problem}`);
    if (next === current)
      throw new BadRequestException('New password must differ from the old one');
    const sv = await this.db.withTx(async (tx) => {
      const { rows } = await tx.query<{ password_hash: string }>(
        `SELECT password_hash FROM local_credential WHERE user_id = $1 FOR UPDATE`,
        [p.userId],
      );
      if (!rows[0] || !(await verifyPassword(current, rows[0].password_hash))) {
        throw new UnauthorizedException('Current password is incorrect');
      }
      const upd = await tx.query<{ session_version: number }>(
        `UPDATE local_credential SET password_hash = $2, must_change = false,
                password_changed_at = now(), session_version = session_version + 1,
                failed_attempts = 0, locked_until = NULL
          WHERE user_id = $1 RETURNING session_version`,
        [p.userId, await hashPassword(next)],
      );
      await this.audit.record(tx, {
        actorId: p.userId,
        actorType: 'human',
        sourceIp: ip,
        action: 'auth.password_changed',
        entityType: 'app_user',
        entityId: p.userId,
      });
      return upd.rows[0]!.session_version;
    });
    // Fresh session: the change just invalidated the one the caller presented.
    return this.session(p.email!, false, sv);
  }

  // ---------------------------------------------------------------- admin: accounts

  async createUser(
    actor: Principal,
    input: { email: string; displayName: string; role: Role | 'NONE' },
    ip?: string,
  ): Promise<CredentialsResult> {
    this.assertLocal();
    if (input.role === 'SERVICE') throw new BadRequestException('SERVICE is not a human role');
    const email = input.email.trim().toLowerCase();
    const password = generatePassword();
    const hash = await hashPassword(password);
    const made = await this.db.withTx(async (tx) => {
      const dup = await tx.query(`SELECT 1 FROM app_user WHERE lower(email) = $1`, [email]);
      if (dup.rowCount) throw new ConflictException('An account with this email already exists');
      const id = newId();
      await tx.query(
        `INSERT INTO app_user (id, issuer, subject, actor_kind, email, display_name)
         VALUES ($1,$2,$3,'human',$3,$4)`,
        [id, LOCAL_IDP, email, input.displayName.trim()],
      );
      // `subject` is the lower-cased email so a session token maps straight back to the row.
      await tx.query(`INSERT INTO local_credential (user_id, password_hash) VALUES ($1,$2)`, [
        id,
        hash,
      ]);
      if (input.role !== 'NONE') await this.grant(tx, id, input.role, actor.userId);
      await this.audit.record(tx, {
        actorId: actor.userId,
        actorType: actor.actorType,
        actorRole: 'ADMIN',
        sourceIp: ip,
        action: 'user.create',
        entityType: 'app_user',
        entityId: id,
        after: { email, role: input.role }, // never the password
      });
      return { id, link: await this.newSetupLink(tx, id, actor.userId) };
    });
    return this.deliver(made.id, email, input.displayName.trim(), password, 'welcome', made.link);
  }

  async resetPassword(actor: Principal, userId: string, ip?: string): Promise<CredentialsResult> {
    this.assertLocal();
    const password = generatePassword();
    const hash = await hashPassword(password);
    const who = await this.db.withTx(async (tx) => {
      const { rows } = await tx.query<{ email: string; display_name: string }>(
        `SELECT u.email, u.display_name FROM app_user u
          JOIN local_credential c ON c.user_id = u.id WHERE u.id = $1 FOR UPDATE OF c`,
        [userId],
      );
      if (!rows[0]) throw new NotFoundException();
      await tx.query(
        `UPDATE local_credential SET password_hash = $2, must_change = true,
                password_changed_at = now(), session_version = session_version + 1,
                failed_attempts = 0, locked_until = NULL
          WHERE user_id = $1`,
        [userId, hash],
      );
      await this.audit.record(tx, {
        actorId: actor.userId,
        actorType: actor.actorType,
        actorRole: 'ADMIN',
        sourceIp: ip,
        action: 'user.password_reset',
        entityType: 'app_user',
        entityId: userId,
      });
      return { ...rows[0], link: await this.newSetupLink(tx, userId, actor.userId) };
    });
    return this.deliver(userId, who.email, who.display_name, password, 'reset', who.link);
  }

  /** A fresh invitation / password-setup link for any built-in account. Older unused links stop working. */
  async issueSetupLink(
    actor: Principal,
    userId: string,
    ip?: string,
  ): Promise<SetupLink & { user: { id: string; email: string; displayName: string } }> {
    this.assertLocal();
    return this.db.withTx(async (tx) => {
      const { rows } = await tx.query<{ email: string; display_name: string; status: string }>(
        `SELECT u.email, u.display_name, u.status FROM app_user u
          JOIN local_credential c ON c.user_id = u.id WHERE u.id = $1 FOR UPDATE OF c`,
        [userId],
      );
      const u = rows[0];
      if (!u) throw new NotFoundException();
      if (u.status !== 'active') throw new ConflictException('user is disabled');
      const link = await this.newSetupLink(tx, userId, actor.userId);
      await this.audit.record(tx, {
        actorId: actor.userId,
        actorType: actor.actorType,
        actorRole: 'ADMIN',
        sourceIp: ip,
        action: 'user.setup_link',
        entityType: 'app_user',
        entityId: userId, // never the token
      });
      return { user: { id: userId, email: u.email, displayName: u.display_name }, ...link };
    });
  }

  // ---------------------------------------------------------------- public: open a setup link

  /** Who the link is for, so the page can say so before asking for a password. */
  async inspectSetupLink(
    token: string,
    ip?: string,
  ): Promise<{ email: string; displayName: string }> {
    this.assertLocal();
    this.throttle(ip);
    const { rows } = await this.db.query<{ email: string; display_name: string; status: string }>(
      `SELECT u.email, u.display_name, u.status
         FROM password_setup s JOIN app_user u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.used_at IS NULL AND s.expires_at > now()`,
      [sha256(token)],
    );
    const r = rows[0];
    if (!r || r.status !== 'active') throw new BadRequestException(INVALID_LINK);
    return { email: r.email, displayName: r.display_name };
  }

  /** Redeems the link: sets the password the holder chose, burns the link and signs them in. */
  async completeSetup(token: string, newPassword: string, ip?: string): Promise<SessionResult> {
    this.assertLocal();
    this.throttle(ip);
    const out = await this.db.withTx(async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        user_id: string;
        email: string;
        status: string;
      }>(
        `SELECT s.id, s.user_id, u.email, u.status
           FROM password_setup s
           JOIN app_user u ON u.id = s.user_id
           JOIN local_credential c ON c.user_id = u.id
          WHERE s.token_hash = $1 AND s.used_at IS NULL AND s.expires_at > now()
          FOR UPDATE OF s, c`,
        [sha256(token)],
      );
      const r = rows[0];
      if (!r || r.status !== 'active') throw new BadRequestException(INVALID_LINK);
      const problem = passwordProblem(newPassword, r.email);
      if (problem) throw new BadRequestException(`New password ${problem}`);
      const upd = await tx.query<{ session_version: number }>(
        `UPDATE local_credential SET password_hash = $2, must_change = false,
                password_changed_at = now(), session_version = session_version + 1,
                failed_attempts = 0, locked_until = NULL
          WHERE user_id = $1 RETURNING session_version`,
        [r.user_id, await hashPassword(newPassword)],
      );
      await tx.query(`UPDATE password_setup SET used_at = now() WHERE id = $1`, [r.id]);
      await this.audit.record(tx, {
        actorId: r.user_id,
        actorType: 'human',
        sourceIp: ip,
        action: 'auth.password_set_via_link',
        entityType: 'app_user',
        entityId: r.user_id,
      });
      return { email: r.email, sv: upd.rows[0]!.session_version };
    });
    return this.session(out.email, false, out.sv);
  }

  private throttle(ip?: string) {
    if (ip && !ipLimiter.take(ip)) {
      throw new HttpException(
        'Too many attempts. Try again in a minute.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** New one-time token for the user; any earlier unused link is withdrawn. Only the hash is kept. */
  private async newSetupLink(tx: PoolClient, userId: string, by: string): Promise<SetupLink> {
    const token = randomBytes(32).toString('base64url');
    const expires = new Date(Date.now() + SETUP_LINK_HOURS * 3_600_000);
    await tx.query(`DELETE FROM password_setup WHERE user_id = $1 AND used_at IS NULL`, [userId]);
    await tx.query(
      `INSERT INTO password_setup (id, user_id, token_hash, expires_at, created_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [newId(), userId, sha256(token), expires, by],
    );
    const base = this.env.APP_BASE_URL?.replace(/\/+$/, '');
    return {
      setupToken: token,
      ...(base ? { setupLink: `${base}/#/set-password?token=${token}` } : {}),
      expiresAt: expires.toISOString(),
    };
  }

  async setStatus(actor: Principal, userId: string, status: 'active' | 'disabled', ip?: string) {
    this.assertLocal();
    if (userId === actor.userId && status === 'disabled') {
      throw new BadRequestException('You cannot disable your own account');
    }
    return this.db.withTx(async (tx) => {
      await tx.query(`SELECT pg_advisory_xact_lock(hashtext('admin_roles'))`);
      if (status === 'disabled') {
        // Disabling must not leave the system with no usable administrator.
        const { rows } = await tx.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM role_assignment r JOIN app_user u ON u.id = r.user_id
            WHERE r.role = 'ADMIN' AND r.revoked_at IS NULL AND u.status = 'active' AND u.id <> $1`,
          [userId],
        );
        const target = await tx.query<{ is_admin: boolean }>(
          `SELECT EXISTS (SELECT 1 FROM role_assignment WHERE user_id = $1 AND role = 'ADMIN' AND revoked_at IS NULL) AS is_admin`,
          [userId],
        );
        if (target.rows[0]?.is_admin && rows[0]!.n < 1) {
          throw new ConflictException('Cannot disable the last active ADMIN');
        }
      }
      const upd = await tx.query(`UPDATE app_user SET status = $2 WHERE id = $1`, [userId, status]);
      if (!upd.rowCount) throw new NotFoundException();
      await this.audit.record(tx, {
        actorId: actor.userId,
        actorType: actor.actorType,
        actorRole: 'ADMIN',
        sourceIp: ip,
        action: status === 'disabled' ? 'user.disable' : 'user.enable',
        entityType: 'app_user',
        entityId: userId,
      });
      return { userId, status };
    });
  }

  // ---------------------------------------------------------------- boot-time admin

  /** Creates the first ADMIN from env, once, only while no active ADMIN exists. */
  async bootstrapAdmin(): Promise<void> {
    const { BOOTSTRAP_ADMIN_EMAIL: email, BOOTSTRAP_ADMIN_PASSWORD: pw } = this.env;
    if (this.env.AUTH_MODE !== 'local' || !email || !pw) return;
    const hash = await hashPassword(pw);
    await this.db.withTx(async (tx) => {
      await tx.query(`SELECT pg_advisory_xact_lock(hashtext('admin_roles'))`);
      const existing = await tx.query(
        `SELECT 1 FROM role_assignment WHERE role = 'ADMIN' AND revoked_at IS NULL LIMIT 1`,
      );
      if (existing.rowCount) return;
      const e = email.toLowerCase();
      const id = newId();
      await tx.query(
        `INSERT INTO app_user (id, issuer, subject, actor_kind, email, display_name)
         VALUES ($1,$2,$3,'human',$3,'Administrator') ON CONFLICT (issuer, subject) DO NOTHING`,
        [id, LOCAL_IDP, e],
      );
      const { rows } = await tx.query<{ id: string }>(
        `SELECT id FROM app_user WHERE issuer = $1 AND subject = $2`,
        [LOCAL_IDP, e],
      );
      const uid = rows[0]!.id;
      await tx.query(
        `INSERT INTO local_credential (user_id, password_hash) VALUES ($1,$2)
         ON CONFLICT (user_id) DO UPDATE SET password_hash = $2, must_change = true,
                password_changed_at = now(), session_version = local_credential.session_version + 1`,
        [uid, hash],
      );
      await tx.query(`UPDATE app_user SET status = 'active' WHERE id = $1`, [uid]);
      await this.grant(tx, uid, 'ADMIN', uid);
      await this.audit.record(tx, {
        actorId: uid,
        actorType: 'human',
        action: 'role.bootstrap',
        entityType: 'app_user',
        entityId: uid,
        after: { email: e, role: 'ADMIN' },
      });
      this.log.log(`bootstrap admin created: ${e} (must change password at first sign-in)`);
    });
  }

  // ---------------------------------------------------------------- helpers

  private async grant(tx: PoolClient, userId: string, role: Role, by: string) {
    const id = newId();
    await tx.query(
      `INSERT INTO role_assignment (id, user_id, role, granted_by) VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id, role) WHERE revoked_at IS NULL DO NOTHING`,
      [id, userId, role, by],
    );
  }

  private async deliver(
    id: string,
    email: string,
    displayName: string,
    password: string,
    kind: 'welcome' | 'reset',
    setup: SetupLink,
  ): Promise<CredentialsResult> {
    const link = this.env.APP_BASE_URL ?? '(ask your administrator for the address)';
    const text = [
      `Hello ${displayName},`,
      '',
      kind === 'welcome'
        ? `An account has been created for you on ${BRAND_FULL}.`
        : `Your password on ${BRAND_FULL} has been reset.`,
      '',
      `Sign in:   ${link}`,
      `Email:     ${email}`,
      `Password:  ${password}`,
      '',
      'This password is temporary. You will be asked to choose your own the first time you sign in.',
      ...(setup.setupLink
        ? [
            '',
            `Or choose your own password right away with this one-time link (valid ${SETUP_LINK_HOURS} hours):`,
            setup.setupLink,
          ]
        : []),
      '',
      'Do not forward this message. If you did not expect it, tell your administrator.',
    ].join('\n');
    const emailSent = await this.mail.send({
      to: email,
      subject:
        kind === 'welcome' ? `Your ${BRAND_NAME} account` : `Your ${BRAND_NAME} password was reset`,
      text,
    });
    // When the email did not go out, the admin copies the link instead of a password.
    return { user: { id, email, displayName }, emailSent, ...setup };
  }
}
