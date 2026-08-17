import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE BOARD'S GROWTH NUMBER WAS WRONG THREE TIMES IN ONE DAY, ALWAYS UPWARD.
 *
 * Every count on the serving path caps at 10,000 for a filtered query, so asking
 * the API for postings added in the last DAY and the last WEEK both returned the
 * literal 10,000 — the cap, not a measurement. There was no way to see whether
 * intake was keeping up with the 30-day expiry, which is the one number that
 * separates "stable" from "quietly draining".
 *
 *   v1  inferred outtake from rows still sitting past the 30-day edge. Such rows
 *       are PRUNED, so it counted stragglers from an emptied pool and reported
 *       net +55,863/day against a board flat at ~597,000.
 *   v2  took outtake from job_board_closures — a real event log, correctly
 *       recorded when the event happens. STILL WRONG: `net = intake - closed`
 *       treats `closed` as total outflow when it is deliberately a narrow subset.
 *       Measured in production 2026-08-17 20:20-20:34Z: sampling `serving`
 *       every 60s for 13.9 minutes, the pool moved 572,690 -> 572,997 (+1,326
 *       /hour) while net claimed +7,689/hour — a 5.8x contradiction against a
 *       number returned in the SAME ROW.
 *   v3  stops inferring. Growth is sampled from the pool and differenced.
 *
 * The v2 migration comment asserted "a row that leaves the window is pruned in
 * the same pass that logs its closure, so it is already counted in `closed`".
 * The ingest code says the opposite in a comment sitting directly above the
 * closure gate: "(b) age-outs are skipped". THIS FILE'S JOB is to make sure that
 * contradiction cannot be reintroduced — the arithmetic and the ingest rules
 * are asserted against each other, not just against themselves.
 */
const ROOT = resolve(__dirname, "../..");
const migration = (needle: string) => {
  const dir = resolve(ROOT, "supabase/migrations");
  const f = readdirSync(dir).find((n) => n.includes(needle));
  return f ? readFileSync(resolve(dir, f), "utf8") : "";
};
// The CORRECTED definition supersedes both earlier ones. Reading an older file
// would pin a shape this test exists to say was wrong.
const MIG = migration("flow_must_be_observed_not_inferred");
const FN = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");

