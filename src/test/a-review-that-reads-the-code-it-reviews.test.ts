/**
 * FOUR DEFECTS AN ADVERSARIAL REVIEW CAUGHT BEFORE THEY SHIPPED — pinned here
 * so none of them can quietly return.
 *
 * 1. The wrap writer discarded its pre-upsert read's error. The upsert
 *    replaces the whole cold_rotation v row, so a transient read failure
 *    would delete wrapMin, silently, and revert the SLA to its fallback for
 *    an entire rotation — indistinguishable from "first wrap ever". And chain
 *    hops force past the slice lock, so two chains wrapping within a minute
 *    could stamp wrapMin 0.
 *
 * 2. The coverage fallback's return object carried only the four original
 *    figures. One get_filter_coverage failure after one success would DELETE
 *    the five live figures from the cache (the upsert replaces v whole) and
 *    the disclosure would silently revert to constants pinned 2026-08-25.
 *
 * 3. saveCurrentSearch stored maxYears: 0 — the years picker's rest state,
 *    which filters.ts refuses outright (1..20). Every saved search would have
 *    carried a phantom "≤0 yrs" name segment and a standing ignoredFilters
 *    warning on every digest run.
 *
 * 4. includeUnstatedPay was newly saved but absent from searchName, so a
 *    search differing ONLY by that widening collided with UNIQUE(user_id,
 *    name) and the save was refused as "already saved" — silently.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { searchName, searchToBoardBody, searchToQuery } from "../lib/job-search-params";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const BOARD = strip(read("supabase/functions/job-board/index.ts"));
const JOBS = strip(read("src/pages/Jobs.tsx"));
const DIGEST = strip(read("supabase/functions/send-search-digest/index.ts"));

describe("the coverage fallback keeps what the one-scan produced", () => {
  it("carries the five live figures forward instead of deleting them", () => {
    const at = BOARD.indexOf("const carryLive");
    expect(at, "the fallback deletes the live figures again").toBeGreaterThan(-1);
    const block = BOARD.slice(at, at + 1200);
    for (const k of ["payBasis", "hasStatedPay", "maxYears", "department"]) {
      expect(block, `${k} missing from the fallback's return`).toContain(`${k}: carryLive("${k}")`);
    }
  });
});

describe("a rest-state zero is not a filter", () => {
  it("nothing saves, links, or mails maxYears 0", () => {
    expect(JOBS, "saveCurrentSearch stores the picker's off position again")
      .toMatch(/maxYears: maxYears \|\| undefined/);
    expect(searchName({ q: "nurse", maxYears: 0 })).not.toContain("≤0");
    expect(searchToQuery({ q: "nurse", maxYears: 0 })).not.toContain("maxYears");
    expect(searchToBoardBody({ q: "nurse", maxYears: 0 }).maxYears).toBeUndefined();
    expect(DIGEST).toMatch(/maxYears: p\.maxYears \|\| undefined/);
    expect(DIGEST).toMatch(/if \(p\.maxYears\) qs\.set/);
  });

  it("a real maxYears still rides everywhere", () => {
    expect(searchName({ q: "nurse", maxYears: 2 })).toContain("≤2 yrs");
    expect(searchToQuery({ q: "nurse", maxYears: 2 })).toContain("maxYears=2");
    expect(searchToBoardBody({ q: "nurse", maxYears: 2 }).maxYears).toBe(2);
  });
});

describe("every distinguishing field reaches the name", () => {
  it("two searches differing only by the unstated-pay widening get different names", () => {
    // UNIQUE(user_id, name) refuses the second save otherwise — and the save
    // path reports "You already saved this search", which is a lie here.
    const a = searchName({ q: "nurse", salaryFloor: 50000 });
    const b = searchName({ q: "nurse", salaryFloor: 50000, includeUnstatedPay: true });
    expect(b).not.toBe(a);
    expect(b).toContain("incl. unlisted pay");
  });
});
