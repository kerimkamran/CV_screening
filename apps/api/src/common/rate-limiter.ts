/** Fixed-window, in-memory, per-key limiter. Enough for one instance; replace with Redis if we scale out. */
export class RateLimiter {
  private readonly hits = new Map<string, { n: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** True if the call is allowed. */
  take(key: string): boolean {
    const t = this.now();
    if (this.hits.size > 10_000) {
      for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k);
    }
    const cur = this.hits.get(key);
    if (!cur || cur.resetAt <= t) {
      this.hits.set(key, { n: 1, resetAt: t + this.windowMs });
      return true;
    }
    cur.n++;
    return cur.n <= this.limit;
  }
}