describe("the board's growth number is observed, not inferred", () => {
  it("ships the migration", () => {
    expect(MIG, "observed-flow migration not found").not.toBe("");
    expect(MIG).toMatch(/CREATE OR REPLACE FUNCTION public\.get_board_flow/);
  });

  it("does not publish an inferred `net` at all", () => {
    // THE DEFECT, TWICE. `intake - closed` is not a growth rate: `closed` counts
    // only roles an EMPLOYER took down. Publishing the subtraction invites the
    // reading that broke this metric both times.
    const returns = /RETURNS TABLE \([\s\S]*?\)\s*\nLANGUAGE/.exec(MIG)?.[0] ?? "";
    expect(returns, "RETURNS TABLE not found").not.toBe("");
    expect(returns).not.toMatch(/\bnet\b/);
    expect(returns).not.toMatch(/aged_out/);
    expect(returns).not.toMatch(/takedown/);
    // And the body must not compute it under another name.
    expect(MIG).not.toMatch(/v_intake\s*-\s*v_closed/);
  });

  it("differences a real sample instead", () => {
    expect(MIG).toMatch(/CREATE TABLE IF NOT EXISTS public\.job_board_pool_samples/);
    expect(MIG).toMatch(/serving_delta bigint/);
    expect(MIG).toMatch(/FROM public\.job_board_pool_samples/);
  });

  it("reaches BACKWARD for the window-start sample, never forward", () => {
    // A sample taken after the window start would shorten the window silently
    // and inflate the rate — the same shape of error as v1 and v2.
    const block = MIG.slice(MIG.indexOf("SELECT s.serving INTO v_prev"));
    expect(block).toMatch(/WHERE s\.sampled_at <= since/);
    expect(block).toMatch(/ORDER BY s\.sampled_at DESC/);
  });

  it("returns NULL, never 0, when growth is not yet measurable", () => {
    // Samples have to accrue before a difference exists. A 0 would read as
    // "flat board" — a false alarm, and false alarms teach people to ignore the
    // real one.
    expect(MIG).toMatch(/CASE WHEN v_prev IS NULL THEN NULL ELSE v_now - v_prev END/);
  });

  it("defines `serving` exactly ONCE, and both sides call it", () => {
    // The shortcut was to sample the ingest pass's existing facets total. That
    // is count(*) over the RAW table (583,876 when checked) while `serving` is
    // the 30-day servable subset (572,946 at the same moment) — differencing one
    // against the other rebuilds the bug out of a mismatch instead of an
    // inference. So the predicate lives in one function.
    expect(MIG).toMatch(/CREATE OR REPLACE FUNCTION public\.board_serving_count/);
    const preds = MIG.match(/effective_posted >= now\(\) - interval '30 days'/g) ?? [];
    expect(preds.length, "the serving predicate must be spelled out exactly once").toBe(1);
    expect(MIG).toMatch(/v_now := public\.board_serving_count\(\)/);
    expect(MIG).toMatch(/v_serving := public\.board_serving_count\(\)/);
  });

  it("keeps `closed` as the narrow honest subset, and adds the full outflow", () => {
    // `closed` is still the right number for hiring-health — it just is not
    // total outflow. `departed` is every logged exit, whatever the reason.
    expect(MIG).toMatch(/closed bigint/);
    expect(MIG).toMatch(/superseded bigint/);
    expect(MIG).toMatch(/departed bigint/);
    expect(MIG).toMatch(/FROM public\.job_board_exits/);
    expect(MIG).toMatch(/WHERE exited_at >= since/);
    // NAMED reasons, never count(*) over the raw ledger — published-claims.ts
    // holds that invariant because the ledger mixes observed age with learned
    // age, and blending them manufactures evidence from our own late knowledge.
    expect(MIG).toMatch(/AND exit_reason IN \('removed', 'aged_out', 'backdated', 'board_dormant', 'untracked'\)/);
  });

  it("says which basis `serving` came from", () => {
    // v2 counted 572k rows live on every call: 2.6-4.0s warm, 7.9s cold against
    // an 8,000ms deadline — a cold call was within 77ms of returning null.
    expect(MIG).toMatch(/serving_basis text/);
    expect(MIG).toMatch(/v_basis := 'sample'/);
    expect(MIG).toMatch(/v_basis := 'live'/);
  });

  it("does not let anon write the series the public number is differenced from", () => {
    expect(MIG).toMatch(/REVOKE ALL ON FUNCTION public\.record_board_pool_sample\(\) FROM PUBLIC, anon, authenticated/);
    expect(MIG).toMatch(/GRANT EXECUTE ON FUNCTION public\.record_board_pool_sample\(\) TO service_role/);
    // And the closure log itself stays private — aggregates only, never a row.
    expect(MIG).toMatch(/SECURITY DEFINER/);
    expect(MIG).toMatch(/SET search_path = public/);
    expect(MIG).not.toMatch(/SELECT \*\s+FROM public\.job_board_closures/);
  });

  it("samples once per completed pass, BEFORE the facets early-return", () => {
    expect(FN).toMatch(/rpc\("record_board_pool_sample"\)/);
    const passDone = FN.indexOf("if (passDone) {");
    expect(passDone, "passDone block not found").toBeGreaterThan(-1);
    const sample = FN.indexOf('rpc("record_board_pool_sample")', passDone);
    const facets = FN.indexOf('rpc("refresh_job_board_facets")', passDone);
    expect(sample, "sample call not inside the passDone block").toBeGreaterThan(-1);
    expect(facets).toBeGreaterThan(-1);
    // facets returns early when its RPC is unavailable. A growth series that
    // stops accruing whenever a DIFFERENT rpc is down reads "flat" for the
    // wrong reason.
    expect(sample, "the pool sample must be taken before the facets early-return")
      .toBeLessThan(facets);
  });

  it("is exposed on status, deadlined, and omitted rather than zeroed", () => {
    expect(FN).toMatch(/rpc\("get_board_flow"/);
    // [\d_]+ not \d+ — the codebase writes numeric separators (3_000), and the
    // first draft of this assertion failed on its own correct code because of it.
    expect(/withDeadline\(client\.rpc\("get_board_flow"[\s\S]{0,60}?,\s*[\d_]+\)/.test(FN)).toBe(true);
    const ms = Number(
      (/withDeadline\(client\.rpc\("get_board_flow"[\s\S]{0,80}?,\s*([\d_]+)\)/.exec(FN)?.[1] ?? "0")
        .replace(/_/g, ""),
    );
    expect(ms, "deadline must leave real headroom over the observed runtime")
      .toBeGreaterThanOrEqual(6000);
    const block = /boardFlow: \(\(\) => \{[\s\S]{0,400}?\}\)\(\)/.exec(FN)?.[0] ?? "";
    expect(block, "boardFlow status field not found").not.toBe("");
    expect(block.includes("return row && typeof row === \"object\" ? row : null;")).toBe(true);
  });
});

describe("every delete path leaves a trace", () => {
  /**
   * Audited 2026-08-17: two paths delete by company_token — a board going
   * dormant after repeated fetch failures, and a board removed from sources.ts —
   * so neither passes through the per-posting closure path. They wrote to
   * job_board_closures AND job_board_exits ZERO times. Every other delete site
   * writes at least one.
   *
   * The lifecycle log is the one asset here nobody can reproduce, and it is
   * worth exactly as much as its precision.
   */
  const sliceAround = (needle: string, back: number, fwd: number) => {
    const i = FN.indexOf(needle);
    return i < 0 ? "" : FN.slice(Math.max(0, i - back), i + fwd);
  };

  it("logs a dormant board's postings before deleting them", () => {
    const blk = sliceAround('console.warn(`[JOB-BOARD] board ${tk} dormant', 400, 200);
    expect(blk, "dormancy prune not found").not.toBe("");
    expect(blk).toMatch(/logWholeBoardExit\(client, tk, "board_dormant"\)/);
    // Read BEFORE delete — after the delete there is nothing left to read.
    expect(blk.indexOf("logWholeBoardExit")).toBeLessThan(blk.indexOf(".delete()"));
  });

  it("logs an orphaned board's postings before deleting them", () => {
    const blk = sliceAround("orphanLogged += await logWholeBoardExit", 300, 400);
    expect(blk, "orphan prune not found").not.toBe("");
    expect(blk).toMatch(/logWholeBoardExit\(client, tk, "untracked"\)/);
    expect(blk.indexOf("logWholeBoardExit")).toBeLessThan(blk.indexOf(".delete()"));
  });

  it("writes only exit reasons the DATABASE actually admits", () => {
    // THE BUG THIS EXISTS FOR, caught by published-claims.test.ts before deploy.
    // job_board_exits carried CHECK (exit_reason IN ('removed','aged_out',
    // 'backdated')). The new prune logging writes 'board_dormant' and
    // 'untracked' — both rejected. And the insert is best-effort by design (a
    // prune must never fail because bookkeeping did), so every insert would
    // have been rejected, warned, and discarded: logging NOTHING while the pass
    // reported success. A silent no-op is the worst possible outcome for a fix
    // whose entire purpose is that departures stop going unrecorded.
    //
    // So the code's vocabulary and the column's vocabulary are asserted against
    // each other. Neither can move without the other.
    const written = new Set<string>();
    for (const m of FN.matchAll(/exit_reason:\s*"([a-z_]+)"/g)) written.add(m[1]);
    // The two whole-board reasons arrive as a typed parameter, not a literal at
    // the insert site.
    const paramUnion = /reason:\s*((?:"[a-z_]+"\s*\|\s*)*"[a-z_]+")\s*,?\s*\)/.exec(
      /async function logWholeBoardExit[\s\S]*?\)\s*:/.exec(FN)?.[0] ?? "",
    )?.[1] ?? "";
    for (const m of paramUnion.matchAll(/"([a-z_]+)"/g)) written.add(m[1]);
    // And exitReasonFor's return type covers the aged-out sites.
    const retUnion = /function exitReasonFor\([^)]*\):\s*((?:"[a-z_]+"\s*\|\s*)*"[a-z_]+")/.exec(FN)?.[1] ?? "";
    for (const m of retUnion.matchAll(/"([a-z_]+)"/g)) written.add(m[1]);

    expect(written.size, "found no exit reasons in the function source").toBeGreaterThan(2);
    expect(written.has("board_dormant"), "prune reasons not detected").toBe(true);
    expect(written.has("untracked")).toBe(true);

    // The constraint in force is the LAST one to touch it, by migration order.
    const dir = resolve(ROOT, "supabase/migrations");
    const admitted = readdirSync(dir).sort()
      .map((n) => readFileSync(resolve(dir, n), "utf8"))
      .flatMap((t) => [...t.matchAll(/CHECK \(exit_reason IN \(([^)]*)\)\)/g)].map((m) => m[1]))
      .pop() ?? "";
    expect(admitted, "no exit_reason CHECK constraint found").not.toBe("");
    const allowed = new Set([...admitted.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
    for (const r of written) {
      expect(allowed.has(r), `code writes exit_reason "${r}" but the CHECK constraint rejects it`).toBe(true);
    }
  });

  it("never calls either one a closure", () => {
    // A dead feed is OUR fetch failing; an orphan is US dropping the board. In
    // both cases the employer may still be hiring. job_board_closures means "the
    // company took the role down" and logging these there would corrupt the one
    // table that cannot be re-derived.
    const fn = /async function logWholeBoardExit[\s\S]*?\n}\n/.exec(FN)?.[0] ?? "";
    expect(fn, "logWholeBoardExit not found").not.toBe("");
    expect(fn).not.toMatch(/job_board_closures/);
    expect(fn).toMatch(/from\("job_board_exits"\)/);
    // supabase-js RETURNS errors rather than throwing; an unchecked insert is
    // how lifecycle history goes missing without anyone noticing.
    expect(fn).toMatch(/if \(insErr\)/);
  });
});
