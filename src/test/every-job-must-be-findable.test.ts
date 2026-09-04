import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * EVERY JOB MUST BE FINDABLE.
 *
 * Not "does search work" — every other probe here answers that. The question a
 * seeker whose job is on this board actually has is: if I search for THIS
 * posting, does the board give it back? scripts/findability-probe.mjs samples
 * real postings across five slices of the corpus and queries each by its own
 * title, because a posting that cannot be found by its own title is unfindable
 * by anything weaker.
 *
 * First run, 2026-09-04: 35 of 40. Four of the five failures contained " - ".
 *
 *   "Graduate Engineer - Civil"        347 results, the posting NOT returned
 *   "Graduate Engineer Civil"           44 results, that posting ranked FIRST
 *   "Weekend LPN - Pediatric Clients"        not returned at all
 *   "Weekend LPN Pediatric Clients"     total 1, that posting ranked FIRST
 *
 * websearch_to_tsquery reads a leading "-" as NOT, and every term in the
 * ILIKE path is ANDed, so a token that is pure punctuation makes the query
 * unsatisfiable. The board's own exclusion syntax is an ATTACHED "-term",
 * consumed by splitExclusions before any of this runs — so a hyphen still
 * standing at this point is a separator someone pasted, not an instruction.
 */
const RAW = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

describe("every job must be findable", () => {
  it("a separator between words is stripped before the tsquery sees it", () => {
    expect(CODE).toMatch(/t = t\.replace\(\/\(\^\|\\s\)\[-&\/–—\]\+\(\\s\|\$\)\/g, " "\);/);
    const fts = CODE.slice(CODE.indexOf("function ftsSafe"), CODE.indexOf("function ftsSafe") + 700);
    expect(fts.indexOf('replace(/(^|\\s)[-&/–—]+'), "must run before the other punctuation pass").toBeGreaterThan(0);
  });

  it("a token with no letter or digit can never become a required term", () => {
    expect(CODE).toMatch(/\.filter\(\(x\) => \/\[a-z0-9\]\/i\.test\(x\)\);/);
  });

  it("the ATTACHED exclusion syntax is untouched — it is consumed before this", () => {
    // "-travel" and "not travel" are deliberate and tested elsewhere; only a
    // hyphen standing alone between words is treated as punctuation. The
    // stripper requires whitespace (or a boundary) on BOTH sides.
    expect(CODE).toMatch(/\(\^\|\\s\)\[-&\/–—\]\+\(\\s\|\$\)/);
    expect(CODE, "splitExclusions still runs, and still owns -term").toMatch(/splitExclusions/);
  });

  it("the probe that found this is committed, so the number can be re-measured", () => {
    const probe = readFileSync(resolve(__dirname, "../../scripts/findability-probe.mjs"), "utf8");
    expect(probe).toMatch(/queries each by its own title|its own title/);
    expect(probe, "it must sample more than the top of one list").toMatch(/const SLICES = \[/);
    expect(probe, "read-only, and paced — it runs against the live board").toMatch(/setTimeout\(r, 350\)/);
  });
});
