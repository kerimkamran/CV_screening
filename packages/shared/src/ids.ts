import { monotonicFactory } from 'ulid';

/**
 * INTG-01: stable, sortable, non-sequential, never-reused external identifiers.
 * Every vacancy, candidate and decision is addressed by a ULID. The database stores it as the
 * `ulid` domain (CHAR(26), Crockford base32) so malformed IDs cannot be persisted.
 */
export type Ulid = string & { readonly __brand: 'Ulid' };

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const generate = monotonicFactory();

export function newId(seedTime?: number): Ulid {
  return generate(seedTime) as Ulid;
}

export function isUlid(value: unknown): value is Ulid {
  return typeof value === 'string' && ULID_RE.test(value);
}
