import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROLE_ALIASES, expandQuery } from "../../supabase/functions/job-board/search-alias.ts";

/**
 * THE TABLE WAS ONLY EVER READ ONE WAY.
 *
 * ROLE_ALIASES maps an abbreviation to what it stands for, and expandQuery
 * looked up one TOKEN at a time. So "rn" found "registered nurse", and someone
 * typing "registered nurse" never reached a posting titled "RN — Med/Surg".
 * Employers write both. Half a curated table was doing nothing for the reader
 * who spells it out, which is the more common way to type it.
 *
 * This is a findability fix, measured by scripts/findability-probe.mjs (88% ->
 * 95% after the hyphen fix; this addresses a different slice of the remainder).
 */
const RAW = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/search-alias.ts"), "utf8");

describe("the table was only ever read one way", () => {
  it("a spelled-out phrase now also reaches its abbreviation", () => {
    const r = expandQuery("registered nurse");
    expect(r.expansions).toContain("rn");
    expect(r.q).toMatch(/\brn\b/);
    // The reader's own spelling still leads.
    expect(r.q.indexOf("registered nurse")).toBeLessThan(r.q.indexOf(" OR "));
  });

  it("still works in the original direction", () => {
    const r = expandQuery("rn");
    expect(r.expansions).toContain("registered nurse");
  });

  it("keeps surrounding words, so the rest of the query is not lost", () => {
    const r = expandQuery("senior registered nurse");
    expect(r.q).toMatch(/senior rn/);
  });

  it("prefers the longest spelling, or the specific reading is never offered", () => {
    // "licensed practical nurse" contains no shorter alias run, but the rule
    // that finds it must scan longest-first; assert on a real table entry.
    const long = Object.entries(ROLE_ALIASES).find(([, ps]) => ps.some((p) => p.split(" ").length >= 3));
    expect(long, "the table should carry at least one three-word phrase").toBeTruthy();
    const [abbrev, phrases] = long!;
    const phrase = phrases.find((p) => p.split(" ").length >= 3)!;
    expect(expandQuery(phrase).expansions).toContain(abbrev);
  });

  it("does NOT contract into an ambiguous abbreviation", () => {
    // "pm" stands for product manager AND project manager. The forward
    // direction may fan out — the reader typed the ambiguous thing and gets to
    // see both readings — but contracting the precise phrase into the
    // ambiguous one would widen a search the reader deliberately narrowed.
    // An existing guard in job-board.test.ts caught this the first time.
    expect(ROLE_ALIASES.pm.length, "the premise: pm is ambiguous").toBeGreaterThan(1);
    expect(expandQuery("product manager").expansions).toEqual([]);
    expect(expandQuery("product manager").q).toBe("product manager");
  });

  it("is derived from the one table, so the two directions cannot disagree", () => {
    expect(RAW).toMatch(/const PHRASE_TO_ABBREV: Map<string, string\[\]> = \(\(\) => \{/);
    expect(RAW).toMatch(/for \(const \[abbrev, phrases\] of Object\.entries\(ROLE_ALIASES\)\)/);
    // No second hand-maintained list — that is the drift this repo keeps hitting.
    expect(RAW, "a reverse table typed by hand would go stale the first time an alias is added")
      .not.toMatch(/const ABBREV_FOR[^=]*=\s*\{/);
  });

  it("respects the existing branch cap and the quoted/OR/exclusion bail-outs", () => {
    expect(RAW).toMatch(/if \(branches\.length >= MAX_BRANCHES\) break;/);
    // A quoted phrase, an explicit OR, or a -exclusion still returns untouched.
    expect(expandQuery('"registered nurse"').expansions).toEqual([]);
    expect(expandQuery("registered nurse OR lpn").expansions).toEqual([]);
    expect(expandQuery("registered nurse -travel").expansions).toEqual([]);
  });
});
