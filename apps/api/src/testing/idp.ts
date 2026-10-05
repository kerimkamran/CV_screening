import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTVerifyGetKey,
  type KeyLike,
} from 'jose';

export interface SignOptions {
  claims?: Record<string, unknown>;
  iss?: string;
  aud?: string;
  /** Token lifetime in seconds (default 300). */
  lifetime?: number;
  /** Absolute exp, overriding lifetime (may be in the past). */
  exp?: number;
  signWithUnknownKey?: boolean;
}

/** A throwaway IdP: generates a key pair, exposes it as a JWKS resolver, and signs test tokens. */
export async function createTestIdp(issuer: string, audience: string) {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const unknown: KeyLike = (await generateKeyPair('RS256')).privateKey;
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const resolver: JWTVerifyGetKey = createLocalJWKSet({ keys: [jwk] });

  const sign = (subject: string, o: SignOptions = {}) => {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ ...(o.claims ?? {}) })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setSubject(subject)
      .setIssuer(o.iss ?? issuer)
      .setAudience(o.aud ?? audience)
      .setIssuedAt(now)
      .setExpirationTime(o.exp ?? now + (o.lifetime ?? 300))
      .sign(o.signWithUnknownKey ? unknown : privateKey);
  };
  return { resolver, sign };
}
