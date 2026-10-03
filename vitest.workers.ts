/**
 * HOW MANY TEST WORKERS THIS MACHINE CAN HOLD — SIZED BY MEMORY, NOT CORES.
 *
 * vitest's run-mode default is min(12, cores - 1): seven fork workers on the
 * 8-core, 8 GB machine this suite is pushed from. That was fine while the suite
 * was mostly source-text guards. It is not now: the 2026-10-02 fixes added tests
 * that boot an in-memory Postgres (pglite) or bundle a whole edge function with
 * esbuild, beside the full-page mounts of Jobs.tsx, and each fork holds its own
 * copy.
 *
 * Measured 2026-10-03 with Chrome, Slack, Zoom and Fathom open and 9.2 GB already
 * in swap: at the default seven workers the pre-push gate failed — test files that
 * take seconds took 200-265 s, four cases hit their 30 s budget, and vitest could
 * not start some fork workers at all ("Timeout waiting for worker to respond").
 * At four workers, same machine, same minute: 508 files passed, none timed out.
 * Every failing file passed alone in 1-4 s, so this was memory, not the tests.
 *
 * A gate that fails for want of memory is the same problem as a gate that fails
 * on a flake: it trains the push to skip it. So the worker count follows the
 * memory, one fork per WORKER_BYTES, never more than vitest's own core-based
 * default and never fewer than two.
 */
export const WORKER_BYTES = 2 * 2 ** 30;

export function maxWorkersFor(totalBytes: number, cpus: number): number {
  const byCores = Math.min(12, cpus - 1);
  const byMemory = Math.floor(totalBytes / WORKER_BYTES);
  return Math.max(2, Math.min(byCores, byMemory));
}
