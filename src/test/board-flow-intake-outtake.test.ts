import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE BOARD COULD NOT ANSWER "HOW MANY JOBS DID WE ADD TODAY?"
 *
 * Every count on the serving path caps at 10,000 for a filtered query, so
 * asking the API for postings added in the last DAY and in the last WEEK both
 * returned the literal 10,000 — the cap, not a measurement. So there was no way
 * to see whether intake was keeping up with the 30-day expiry, which is the one
 * number that separates "stable" from "quietly draining". Observed totals over
 * a day sat between 594,826 and 600,413: flat within noise, and flat and
 * shrinking-slowly look identical from outside without this.
 *
 * THE FIRST ATTEMPT WAS WRONG AND SHIPPED. It inferred outtake from rows that
 * had crossed the 30-day edge and were still present — but such rows are
 * PRUNED: only 3,092 older than 30 days exist in the whole table. It reported
 * net +55,863/day against a board total flat at ~597,000, which is how it was
 * caught: the metric contradicted the board's own headline number.
 *
 * Outtake now comes from job_board_closures, where the event is RECORDED when
 * it happens rather than inferred from an absence. `superseded` separates a
 * re-list (identical title still live at the same employer) from a role
 * actually going away — counting those together would overstate how much
 * hiring stopped.
 */
const ROOT = resolve(__dirname, "../..");
const MIG = (() => {
  const dir = resolve(ROOT, "supabase/migrations");
  // The CORRECTED definition supersedes the first one. Reading the original
  // would pin the shape this file exists to say was wrong.
  const f = readdirSync(dir).find((n) => n.includes("outtake_must_come_from_the_closure_log"));
  return f ? readFileSync(resolve(dir, f), "utf8") : "";
})();
const FN = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");

describe("the board can count its own intake and outtake", () => {
  it("ships the migration", () => {
    expect(MIG, "intake/outtake migration not found").not.toBe("");
    expect(MIG).toMatch(/CREATE OR REPLACE FUNCTION public\.get_board_flow/);
  });

  it("takes OUTTAKE from the closure log, never from a row's absence", () => {
    // THE BUG THIS REPLACED. The first version counted rows whose
    // effective_posted had crossed the 30-day edge and were still present. But
    // such rows are PRUNED: only 3,092 older than 30 days exist in the whole
    // table. So it counted stragglers from an emptied pool and reported
    // net +55,863/day against a board total that was flat at ~597,000.
    //
    // A departure cannot be inferred from the absence of a row when the row is
    // what gets removed. The event must be recorded when it happens — and it
    // already was, in job_board_closures since 2026-07-14.
    expect(MIG).toMatch(/FROM public\.job_board_closures/);
    expect(MIG).toMatch(/WHERE closed_at >=/);
    expect(MIG).toMatch(/closed bigint/);
  });

  it("separates a re-list from a role actually going away", () => {
    // `superseded` marks a posting that came down while an identical title
    // stayed live at the same employer. Counting those as closures would
    // overstate how much hiring stopped.
    expect(MIG).toMatch(/superseded bigint/);
    expect(MIG).toMatch(/count\(\*\) FILTER \(WHERE superseded\)/);
  });

  it("does not resurrect aged_out", () => {
    // There is no honest version: a row leaving the window is pruned in the
    // same pass that logs its closure, so it is already inside `closed`. A
    // second, nearly-always-zero field would only invite the misreading again.
    // Asserted against the RETURNS TABLE, not the file text — the migration's
    // own comment necessarily names the field it is retracting.
    const returns = /RETURNS TABLE \([\s\S]*?\)\s*\nLANGUAGE/.exec(MIG)?.[0] ?? "";
    expect(returns, "RETURNS TABLE not found").not.toBe("");
    expect(returns).not.toMatch(/aged_out/);
    expect(returns).not.toMatch(/takedown/);
  });

  it("indexes closed_at on its own", () => {
    // The existing index is (company_token, closed_at DESC) — wrong leading
    // column for a bare time range, so the count would seq-scan a log that
    // only grows.
    expect(MIG).toMatch(/job_board_closures_closed_at_idx/);
  });

  it("reads the private log through aggregates only", () => {
    // job_board_closures is not anon-readable and must stay that way — it is
    // the one asset here nobody can reproduce. SECURITY DEFINER with a pinned
    // search_path, returning counts and never a row.
    expect(MIG).toMatch(/SECURITY DEFINER/);
    expect(MIG).toMatch(/SET search_path = public/);
    expect(MIG).not.toMatch(/SELECT \*\s+FROM public\.job_board_closures/);
  });

  it("reports the serving total as the denominator", () => {
    // A net of +400 is meaningless without the size it moves.
    expect(MIG).toMatch(/serving bigint/);
  });

  it("bounds the window and its own runtime", () => {
    // p_hours is caller-supplied and reaches an interval, so it is clamped.
    expect(MIG).toMatch(/GREATEST\(1, LEAST\(COALESCE\(p_hours, 24\), 720\)\)/);
    // Three counts over ~600k rows; without a statement timeout a slow day
    // becomes a stuck connection.
    expect(MIG).toMatch(/SET statement_timeout = '15s'/);
  });

  it("still ships the postings-side index intake depends on", () => {
    // first_seen is still the intake column, and its index lives in the FIRST
    // migration — which is superseded for the FUNCTION but not for its indexes.
    // Asserted across both files so dropping either is caught.
    const dir = resolve(ROOT, "supabase/migrations");
    const all = readdirSync(dir)
      .filter((n) => n.includes("count_its_own_intake") || n.includes("outtake_must_come_from"))
      .map((n) => readFileSync(resolve(dir, n), "utf8"))
      .join("\n");
    expect(all).toMatch(/job_board_postings_first_seen_idx/);
  });

  it("is exposed on status, deadlined, and omitted rather than zeroed", () => {
    expect(FN).toMatch(/rpc\("get_board_flow"/);
    // Deadlined like the other analytics RPCs — status must keep answering
    // "did the deploy land?" even when an aggregate is slow.
    // [\d_]+ not \d+ — the codebase writes numeric separators (3_000), and the
    // first draft of this assertion failed on its own correct code because of it.
    expect(/withDeadline\(client\.rpc\("get_board_flow"[\s\S]{0,60}?,\s*[\d_]+\)/.test(FN)).toBe(true);
    // AND THE DEADLINE MUST CLEAR THE MEASURED RUNTIME. 3_000 shipped against
    // an RPC measured at 2.64/2.80/2.78s, so the field was null on every call —
    // a metric that is always absent is the same as one that does not exist.
    const ms = Number(
      (/withDeadline\(client\.rpc\("get_board_flow"[\s\S]{0,80}?,\s*([\d_]+)\)/.exec(FN)?.[1] ?? "0")
        .replace(/_/g, ""),
    );
    expect(ms, "deadline must leave real headroom over the ~2.8s observed runtime")
      .toBeGreaterThanOrEqual(6000);
    // Null, never 0. "0 intake" on a board taking thousands is a false alarm,
    // and a false alarm teaches people to ignore the real one.
    const block = /boardFlow: \(\(\) => \{[\s\S]{0,400}?\}\)\(\)/.exec(FN)?.[0] ?? "";
    expect(block, "boardFlow status field not found").not.toBe("");
    expect(block.includes("return row && typeof row === \"object\" ? row : null;")).toBe(true);
  });
});
