/**
 * W4-17 (board .103): A CAP ON ONE VENDOR'S DETAIL READS.
 *
 * The description sweep runs DESC_SWEEP_CONCURRENCY (8) wide whatever the
 * vendor, so a hop of SmartRecruiters rows opened eight posting reads at once,
 * back to back. A cap admits a call only while fewer than `concurrent` are in
 * flight and fewer than `perSecond` started in the last second, in the order
 * they asked; the rest wait their turn. Per isolate. Pure but for the clock,
 * so vitest walks it on a virtual one.
 */
export type CapClock = { now: () => number; sleep: (ms: number) => Promise<void> };

export function rateCap(
  o: { concurrent: number; perSecond: number },
  clock: CapClock = { now: Date.now, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const starts: number[] = [];
  let wake: (() => void) | null = null;
  let turn: Promise<void> = Promise.resolve();
  const admit = async () => {
    while (active >= o.concurrent) await new Promise<void>((r) => { wake = r; });
    for (;;) {
      const t = clock.now();
      while (starts.length && t - starts[0] >= 1_000) starts.shift();
      if (starts.length < o.perSecond) { starts.push(t); active++; return; }
      await clock.sleep(1_000 - (t - starts[0]));
    }
  };
  return async (fn) => {
    const mine = turn.then(admit);
    turn = mine;
    await mine;
    try {
      return await fn();
    } finally {
      active--;
      const w = wake;
      wake = null;
      w?.();
    }
  };
}
