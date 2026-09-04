import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * FOUR WAYS TO LOSE A BOARD, ALL FOUND IN ONE SWEEP.
 *
 * 2026-09-04, a 47-agent read-only sweep with three refuters per finding.
 * Each of these was live, and two of them were shipped by me the same day.
 *
 *  1. The free-text or() interpolated its terms unquoted. A PostgREST or() is
 *     a comma-separated list inside parentheses, so an ordinary job title —
 *     "Manager, Operations", "Teacher, K-8", "Engineer (Remote)" — was parsed
 *     as structure and returned HTTP 500.
 *  2. A budget-retired fetch worker `return`ed, ending it for the rest of the
 *     slice. Every reservation trip permanently removed one of the eight, so
 *     concurrency ratcheted down to 1 in the tail of every cold slice — and
 *     cold rotation speed is what buys the published freshness promise.
 *  3. Oracle and iCIMS reported windowed:false on the deep cursor's WRAP
 *     visit, so one partial read absence-pruned an entire giant employer:
 *     Kroger's 12,350 postings, Costco, AutoZone, PetSmart, Ulta, JCPenney.
 *  4. The exact-word rescue tier claimed `ranked: true`, so the page said
 *     "Sorted by relevance" over rows with no relevance scoring, and the only
 *     detector for a ranked-path outage could never fire.
 */
const ROOT = resolve(__dirname, "../..");
const RAW = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");
const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const SHARED = readFileSync(resolve(ROOT, "supabase/functions/_shared/location-terms.ts"), "utf8");

describe("four ways to lose a board", () => {
  it("every or() value is quoted, and the sanitiser strips the character that could escape it", () => {
    expect(CODE).toMatch(/q = q\.or\(`title\.ilike\."%\$\{t\}%",company\.ilike\."%\$\{t\}%",department\.ilike\."%\$\{t\}%"`\)/);
    // The quoting is only safe while sanitizeTerm removes the double quote.
    expect(SHARED).toMatch(/sanitizeTerm = \(t: string\) => t\.replace\(\/\[%_\\\\\|"\]\/g, ""\)/);
    // No unquoted ilike survives inside an or() list anywhere in the file.
    expect(CODE.match(/\.or\(`[^`]*ilike\.%/g) ?? [], "an unquoted ilike inside an or()").toEqual([]);
  });

  it("a budget-retired worker yields and comes back — it never exits the slice", () => {
    expect(CODE).toMatch(/if \(fetchedInSlice \+ inFlightReserve >= SLICE_POSTING_BUDGET\) \{\s*queue\.unshift\(s\);\s*await new Promise\(\(r\) => setTimeout\(r, 250\)\);\s*continue;\s*\}/);
    expect(CODE, "the reservation branch must not return").not.toMatch(/queue\.unshift\(s\); return;/);
    // The landed check still exits the BOARD (not the worker) when the budget
    // is genuinely spent — that is what makes the yield above terminate.
    expect(CODE).toMatch(/if \(fetchedInSlice >= SLICE_POSTING_BUDGET\) \{ budgetSkipped\.push\(s\.token\); continue; \}/);
  });

  it("a resumed read reports windowed, so a wrap visit cannot absence-prune a giant board", () => {
    // Only a RESUMABLE fetcher can be mid-read: those are exactly the ones
    // that return a nextOffset. UKG, ADP and USAJOBS read from the top every
    // visit, so `!exhausted` alone is correct for them and adding the clause
    // would pin a variable they do not have.
    const returns: string[] = CODE.match(/return \{[^;]*windowed: !exhausted[^;]*\};/g) ?? [];
    const resumable = returns.filter((r) => r.includes("nextOffset"));
    expect(resumable.length, "Oracle and iCIMS").toBeGreaterThanOrEqual(2);
    for (const r of resumable) expect(r, `a resumed read must count as windowed: ${r.slice(0, 90)}`).toContain("|| startOffset > 0");
  });

  it("only a genuinely reranked exit claims ranked: true", () => {
    expect(CODE, "the exact-word rescue tier applies no relevance scoring").not.toMatch(/exactWordMatch: qText,\s*ranked: true/);
    expect(CODE, "the location split IS reranked, and keeps its claim").toMatch(/locationSplit: \{ q: won\.head, location: won\.place \},\s*ranked: true,/);
  });
});
