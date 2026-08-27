import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { splitExclusions, titleExcluded } from "../../supabase/functions/job-board/search-routing";

/**
 * "engineer not manager" returned managers.
 *
 * The words were dropped from the tsquery and the remainder re-read as a
 * conjunction — roughly "engineer manager", the exact opposite of the request.
 * "nurse -travel" and "driver not cdl" are the same shape, and they are ordinary
 * refinements a searcher reaches for the moment a result set is nearly right.
 */
const FN = readFileSync(
  resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");

describe("engineer not manager returned managers", () => {
  it("splits both forms a person actually types", () => {
    expect(splitExclusions("engineer not manager")).toEqual({ positive: "engineer", excluded: ["manager"] });
    expect(splitExclusions("nurse -travel")).toEqual({ positive: "nurse", excluded: ["travel"] });
    expect(splitExclusions("driver not cdl")).toEqual({ positive: "driver", excluded: ["cdl"] });
  });

  it("leaves an ordinary query completely alone", () => {
    expect(splitExclusions("software engineer")).toEqual({ positive: "software engineer", excluded: [] });
    expect(splitExclusions("")).toEqual({ positive: "", excluded: [] });
  });

  it("refuses to eat the whole query", () => {
    // Stripping everything would leave an empty query, and an empty query
    // returns the entire board — the failure the note above queryTerms warns
    // about: better to run the poor query the person typed than to ignore them.
    expect(splitExclusions("not manager")).toEqual({ positive: "not manager", excluded: [] });
    expect(splitExclusions("-manager")).toEqual({ positive: "-manager", excluded: [] });
    // A dangling "not" with nothing after it is not an exclusion either.
    expect(splitExclusions("engineer not").excluded).toEqual([]);
  });

  it("matches on word boundaries, not substrings", () => {
    expect(titleExcluded("Engineering Manager", ["manager"])).toBe(true);
    expect(titleExcluded("Senior Software Engineer", ["manager"])).toBe(false);
    // "manager" must not strike out a title that merely contains the letters.
    expect(titleExcluded("Management Consultant", ["manager"])).toBe(false);
    expect(titleExcluded("Travel Nurse", ["travel"])).toBe(true);
    expect(titleExcluded("anything", [])).toBe(false);
  });

  it("survives a term with regex metacharacters", () => {
    // The excluded term comes from a visitor. A naive RegExp build would throw
    // on "c++" and take the whole search down with it.
    expect(() => titleExcluded("C++ Developer", ["c++"])).not.toThrow();
    expect(titleExcluded("C++ Developer", ["c++"])).toBe(true);
  });

  it("is applied at the one function every posting path already calls", () => {
    // Applying it at each exit would be seven places to forget.
    expect(FN).toMatch(/excluded: readonly string\[\] = \[\],/);
    expect(FN).toMatch(/titleExcluded\(String\(\(j as \{ title\?: unknown \}\)\.title \?\? ""\), excluded\)/);
    // EXPLICIT PARAMETER, never module state: two requests can be in flight in
    // one isolate, and a leaked filter is one visitor's exclusions applied to
    // another visitor's results.
    // Scoped to serveList. The DETAIL route also calls attachRecheckedAt, for a
    // single posting fetched by id, and is deliberately exempt: exclusions have
    // no meaning when the caller has named exactly one posting, and
    // excludedTerms is not even in scope there. Counting globally would have
    // demanded a parameter where it says nothing — the guard caught that on its
    // first run, which is the right outcome for the wrong assertion.
    const listPaths = FN.slice(FN.indexOf("async function serveList("));
    const sites = (listPaths.match(/attachRecheckedAt\(client, /g) ?? []).length;
    const passed = (listPaths.match(/attachRecheckedAt\(client, [A-Za-z0-9_.]+, excludedTerms\)/g) ?? []).length;
    expect(sites, "no attachRecheckedAt calls found in serveList").toBeGreaterThan(5);
    expect(passed, "every list path must pass the exclusions").toBe(sites);
  });

  it("splits before anything is searched, and says what it removed", () => {
    // One rewrite of the request, ahead of the single filter derivation, so the
    // count probe, the facet query and the list all see the same query text.
    const split = FN.indexOf("const exclusion = splitExclusions(");
    const lift = FN.indexOf("const intentLift = liftIntentFilters(");
    expect(split).toBeGreaterThan(-1);
    expect(split, "exclusions must be split beside the intent lift").toBeLessThan(lift);
    expect(FN).toMatch(/function exclusionDisclosure\(/);
    expect((FN.match(/\.\.\.exclusionDisclosure\(excludedTerms\),/g) ?? []).length).toBe(7);
  });
});
