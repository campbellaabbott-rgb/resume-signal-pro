import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * PETSMART HOLDS 10,911 POSTINGS AND THE PAGE CAP WOULD HAVE SERVED 1,200.
 *
 * The 2026-08-19 inventory census found careers.petsmart.com live on the exact
 * /api/jobs endpoint the iCIMS adapter already parses — measured totalCount
 * 10,911, uncarried. But the adapter's global cap (12 pages x 100) exists so
 * one giant board cannot wedge a refresh slice, and it would have silently
 * windowed this tenant at 11% forever — the same insert-only-window shape that
 * once left 70k Workday rows undated.
 *
 * The fix is a PER-TENANT page budget plus chunked page fetching: named giants
 * get the pages they need, everyone else keeps the slice-protecting default,
 * and the giant costs ~23 sequential rounds (chunks of 5), not 110 serial
 * round trips.
 */
const ROOT = resolve(__dirname, "../..");
const SRC = readFileSync(resolve(ROOT, "supabase/functions/job-board/sources.ts"), "utf8");
const FN = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");

describe("giant iCIMS boards are read fully without wedging a slice", () => {
  it("carries PetSmart with a page budget that covers its measured size", () => {
    const m = /\{ name: "PetSmart", source: "icims", token: "careers\.petsmart\.com", pages: (\d+) \}/.exec(SRC);
    expect(m, "PetSmart entry missing").not.toBeNull();
    // 10,911 measured / 100 per page = 110 pages minimum.
    expect(Number(m![1])).toBeGreaterThanOrEqual(110);
  });

  it("the budget is per-tenant — the default stays slice-protecting", () => {
    expect(FN).toMatch(/ICIMS_MAX_PAGES = Math\.max\(1, s\.pages \?\? 12\)/);
  });

  it("pages fetch in bounded parallel chunks, and a short page ends the walk", () => {
    expect(FN).toMatch(/ICIMS_CHUNK = 5/);
    // The early-exit must survive the chunking: a short page inside a chunk
    // ends the whole walk, or out-of-range pages would be read as data.
    expect(FN).toMatch(/break outer;/);
  });

  it("capacity was raised to fund the census merges", () => {
    expect(FN).toMatch(/const COLD_SLICES_PER_PASS = 160;/);
  });

  it("BUILD_VERSION moved with sources.ts, per the bootstrap-lane rule", () => {
    // sources.ts changes ship with a version bump or the BUILD_VERSION-keyed
    // bootstrap lane never picks the new boards up.
    const v = /const BUILD_VERSION = "([^"]+)"/.exec(FN)![1];
    expect(v >= "2026-08-19.1").toBe(true);
  });
});
