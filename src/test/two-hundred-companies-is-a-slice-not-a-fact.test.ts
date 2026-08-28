/**
 * THE HOMEPAGE SAID "200 COMPANIES" ON A 32,651-BOARD CATALOG.
 *
 * refresh_head deliberately truncates companiesFacet to the top 200 and
 * stores the true employer count BESIDE it — and the head-row reader's own
 * comment names the failure this design prevents: "deriving the count from a
 * 200-row slice would publish '200 employers' as a fact." Most response sites
 * honoured that. TWO did not: the recency path (the homepage's own light
 * call) and the salary-sort path published `fullCompanies.length` bare, so
 * the first evening a pass wrote the new-shape head row and serving preferred
 * it, the homepage hero said 200 companies. Caught by the user from a
 * screenshot, live.
 *
 * And trackedTotal died the same evening by the same mechanism: it reads
 * coverage.tracked, which only refresh_headline_open() patched — into the FAT
 * row only. Serving moved to the head row; the patcher kept freshening a row
 * nobody read. The head row's coverage now carries tracked at write time, and
 * 20260828001000 teaches the patcher to keep BOTH rows fresh between passes.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const BOARD = strip(read("supabase/functions/job-board/index.ts"));
const MIG = read("supabase/migrations/20260828001000_the_headline_patcher_missed_the_row_the_board_now_serves.sql");

describe("a truncated facet's length is never published as the employer count", () => {
  it("no response site uses a bare facet length when the stored count exists", () => {
    // Every companiesCount must prefer the stored number; a bare `.length` on
    // fullCompanies/fullCompanies0 is the homepage bug verbatim.
    expect(BOARD, "the recency path publishes the slice length again")
      .not.toMatch(/companiesCount: fullCompanies\.length/);
    expect(BOARD, "the salary-sort path publishes the slice length again")
      .not.toMatch(/companiesCount: fullCompanies0\.length/);
    expect(BOARD).toMatch(/companiesCount: \(\(v\.companiesCount as number \| undefined\) \?\? fullCompanies\.length\)/);
    expect(BOARD).toMatch(/companiesCount: \(\(v0\.companiesCount as number \| undefined\) \?\? fullCompanies0\.length\)/);
  });

  it("the head row's coverage carries tracked at write time", () => {
    // trackedTotal reads coverage.tracked; a head row without it silently
    // deletes the homepage's second true number.
    expect(BOARD).toMatch(/coverage: \{ \.\.\.coverage, tracked: v\.total \}/);
  });
});

describe("the headline patcher freshens every row the board can serve from", () => {
  it("patches refresh AND refresh_head in one statement", () => {
    expect(MIG).toMatch(/WHERE k IN \('refresh', 'refresh_head'\)/);
    // Merge, not replace: the head row's companiesCount and facet must
    // survive the patch — verified by execution (companiesCount kept through
    // the jsonb || merge in pglite).
    expect(MIG).toMatch(/coalesce\(v, '\{\}'::jsonb\) \|\|/);
    expect(MIG).toMatch(/'tracked', v_tracked/);
  });
});
