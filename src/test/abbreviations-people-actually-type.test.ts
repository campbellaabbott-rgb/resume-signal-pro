import { describe, expect, it } from "vitest";
import { ROLE_ALIASES } from "../../supabase/functions/job-board/search-alias";
import { expandQuery } from "../../supabase/functions/job-board/search-alias";

/**
 * "mech eng" RETURNED NOTHING ON A BOARD HOLDING 2,206 OF THEM.
 *
 * The alias map handled ACRONYMS — whole roles written as initials (swe, rn,
 * sdr). It did not handle the other half of how people type: ordinary words
 * shortened inside a phrase. Measured live 2026-08-20, typed form vs the full
 * spelling:
 *
 *     "mech eng"        0  vs  2,206   -100%
 *     "svc technician"  7  vs  4,426   -100%
 *     "medical asst"   69  vs  3,865    -98%
 *     "project mgr"   174  vs  9,275    -98%
 *     "ops manager"   335  vs  6,974    -95%
 *     "sales rep"     491  vs  5,543    -91%
 *     "sr accountant" 508  vs  3,172    -84%
 *
 * These are not exotic phrasings. Losing 84-100% of real matches on them is
 * the single largest measured gap in search after the filler-word fix.
 *
 * The expansion MACHINERY was already correct and per-token; only the
 * vocabulary was missing. So this file guards the vocabulary and the property
 * that keeps it safe — an expansion may only ADD readings, never replace the
 * literal one.
 */
describe("abbreviations people actually type reach the full titles", () => {
  it("covers the measured gaps", () => {
    for (const [abbr, full] of [
      ["rep", "representative"], ["asst", "assistant"], ["mgr", "manager"],
      ["eng", "engineer"], ["mech", "mechanical"], ["svc", "service"],
      ["ops", "operations"], ["exec", "executive"], ["sr", "senior"],
      ["dev", "developer"], ["coord", "coordinator"], ["supv", "supervisor"],
    ] as const) {
      expect(ROLE_ALIASES[abbr], `"${abbr}" has no expansion`).toBeTruthy();
      expect(ROLE_ALIASES[abbr].join(" "), `"${abbr}" should reach "${full}"`).toContain(full);
    }
  });

  it("keeps the original spelling as a branch, never replacing it", () => {
    // "SWE II" and "Sales Rep" are real titles. An expansion that dropped the
    // literal would lose the exact matches it was meant to supplement.
    const { q } = expandQuery("sales rep");
    expect(q).toContain("sales rep");
    expect(q.toLowerCase()).toContain("representative");
  });

  it("expands multi-abbreviation queries in one branch", () => {
    // "mech eng" must reach "mechanical engineer" — expanding only the first
    // token was the half-fix that left this at zero results.
    const { q } = expandQuery("mech eng");
    expect(q.toLowerCase()).toContain("mechanical engineer");
  });

  it("leaves genuinely ambiguous shorthand alone", () => {
    // The map's own rule: a wrong expansion is worse than none. "pt" is
    // part-time or physical therapist; "cs" is customer success or computer
    // science; "tech" is a technician, a technology, or an industry.
    for (const ambiguous of ["pt", "cs", "tech"]) {
      expect(ROLE_ALIASES[ambiguous], `"${ambiguous}" is context-dependent and must stay out`).toBeUndefined();
    }
  });

  it("reports what it expanded, so the visitor is never silently rewritten", () => {
    const { expansions } = expandQuery("project mgr");
    expect(expansions.join(" ")).toContain("manager");
  });

  it("does not touch a query using advanced syntax", () => {
    // Quotes and exclusions mean the person is being precise on purpose.
    expect(expandQuery('"sales rep"').expansions).toEqual([]);
    expect(expandQuery("mgr -junior").expansions).toEqual([]);
  });
});
