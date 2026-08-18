import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE FILTER AUDIT SPENT A DAY REPORTING ITS OWN THROTTLING AS FILTER FAILURES.
 *
 * 2026-08-17: filterAudit was red all day — clean:false, 3 findings — and every
 * finding was kind "request-failed" carrying "RateLimitError ... for trace":
 * the GATEWAY refusing the audit's own 4-wide unpaced burst of self-calls,
 * recorded as though the board's filters were broken. A guardrail that is red
 * every day trains everyone to ignore the day it is right — and this guardrail
 * is the one that catches filters lying to users (it found four real defects
 * that 1,010 green unit tests missed).
 *
 * Three legs, pinned here: probes retry once on 429 with a CAPPED Retry-After
 * (a lying header must not stall the audit); the burst is paced; and a
 * residual 429 is classified `throttled`, never `request-failed` — "could not
 * measure" and "measured broken" must be different alarms.
 */
const FN = readFileSync(
  resolve(__dirname, "../../supabase/functions/job-board/index.ts"),
  "utf8",
);

describe("the filter audit distinguishes throttling from breakage", () => {
  it("retries once on 429, honouring Retry-After with a hard cap", () => {
    const probe = FN.slice(FN.indexOf("const probe = async (payload"), FN.indexOf("const cutoff", FN.indexOf("const probe = async (payload")));
    expect(probe).toMatch(/if \(res\.status === 429\)/);
    expect(probe).toMatch(/retry-after/);
    // Cap present: Math.min(..., 5_000). Without it a hostile/buggy header
    // parks the audit for its whole budget.
    expect(probe).toMatch(/Math\.min\(.*5_000\)/);
    expect(probe).toMatch(/throttled: res\.status === 429/);
  });

  it("paces the burst instead of hammering its own gateway", () => {
    const batches = FN.slice(FN.indexOf("const inBatches"), FN.indexOf("const BATCH") + 40);
    expect(batches).toMatch(/setTimeout\(r, 500\)/);
    expect(batches).toMatch(/const BATCH = 2;/);
  });

  it("classifies a residual 429 as throttled at EVERY probe-failure site", () => {
    // All probe-failure findings must carry the ternary; a single site left as
    // a bare "request-failed" reintroduces the false alarm through that case.
    const ternary = (FN.match(/kind: r\.throttled \? "throttled" : "request-failed"/g) ?? []).length;
    const bare = (FN.match(/kind: "request-failed"/g) ?? []).length;
    expect(ternary).toBeGreaterThanOrEqual(3);
    expect(bare, "a probe-failure site bypasses the throttled classification").toBe(0);
  });

  it("surfaces the throttle count, and clean still requires a finished audit", () => {
    expect(FN).toMatch(/throttledCases: findings\.filter\(\(f\) => f\.kind === "throttled"\)\.length,/);
    // Throttled findings still make clean:false — the audit did not finish,
    // and an unfinished audit must never read as a green one.
    expect(FN).toMatch(/clean: findings\.length === 0,/);
  });
});
