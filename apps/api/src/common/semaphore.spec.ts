import { Semaphore } from './semaphore';

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('Semaphore', () => {
  it('never lets more than its size run at once', async () => {
    const s = new Semaphore(3);
    let live = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 10 }, () =>
        s.run(async () => {
          live++;
          peak = Math.max(peak, live);
          await tick();
          live--;
        }),
      ),
    );
    expect(peak).toBe(3);
    expect(s.inUse).toBe(0);
  });

  it('a request for every permit waits for the others and is not starved by later ones', async () => {
    const s = new Semaphore(3);
    const order: string[] = [];
    const a = s.run(async () => {
      order.push('a');
      await tick();
    });
    const zip = s.run(async () => {
      order.push('zip');
      await tick();
    }, 3);
    const b = s.run(async () => {
      order.push('b');
    });
    await Promise.all([a, zip, b]);
    expect(order).toEqual(['a', 'zip', 'b']);
  });

  it('release is idempotent', async () => {
    const s = new Semaphore(1);
    const r = await s.acquire();
    r();
    r();
    expect(s.inUse).toBe(0);
    const r2 = await s.acquire();
    expect(s.inUse).toBe(1);
    r2();
  });
});
