import { addStats, stalled } from './import-runs';

// Stage 3, S3-OPS-05 (a) and S3-INT-11 (10).
describe('run helpers', () => {
  const ago = (min: number) => new Date(Date.now() - min * 60_000);
  it('marks a stalled run by its state, never a run waiting for the call budget', () => {
    expect(stalled({ state: 'running', progressAt: ago(6), waitReason: null })).toBe(6);
    expect(stalled({ state: 'running', progressAt: ago(4), waitReason: null })).toBeNull();
    expect(
      stalled({
        state: 'queued',
        progressAt: null,
        waitReason: 'oracle_unavailable',
        waitedSince: ago(31),
      }),
    ).toBe(31);
    expect(
      stalled({
        state: 'queued',
        progressAt: null,
        waitReason: 'oracle_unavailable',
        waitedSince: ago(29),
      }),
    ).toBeNull();
    expect(
      stalled({
        state: 'queued',
        progressAt: null,
        waitReason: 'oracle_budget',
        waitedSince: ago(600),
      }),
    ).toBeNull();
    expect(
      stalled({
        state: 'awaiting_confirm',
        progressAt: null,
        waitReason: null,
        awaitingSince: ago(61),
      }),
    ).toBe(61);
    expect(stalled({ state: 'completed', progressAt: ago(600), waitReason: null })).toBeNull();
  });
  it('keeps whole numbers only in the counts', () => {
    expect(addStats({ seen: 1 }, { seen: 2.7, listed: 1 })).toEqual({ seen: 3, listed: 1 });
  });
});
