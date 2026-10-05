import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { AuditService } from '../audit/audit.service';
import { DbService } from '../db/db.service';
import { ANY_AUTHENTICATED_KEY, PUBLIC_KEY, ROLES_KEY } from './decorators';
import { REQUEST_PRINCIPAL, type Principal } from './principal';
import { TokenVerifier } from './token-verifier';
import { USER_DIRECTORY, type UserDirectory } from './user-directory';
import type { Role } from '@cv/shared';

const attach = (req: FastifyRequest, p: Principal) =>
  ((req as unknown as Record<string, Principal>)[REQUEST_PRINCIPAL] = p);

/** Default-deny authentication, registered globally. */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly log = new Logger('auth');

  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: TokenVerifier,
    @Inject(USER_DIRECTORY) private readonly directory: UserDirectory,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()])) {
      return true;
    }
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    if (!token) return this.deny(req, 'missing bearer token');
    try {
      attach(req, await this.directory.resolve(await this.verifier.verify(token)));
      return true;
    } catch {
      return this.deny(req, 'token rejected');
    }
  }

  // The token itself is never logged.
  private deny(req: FastifyRequest, reason: string): never {
    this.log.warn({ reason, method: req.method, resource: req.url.split('?')[0], reqId: req.id });
    throw new UnauthorizedException();
  }
}

/**
 * RBAC, registered after AuthGuard. An authenticated user with no granted role is refused
 * everywhere except endpoints marked @AnyAuthenticated (IAM-03). Denials are logged and, because
 * the principal is known, written to the audit trail with the resource.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  private readonly log = new Logger('rbac');

  constructor(
    private readonly reflector: Reflector,
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const principal = (req as unknown as Record<string, Principal>)[REQUEST_PRINCIPAL]!;
    const anyAuth = this.reflector.getAllAndOverride<boolean>(ANY_AUTHENTICATED_KEY, targets);
    // A user holding a generated password may do nothing but change it.
    if (principal.mustChangePassword && !anyAuth) {
      throw new ForbiddenException({
        message: 'Password change required',
        code: 'PASSWORD_CHANGE_REQUIRED',
      });
    }
    if (anyAuth) return true;
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    const allowed = required?.length
      ? principal.roles.some((r) => required.includes(r))
      : principal.roles.length > 0;
    if (allowed) return true;

    const resource = req.url.split('?')[0]!;
    this.log.warn({ userId: principal.userId, method: req.method, resource, reqId: req.id });
    await this.audit
      .record(this.db, {
        actorId: principal.userId,
        actorType: principal.actorType,
        sourceIp: req.ip,
        action: 'access.denied',
        entityType: 'route',
        entityId: principal.userId,
        after: { method: req.method, resource, required: required ?? 'any-role' },
      })
      .catch((e: unknown) => this.log.error(`audit write failed: ${(e as Error).message}`));
    throw new ForbiddenException();
  }
}
