import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * "CA" RETURNED 113,223 JOBS AND 70% OF THEM WERE NOT CALIFORNIA.
 *
 * MEASURED 2026-08-20, both directions broken:
 *   "Texas"       7,788   misses the 16,234 rows written "TX"
 *   "California" 10,106   misses most of the state
 *   "CA"        113,223   matching "CAnada", "3 LoCAtions", "TransCAnada"
 *
 * A bare two-letter code cannot be substring-matched, because many are
 * ordinary English: %IN% hits 129,229 rows and %OR% hits 109,393. Anchoring on
 * the comma that precedes a state in real location strings is exact — %, IN%
 * is 14,071 and %, OR% is 3,265.
 *
 * So each state carries BOTH forms, and typing either reaches the union:
 * "Dallas, Texas" and "Austin, TX" are the same state to a job seeker.
 */
const FN = readFileSync(
  resolve(__dirname, "../../supabase/functions/job-board/index.ts"),
  "utf8",
);
const STATES = (() => {
  const b = /const STATE_ALIASES: Record<string, \{ names: string\[\]; keepRaw: boolean \}> = \{([\s\S]*?)\n\};/.exec(FN)?.[1] ?? "";
  const out: Record<string, { names: string[]; keepRaw: boolean }> = {};
  for (const m of b.matchAll(/"([^"]+)":\s*\{\s*names:\s*\[([^\]]*)\],\s*keepRaw:\s*(true|false)/g)) {
    out[m[1]] = { names: [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]), keepRaw: m[3] === "true" };
  }
  return out;
})();

describe("a state reaches its own jobs, and only its own", () => {
  it("covers the states and provinces, by both name and code", () => {
    expect(Object.keys(STATES).length).toBeGreaterThanOrEqual(100);
    for (const k of ["texas", "tx", "california", "ca", "new york", "ny", "ontario", "on"]) {
      expect(STATES[k], `"${k}" has no state alias`).toBeTruthy();
    }
  });

  it("both spellings resolve to the SAME set — the union, not one half", () => {
    expect(STATES["texas"].names).toEqual(STATES["tx"].names);
    expect(STATES["california"].names).toEqual(STATES["ca"].names);
  });

  it("the code form is comma-anchored, never a bare substring", () => {
    // This is the whole fix. %CA% is 115,826 rows and mostly Canada;
    // %, CA% is 36,304 and is California.
    for (const k of ["texas", "california", "indiana", "oregon"]) {
      const codeForm = STATES[k].names.find((n) => n.startsWith(", "));
      expect(codeForm, `${k} must carry a ", ST" form`).toBeTruthy();
      expect(codeForm!.length, `${k}'s code form must be ", XX"`).toBe(4);
    }
    // And no state may search the bare code.
    for (const [k, v] of Object.entries(STATES)) {
      expect(v.keepRaw, `${k} must not search its raw token — bare codes are substring poison`).toBe(false);
      for (const n of v.names) {
        expect(/^[A-Z]{2}$/.test(n), `${k} must never search the bare code "${n}"`).toBe(false);
      }
    }
  });

  it("a city alias is not shadowed by a same-spelled state code", () => {
    // "LA" is Los Angeles to a job seeker, not Louisiana; "NY"/"NYC" likewise.
    // Metro must be consulted first.
    expect(FN).toMatch(/METRO_ALIASES\[clean\.toLowerCase\(\)\] \?\? STATE_ALIASES\[clean\.toLowerCase\(\)\]/);
  });

  it("the browse path QUOTES its or() values, because a state contains a comma", () => {
    // PostgREST splits or() branches on commas, so an unquoted
    // `location.ilike.%, TX%` becomes two malformed branches and the filter
    // silently stops meaning what it says.
    expect(FN).toMatch(/location\.ilike\."%\$\{t\}%"/);
  });

  it("strips the quote that quoting made load-bearing", () => {
    const strip = /const sanitizeTerm = \(t: string\) => t\.replace\(\/\[([^\]]+)\]\/g, ""\)/.exec(FN)?.[1] ?? "";
    expect(strip.includes('"'), "a typed quote could close the or() value early").toBe(true);
  });
});
