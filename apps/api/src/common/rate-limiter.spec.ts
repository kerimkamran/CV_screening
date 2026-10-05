import { RateLimiter } from './rate-limiter';

describe('RateLimiter', () => {
  it('allows up to the limit per key per window, then resets', () => {
    let t = 0;
    const rl = new RateLimiter(3, 1000, () => t);
    expect([1, 2, 3, 4].map(() => rl.take('a'))).toEqual([true, true, true, false]);
    expect(rl.take('b')).toBe(true); // other keys unaffected
    t = 1001;
    expect(rl.take('a')).toBe(true);
  });
});
