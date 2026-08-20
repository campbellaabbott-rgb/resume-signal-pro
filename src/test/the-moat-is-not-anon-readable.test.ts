import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE CLOSURE LOG WAS PUBLICLY READABLE FOR 35 DAYS.
 *
 * job_board_closures is the one dataset a competitor cannot reconstruct — it
 * exists only if you were watching when each posting came down. Its ORIGINAL
 * migration (20260714150000) shipped `FOR SELECT USING (true)`, and the belief
 * that it was private survived because a probe SELECTed a nonexistent column
 * (`id`; the key is `event_id`) and its 400 was read as "permission denied".
 *
 * This file pins three things: the lock migration exists and drops the policy;
 * no later migration reopens raw SELECT on any of the three private ledgers;
 * and the lesson about false-negative probes stays written down.
 */
const DIR = resolve(__dirname, "../../supabase/migrations");
const files = readdirSync(DIR).sort();
const read = (n: string) => readFileSync(resolve(DIR, n), "utf8");

describe("the private ledgers stay private", () => {
  it("ships the lock and it lands AFTER the migration that opened the hole", () => {
    const lock = files.find((f) => f.includes("the_moat_was_open"));
    expect(lock, "lock migration missing").toBeTruthy();
    expect(read(lock!)).toMatch(
      /DROP POLICY IF EXISTS "job_board_closures_public_read" ON public\.job_board_closures;/,
    );
    // Timestamp ordering is the entire mechanism: a lock stamped earlier than
    // the hole would be a no-op on a fresh database.
    expect(lock! > "20260714150000").toBe(true);
  });

  it("ships the SECOND lock — the closure log was shut while the daily series stayed open", () => {
    // Locking job_board_closures on the 18th protected nothing on its own.
    // job_board_company_snapshots holds the same asset in a more convenient
    // shape — a per-company daily open-roles series — and was still returning
    // 733,665 rows to the anon key two days later, continuous from 2026-07-21.
    // One filtered request handed over a whole company's hiring curve.
    const lock = files.find((f) => f.includes("the_moat_had_a_second_door"));
    expect(lock, "the job_board_company_snapshots lock migration is missing").toBeTruthy();
    const sql = read(lock!);
    expect(sql).toMatch(
      /DROP POLICY IF EXISTS "job_board_company_snapshots_public_read" ON public\.job_board_company_snapshots;/,
    );
    // The GRANT goes too. A GRANT is not what restricts — but leaving it means
    // the next permissive policy silently reopens the table.
    expect(sql).toMatch(/REVOKE SELECT ON public\.job_board_company_snapshots FROM anon;/);
    expect(sql).toMatch(/ALTER TABLE public\.job_board_company_snapshots ENABLE ROW LEVEL SECURITY;/);
    // Must sort after the migration that granted the read, or it is a no-op on
    // a fresh database.
    expect(lock! > "20260721190000").toBe(true);
  });

  it("no migration AFTER the lock creates a public SELECT policy on a private ledger", () => {
    const lock = files.find((f) => f.includes("the_moat_was_open"))!;
    const laters = files.filter((f) => f > lock);
    for (const f of laters) {
      const s = read(f);
      for (const table of [
        "job_board_closures",
        "job_board_exits",
        "job_board_pool_samples",
        "job_board_company_snapshots",
      ]) {
        const re = new RegExp(
          String.raw`CREATE POLICY[^;]*ON\s+(public\.)?${table}[^;]*FOR SELECT[^;]*USING\s*\(\s*true\s*\)`,
          "i",
        );
        expect(s, `${f} reopens raw SELECT on ${table}`).not.toMatch(re);
      }
    }
  });

  it("keeps the false-negative-probe lesson: permission probes must name a real column", () => {
    const lock = files.find((f) => f.includes("the_moat_was_open"))!;
    expect(read(lock)).toMatch(/event_id/);
  });
});
