/**
 * A small counting semaphore (Stage 2, S2-OPS6). Waiters are served in order, so a ZIP that asks
 * for every permit is not starved by a stream of single files behind it.
 */
export class Semaphore {
  private free: number;
  private readonly waiters: { n: number; go: () => void }[] = [];

  constructor(readonly size: number) {
    this.free = size;
  }

  /** Wait for `n` permits (at most `size`). Returns a release function; call it exactly once. */
  async acquire(n = 1): Promise<() => void> {
    const need = Math.min(Math.max(1, n), this.size);
    if (this.free >= need && this.waiters.length === 0) {
      this.free -= need;
    } else {
      await new Promise<void>((go) => this.waiters.push({ n: need, go }));
    }
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.free += need;
      this.drain();
    };
  }

  /** Run `fn` while holding `n` permits. */
  async run<T>(fn: () => Promise<T>, n = 1): Promise<T> {
    const release = await this.acquire(n);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  get inUse(): number {
    return this.size - this.free;
  }
  get waiting(): number {
    return this.waiters.length;
  }

  private drain() {
    while (this.waiters.length && this.free >= this.waiters[0]!.n) {
      const w = this.waiters.shift()!;
      this.free -= w.n;
      w.go();
    }
  }
}
