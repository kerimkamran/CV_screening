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

/**
 * A download link carries its single-use token in the path (S2-BE8): request logs show the path
 * without it. Everything else about the request line is kept.
 */
export const redactUrl = (url: string | undefined) =>
  (url ?? '').replace(/\/downloads\/[^/?#]+/g, '/downloads/[token]');

/** The request as it is logged: method, path (redacted), host and remote address only. */
export function requestLog(req: {
  method?: string;
  url?: string;
  hostname?: string;
  ip?: string;
  socket?: { remotePort?: number };
}) {
  return {
    method: req.method,
    url: redactUrl(req.url),
    hostname: req.hostname,
    remoteAddress: req.ip,
    remotePort: req.socket?.remotePort,
  };
}

/** Candidate PII is never logged; IDs only (§13.8). Redact common carriers defensively. */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];
