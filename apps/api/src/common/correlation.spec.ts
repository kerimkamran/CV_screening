import { newId } from '@cv/shared';
import type { IncomingMessage } from 'node:http';
import { CORRELATION_HEADER, requestId } from './correlation';

const req = (headers: Record<string, string | string[] | undefined>) =>
  ({ headers }) as unknown as IncomingMessage;

describe('requestId (PLAT-06)', () => {
  it('honours a well-formed inbound ULID', () => {
    const id = newId();
    expect(requestId(req({ [CORRELATION_HEADER]: id }))).toBe(id);
  });

  it('replaces a malformed inbound value so logs cannot be injected', () => {
    const out = requestId(req({ [CORRELATION_HEADER]: 'x\nfake-log-line' }));
    expect(out).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('generates an ID when none is supplied and takes the first of repeated headers', () => {
    expect(requestId(req({}))).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    const id = newId();
    expect(requestId(req({ [CORRELATION_HEADER]: [id, 'other'] }))).toBe(id);
  });
});
