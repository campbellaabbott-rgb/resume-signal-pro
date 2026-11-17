// Rationale: docs/job-board-index-notes.md#n1590-export-type-capclock-now-number-sleep
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
