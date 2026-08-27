import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyServingFences, type Filterable } from "../../supabase/functions/_shared/mandate-reach.ts";

/**
 * The agent was picking jobs the employer had already taken down.
 *
 * Every surface that shows a posting to a person binds two fences —
 * `missing_since IS NULL` (the employer's feed still lists it) and the 30-day
 * serving window. agent-runner bound NEITHER, at either of its two selection
 * queries, and it is the surface with the highest cost of being wrong: on an
 * auto mandate it does not suggest the job, it APPLIES to it.
 *
 * MEASURED 2026-08-27, replaying the runner's exact predicates against
 * production: 65 of 400 candidates carried a missing_since stamp — 16.2%,
 * stable over three consecutive fetches. Fenced, the query still returns a full
 * 400-row page with those 65 replaced by live postings, so the fence costs no
 * reach at all.
 *
 * Nothing downstream re-checks. apply-broker re-validates the mandate and the
 * entitlement but never re-reads the posting, and apply-agent fetches the
 * fenced detail route under a comment reading "A failure degrades the draft; it
 * never blocks the send". Selection time is the only place this can be fixed.
 */
const runner = readFileSync(
  resolve(__dirname, "../../supabase/functions/agent-runner/index.ts"), "utf8");

/** Comment-stripped, so prose about a query never counts as a query. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

/** Records what a PostgREST builder was asked to do. */
function spy() {
  const calls: Array<[string, string, unknown]> = [];
  const qb: Filterable & { calls: typeof calls } = {
    calls,
    eq(c: string, v: unknown) { calls.push(["eq", c, v]); return this; },
    in(c: string, v: unknown[]) { calls.push(["in", c, v]); return this; },
    gte(c: string, v: unknown) { calls.push(["gte", c, v]); return this; },
    is(c: string, v: unknown) { calls.push(["is", c, v]); return this; },
  };
  return qb;
}

describe("the agent applied to jobs that were gone", () => {
  // EXECUTED, not grepped. This helper lives in _shared precisely so a test can
  // run it: agent-runner imports https:// specifiers, so every test of that file
  // is a regex over source text that can prove a line exists and never what it does.
  it("binds missing_since IS NULL", () => {
    const qb = spy();
    applyServingFences(qb);
    expect(qb.calls).toContainEqual(["is", "missing_since", null]);
  });

  it("binds a 30-day floor on effective_posted, not some other window", () => {
    const now = Date.UTC(2026, 7, 27, 12, 0, 0);
    const qb = spy();
    applyServingFences(qb, now);
    const gte = qb.calls.find(([k, c]) => k === "gte" && c === "effective_posted");
    expect(gte, "no effective_posted floor was bound").toBeDefined();
    const bound = Date.parse(String(gte![2]));
    // 30 days is FRESH_WINDOW_DAYS in job-board. Two definitions of the serving
    // window over one corpus is how two surfaces disagree about one posting.
    expect(bound).toBe(now - 30 * 86_400_000);
  });

  it("returns the same builder so it composes with the other mandate rules", () => {
    const qb = spy();
    expect(applyServingFences(qb)).toBe(qb);
  });

  it("is applied at BOTH selection sites — a partial rollout looks complete", () => {
    // Paired counts, the convention already used for applyCategory/applyMaxAge:
    // an under-count is a query nobody fenced, an over-count is a query nobody
    // has looked at. Tied to the number of corpus reads so adding a third query
    // without fencing it breaks the build.
    const c = code(runner);
    const reads = (c.match(/\.from\("job_board_postings"\)/g) ?? []).length;
    expect(reads, "agent-runner should read the corpus at exactly two sites").toBe(2);
    expect((c.match(/applyServingFences\(/g) ?? []).length,
      "every corpus read in the runner must be fenced").toBe(reads);
  });

  it("does not reach for maxAge as a substitute", () => {
    // applyMaxAge is the subscriber's own opt-in narrowing on posted_at. The
    // serving floor is not optional and is a different column; a mandate with no
    // max age must still be fenced.
    expect(runner).toMatch(/applyMaxAge\(/);
    const c = code(runner);
    expect((c.match(/applyServingFences\(/g) ?? []).length).toBe(2);
  });
});
