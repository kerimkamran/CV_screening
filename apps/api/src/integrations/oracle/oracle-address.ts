import { isIP } from 'node:net';
import { isBlockedAddress } from '../../pipeline/link-reader';

/**
 * Stage 3, S3-INT-07 (plan 15.3 note 2): the pasted-address rule, as pure functions ported from the
 * probe (`scripts/oracle-probe.mjs`). It runs when the admin saves the address, and again every
 * time the client reads the stored one, so a row changed by hand is caught. The public-address check
 * runs on the address really connected to, through `lookup` (replaceable: a made-up
 * `*.oraclecloud.com` name has no DNS record in a test).
 */
export const ORACLE_HOST_SUFFIX = '.oraclecloud.com';
export const ORACLE_EXAMPLE_ADDRESS = 'https://xxxx.fa.em2.oraclecloud.com';

const isOracleCloudHost = (hostname: string) =>
  /^[a-z0-9-]+(\.[a-z0-9-]+)*\.oraclecloud\.com$/.test(hostname.toLowerCase());

/** A host name as `ORACLE_OWN_HOSTS` may list it: letters, digits, hyphens and dots, no IP. */
export const OWN_HOST_PATTERN = /^(?=.{4,253}$)[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/**
 * Gap fix (custom domain): Azerconnect may reach Oracle through its own domain. Such a host is
 * allowed only when the operator lists it in `ORACLE_OWN_HOSTS` on the server (exact names, no
 * wildcard), never from the admin form, so a stolen admin session cannot send the password elsewhere.
 * Every other rule (https, port 443, no IP, public address) still applies.
 */
export function ownHosts(value: string | undefined): ReadonlySet<string> {
  return new Set(
    (value ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter((h) => OWN_HOST_PATTERN.test(h) && !isIP(h)),
  );
}

const NONE: ReadonlySet<string> = new Set();

/** Trims a pasted text (a full REST link is fine) to its origin, or null when it is not an address. */
export function normaliseAddress(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let text = input.trim();
  if (!text) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  return url.origin;
}

/**
 * https only, on the standard port, no user name or password, the host ends in `.oraclecloud.com`
 * or is one of the operator's own Oracle hosts (`own`).
 */
export function isAllowedAddress(url: string | URL, own: ReadonlySet<string> = NONE): boolean {
  let parsed: URL;
  try {
    parsed = url instanceof URL ? url : new URL(String(url));
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.port !== '') return false; // a URL drops ":443", so anything left is another port
  if (parsed.username !== '' || parsed.password !== '') return false;
  if (isIP(parsed.hostname.replace(/^\[|\]$/g, ''))) return false;
  const host = parsed.hostname.toLowerCase();
  return isOracleCloudHost(host) || own.has(host);
}

/** The rule as one call: the origin to save, or null ("not an Oracle address"). No network call. */
export function oracleOrigin(input: unknown, own: ReadonlySet<string> = NONE): string | null {
  const origin = normaliseAddress(input);
  return origin && isAllowedAddress(origin, own) ? origin : null;
}

export type Lookup = (host: string) => Promise<string[]>;

/** True when every address the host resolves to is public (none private, loopback or link-local). */
export async function resolvesPublic(host: string, lookup: Lookup): Promise<boolean> {
  let addrs: string[];
  try {
    addrs = await lookup(host);
  } catch {
    return false;
  }
  return addrs.length > 0 && addrs.every((a) => !isBlockedAddress(a));
}
