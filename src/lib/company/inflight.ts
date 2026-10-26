/**
 * ONE REQUEST PER READER WHILE IT IS IN FLIGHT.
 *
 * The company page renders its employer profile twice at the same moment: as
 * a rail beside the list on a desktop and as an accordion after the third
 * card on a phone (the breakpoint hides one). Both ask the same readers for
 * the same token in the same commit. Sharing the pending promise makes that
 * one request each. Nothing is kept after it settles, so a later visit, a
 * remount or a test with a different answer always asks again: this is a
 * de-duplication of simultaneous asks, never a cache.
 */
const pending = new Map<string, Promise<unknown>>();

export function inflight<T>(key: string, run: () => Promise<T>): Promise<T> {
  const open = pending.get(key);
  if (open) return open as Promise<T>;
  const p = run().finally(() => { pending.delete(key); });
  pending.set(key, p);
  return p;
}
