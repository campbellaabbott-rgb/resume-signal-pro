import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE BOARD PROMISED A 30-DAY CAP AND SERVED A JOB FROM 2014.
 *
 * Not a row the freshness sweep had missed — a row it had deleted many times.
 * Measured 2026-08-24: ~20,600 servable postings sat past the published cap,
 * and all 1,000 sampled had a first_seen of that same morning. The loop:
 *
 *   1. bamboohr and rippling list payloads carry no posting date, so the
 *      ingest filter cannot fire — isDatedBefore only drops a date it KNOWS.
 *   2. The posted-date backfill later stamps the real date (2014).
 *   3. The pass-end freshness sweep deletes the now-visibly-stale row.
 *   4. The next rotation re-inserts it, because "already stored" was the only
 *      thing suppressing an insert and it is no longer stored.
 *
 * The second consequence is the worse one: every lap wrote a job_board_exits
 * row, so the public "roles filled or closed today" figure was counting the
 * same postings dying on repeat. A published number fed by artificial events
 * is the defect this codebase treats most seriously.
 *
 * The tombstone closes the loop — an ATS posting id and its posting date are
 * both stable, so remembering that an id aged out is enough for ingest to
 * refuse it. These assertions run on comment-stripped code, because the
 * explanations above name the very things the negative assertions forbid.
 */
const ROOT = resolve(__dirname, "../..");
const FN = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");
const HB = readFileSync(resolve(ROOT, "supabase/functions/scan-heartbeat/index.ts"), "utf8");
const MIG_DIR = resolve(ROOT, "supabase/migrations");
const MIG = readFileSync(
  resolve(MIG_DIR, readdirSync(MIG_DIR).find((f) => f.includes("aged_out_must_not_walk_back_in"))!),
  "utf8",
);
const stripTs = (c: string) =>
  c.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
const stripSql = (c: string) =>
  c.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");

const CODE = stripTs(FN);

describe("a posting that aged out must not walk back in", () => {
  it("ingest consults the tombstone before inserting new rows", () => {
    expect(CODE).toMatch(/from\("job_board_aged_out"\)\s*\n?\s*\.select\("id"\)/);
    expect(CODE).toMatch(/newRows = newRows\.filter\(\(r\) => !blocked\.has\(String\(r\.id\)\)\)/);
  });

  it("a missing tombstone table degrades to the old behaviour, never to an empty board", () => {
    // The function can deploy ahead of its migration. Losing a board's entire
    // intake because a bookkeeping table is absent would be a far worse
    // failure than the one being fixed.
    const block = CODE.slice(CODE.indexOf("if (newRows.length > 0)"), CODE.indexOf("const vanishedAll"));
    expect(block).toMatch(/catch \(e\)/);
    expect(block).toMatch(/aged-out check skipped/);
  });

  it("the sweep tombstones what it deletes", () => {
    expect(CODE).toMatch(/from\("job_board_aged_out"\)\.upsert\(/);
    expect(CODE).toMatch(/onConflict: "id" \}/);
  });

  it("an exit is ledgered ONCE — a posting dying on a loop is not news", () => {
    expect(CODE).toMatch(/const freshlyDead = agedRows\.filter\(\(r\) => !alreadyTombstoned\.has\(String\(r\.id\)\)\)/);
    expect(CODE).toMatch(/if \(freshlyDead\.length === 0\) continue;/);
    // The ledger write must read the filtered list, not the raw page. Anchor
    // to the sweep's own call: logWholeBoardExit has a legitimate earlier
    // insert of its own, and matching the first occurrence tested that one.
    const freshAt = CODE.indexOf("const freshlyDead");
    expect(freshAt).toBeGreaterThan(-1);
    const insertAt = CODE.indexOf('from("job_board_exits").insert(', freshAt);
    expect(insertAt, "the freshness sweep no longer ledgers exits at all").toBeGreaterThan(-1);
    expect(CODE.slice(insertAt, insertAt + 120)).toMatch(/freshlyDead\.map/);
  });

  it("tombstones expire, so the table is bounded and id recycling self-heals", () => {
    expect(CODE).toMatch(/from\("job_board_aged_out"\)\.delete\(\)/);
    expect(CODE).toMatch(/180 \* 86_400_000/);
  });

  it("the migration seeds the tombstone BEFORE deleting, or the loop survives it", () => {
    const sql = stripSql(MIG);
    const insertAt = sql.indexOf("INSERT INTO public.job_board_aged_out");
    const deleteAt = sql.indexOf("DELETE FROM public.job_board_postings");
    expect(insertAt, "the tombstone seed is missing").toBeGreaterThan(-1);
    expect(deleteAt, "the purge is missing").toBeGreaterThan(-1);
    expect(insertAt, "deleting before tombstoning lets the next rotation undo the purge").toBeLessThan(deleteAt);
  });

  it("the tombstone is internal and is NOT the lifecycle log", () => {
    const sql = stripSql(MIG);
    expect(sql).toMatch(/REVOKE ALL ON public\.job_board_aged_out FROM anon, authenticated;/);
    expect(sql).toMatch(/GRANT ALL ON public\.job_board_aged_out TO service_role;/);
    expect(sql).not.toMatch(/job_board_closures/i);
    // The one-time purge must not ledger 20,600 exits it has already counted.
    expect(sql).not.toMatch(/INSERT INTO public\.job_board_exits/i);
  });

  it("the published cap has a monitor, so it cannot go false quietly again", () => {
    const hb = stripTs(HB);
    expect(hb).toMatch(/job_board_freshness_cap/);
    expect(hb).toMatch(/\.lt\('effective_posted', cutoff\)/);
    expect(hb).toMatch(/staleCount \?\? 0\) > 2000/);
  });
});
