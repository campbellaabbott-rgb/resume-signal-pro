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
 * THE DISTINCTION THAT MATTERS, and the reason this is three counts and not
 * one: a TAKEDOWN (the employer removed the posting — absent from a successful
 * fetch of their own feed, two-pass confirmed) is a real hiring event. An
 * AGE-OUT (the posting crossed the 30-day serving edge) is us choosing to stop
 * showing something that may well still be open. Summing them would overstate
 * how much hiring actually stopped, which is exactly the kind of claim this
 * product does not make.
 */
const ROOT = resolve(__dirname, "../..");
const MIG = (() => {
  const dir = resolve(ROOT, "supabase/migrations");
  const f = readdirSync(dir).find((n) => n.includes("the_board_could_not_count_its_own_intake"));
  return f ? readFileSync(resolve(dir, f), "utf8") : "";
})();
const FN = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");

describe("the board can count its own intake and outtake", () => {
  it("ships the migration", () => {
    expect(MIG, "intake/outtake migration not found").not.toBe("");
    expect(MIG).toMatch(/CREATE OR REPLACE FUNCTION public\.get_board_flow/);
  });

  it("counts takedown and age-out SEPARATELY", () => {
    // Summing them would claim more hiring stopped than actually did.
    expect(MIG).toMatch(/takedown bigint/);
    expect(MIG).toMatch(/aged_out bigint/);
    // Takedown is the employer's action: missing_since, never a vendor outage.
    expect(MIG).toMatch(/WHERE missing_since >=/);
    // Age-out is ours: crossed the 30-day edge while still not missing.
    expect(MIG).toMatch(/missing_since IS NULL[\s\S]{0,200}?effective_posted <\s*now\(\) - interval '30 days'/);
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
    expect(MIG).toMatch(/SET statement_timeout = '20s'/);
  });

  it("indexes the columns it filters on", () => {
    // Without these the function seq-scans ~600k rows three times and will trip
    // its own timeout as the board grows — the same shape as the dating draw
    // that 57014'd for five days.
    expect(MIG).toMatch(/job_board_postings_first_seen_idx/);
    expect(MIG).toMatch(/job_board_postings_missing_since_idx/);
    // Partial: ~99% of rows have missing_since NULL.
    expect(MIG).toMatch(/WHERE missing_since IS NOT NULL/);
  });

  it("is exposed on status, deadlined, and omitted rather than zeroed", () => {
    expect(FN).toMatch(/rpc\("get_board_flow"/);
    // Deadlined like the other analytics RPCs — status must keep answering
    // "did the deploy land?" even when an aggregate is slow.
    // [\d_]+ not \d+ — the codebase writes numeric separators (3_000), and the
    // first draft of this assertion failed on its own correct code because of it.
    expect(/withDeadline\(client\.rpc\("get_board_flow"[\s\S]{0,60}?,\s*[\d_]+\)/.test(FN)).toBe(true);
    // Null, never 0. "0 intake" on a board taking thousands is a false alarm,
    // and a false alarm teaches people to ignore the real one.
    const block = /boardFlow: \(\(\) => \{[\s\S]{0,400}?\}\)\(\)/.exec(FN)?.[0] ?? "";
    expect(block, "boardFlow status field not found").not.toBe("");
    expect(block.includes("return row && typeof row === \"object\" ? row : null;")).toBe(true);
  });
});
