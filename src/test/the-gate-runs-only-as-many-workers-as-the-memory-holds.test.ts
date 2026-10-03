// @vitest-environment node
/**
 * THE GATE RUNS ONLY AS MANY WORKERS AS THE MEMORY HOLDS.
 *
 * On 2026-10-03 the pre-push gate failed on an 8-core, 8 GB machine with 9.2 GB in
 * swap: at vitest's default of seven fork workers, files that take seconds took
 * 200-265 s and some workers never started. At four workers it passed. The rule
 * and its measurement live in vitest.workers.ts; this pins both the rule and that
 * the config actually uses it.
 */
import { describe, expect, it } from "vitest";
import os from "node:os";
import { maxWorkersFor, WORKER_BYTES } from "../../vitest.workers";
import config from "../../vitest.config";

const GB = 2 ** 30;

describe("the worker count follows memory, capped by vitest's core default", () => {
  it("gives the 8-core, 8 GB machine four workers, not the seven that failed", () => {
    expect(maxWorkersFor(8 * GB, 8)).toBe(4);
  });

  it("never exceeds the core-based default on a machine with memory to spare", () => {
    expect(maxWorkersFor(64 * GB, 8)).toBe(7);
    expect(maxWorkersFor(256 * GB, 32)).toBe(12);
  });

  it("matches a typical CI runner (4 vCPU, 16 GB) to the default it already used", () => {
    expect(maxWorkersFor(16 * GB, 4)).toBe(3);
  });

  it("never drops below two, however small the machine", () => {
    expect(maxWorkersFor(2 * GB, 2)).toBe(2);
    expect(maxWorkersFor(1 * GB, 1)).toBe(2);
  });

  it("budgets two gigabytes per fork", () => {
    expect(WORKER_BYTES).toBe(2 * GB);
  });
});

describe("the config uses the rule", () => {
  it("sets maxWorkers from this machine's memory and cores", () => {
    const cfg = config as unknown as { test?: { maxWorkers?: number } };
    const cpus = os.availableParallelism?.() ?? os.cpus().length;
    expect(cfg.test?.maxWorkers, "vitest.config.ts no longer caps workers by memory")
      .toBe(maxWorkersFor(os.totalmem(), cpus));
  });
});
