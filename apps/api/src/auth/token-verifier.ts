import { Inject, Injectable } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { ENV, type Env } from '../config/env';
import { LOCAL_AUDIENCE, LOCAL_ISSUER } from './local-session';
import type { TokenIdentity } from './principal';

export const KEY_RESOLVER = Symbol('KEY_RESOLVER');

export class AuthError extends Error {}

/** Production key resolver: remote JWKS, cached and rotated by `jose`. Unused in local mode. */
export const jwksResolverFactory = {
  provide: KEY_RESOLVER,
  inject: [ENV],
  useFactory: (env: Env): JWTVerifyGetKey =>
    env.AUTH_MODE === 'oidc' && env.OIDC_JWKS_URI
      ? createRemoteJWKSet(new URL(env.OIDC_JWKS_URI))
      : () => Promise.reject(new AuthError('no JWKS configured')),
};

@Injectable()
export class TokenVerifier {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(KEY_RESOLVER) private readonly keys: JWTVerifyGetKey,
  ) {}

  async verify(token: string): Promise<TokenIdentity> {
    const local = this.env.AUTH_MODE === 'local';
    const issuer = local ? LOCAL_ISSUER : this.env.OIDC_ISSUER!;
    let payload: JWTPayload;
    try {
      const common = {
        issuer,
        audience: local ? LOCAL_AUDIENCE : this.env.OIDC_AUDIENCE!,
        clockTolerance: 30,
        requiredClaims: ['sub', 'exp', 'iat'],
      };
      ({ payload } = local
        ? await jwtVerify(token, new TextEncoder().encode(this.env.SESSION_SECRET!), {
            ...common,
            algorithms: ['HS256'],
          })
        : await jwtVerify(token, this.keys, {
            ...common,
            // Asymmetric only: rejects `none` and HMAC-with-public-key confusion.
            algorithms: ['RS256', 'ES256'],
          }));
    } catch {
      // One generic failure; the reason (expired, bad signature…) is not leaked to the caller.
      throw new AuthError('invalid token');
    }
    // IAM-06: bounded credential lifetime.
    if (payload.exp! - payload.iat! > this.env.MAX_TOKEN_LIFETIME_SECONDS) {
      throw new AuthError('token lifetime exceeds policy');
    }
    return toIdentity(payload, issuer);
  }
}

export function toIdentity(payload: JWTPayload, issuer: string): TokenIdentity {
  // Entra ID marks client-credentials (app-only) tokens with idtyp=app. The application role
  // set is NOT read from the token; see UserDirectory.
  return {
    subject: String(payload.sub),
    issuer,
    actorType: payload['idtyp'] === 'app' ? 'service' : 'human',
    sessionVersion: typeof payload['sv'] === 'number' ? payload['sv'] : undefined,
  };
}
