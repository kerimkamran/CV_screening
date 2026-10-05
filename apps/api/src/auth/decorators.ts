import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Role } from '@cv/shared';
import { REQUEST_PRINCIPAL, type Principal } from './principal';

export const PUBLIC_KEY = 'isPublic';
export const ANY_AUTHENTICATED_KEY = 'anyAuthenticated';
export const ROLES_KEY = 'roles';

/** No authentication. Only the health probes use this. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
/** Any signed-in user, even one with no roles (e.g. `/me`). */
export const AnyAuthenticated = () => SetMetadata(ANY_AUTHENTICATED_KEY, true);
/** At least one of these roles. An endpoint with no decorator needs at least one role of any kind. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentPrincipal = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<Record<string, Principal>>();
  return req[REQUEST_PRINCIPAL];
});
