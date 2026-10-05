import { SignJWT } from 'jose';

export const LOCAL_ISSUER = 'cv-local';
export const LOCAL_AUDIENCE = 'cv-api';
/** app_user.issuer value for built-in accounts. */
export const LOCAL_IDP = LOCAL_ISSUER;

/** Mint a short-lived HS256 session for a local account (subject = lower-cased email). */
export function signSession(
  email: string,
  secret: string,
  lifetimeSeconds: number,
  sessionVersion: number,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ sv: sessionVersion })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(email.toLowerCase())
    .setIssuer(LOCAL_ISSUER)
    .setAudience(LOCAL_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + lifetimeSeconds)
    .sign(new TextEncoder().encode(secret));
}
