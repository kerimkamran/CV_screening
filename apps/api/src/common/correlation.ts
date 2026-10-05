import { isUlid, newId } from '@cv/shared';
import type { IncomingMessage } from 'node:http';

export const CORRELATION_HEADER = 'x-correlation-id';

/**
 * PLAT-06: every request carries a correlation ID that later spans API → queue → worker →
 * provider call. An inbound ID is honoured only if it is a well-formed ULID; anything else is
 * replaced, so a caller cannot inject arbitrary strings into our logs.
 */
export function requestId(req: IncomingMessage): string {
  const inbound = req.headers[CORRELATION_HEADER];
  const candidate = Array.isArray(inbound) ? inbound[0] : inbound;
  return candidate && isUlid(candidate) ? candidate : newId();
}

/** Candidate PII is never logged; IDs only (§13.8). Redact common carriers defensively. */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];
