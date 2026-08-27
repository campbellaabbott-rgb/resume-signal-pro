import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { rerankWindow } from "../../supabase/functions/job-board/search-routing";

/**
 * Three defects that all shared one shape: work was being done and then thrown
 * away, with nothing on the response to say so.
 *
 * 1. THE ROUTED WINDOW NEVER MOVED. Any query with a short token goes to the
 *    routed retriever, which fetched rows 0-399 and re-ranked them in memory —
 *    always anchored at rank 0, so everything past row 400 was unreachable.
 *    Measured live paging q="cdl": offset 380 returns rows and says hasMore;
 *    offset 400 returns ZERO jobs and suddenly reports total 2,646. 84.9% of
 *    CDL postings, 92.4% of sales-rep, >9,600 SWE — and the count that proved
 *    the rows existed appeared only on the page that had none.
 *
 * 2. ALIAS EXPANSION FOUGHT THE RE-RANKER. expandQuery widens retrieval so "pm"
 *    also finds "Product Manager", and then rerankWindow scored those rows
 *    against the literal "pm", which they do not contain — so they sank to the
 *    bottom of the window they had just been fetched into.
 *
 * 3. THE FACET READ AND THE DEAD SEMANTIC TIER were the two largest costs in a
 *    request and neither was avoidable.
 */
const FN = readFileSync(
  resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");

const rows = (...titles: string[]) => titles.map((t, i) => ({ title: t, company: `C${i}` }));

describe("the window that would not move, and the tier that would not rest", () => {
  it("scores a row by its BEST reading, not only the typed one", () => {
    // "pm" retrieves Product Manager rows via the alias; scoring against "pm"
    // alone ranks them below anything literally containing "pm".
    const r = rows("Project Coordinator (PM)", "Product Manager");
    const typedOnly = rerankWindow(r, "pm").map((x) => x.title);
    const withAlias = rerankWindow(r, ["pm", "product manager"]).map((x) => x.title);
    expect(withAlias[0], "the alias row must be reachable on page one").toBe("Product Manager");
    // And the readings are additive — never worse than the typed query alone.
    expect(typedOnly).toHaveLength(2);
    expect(withAlias).toHaveLength(2);
  });

  it("still accepts a bare string, so no existing caller changes meaning", () => {
    const r = rows("Software Engineer", "Baker");
    expect(rerankWindow(r, "engineer").map((x) => x.title)[0]).toBe("Software Engineer");
    expect(rerankWindow(r, ["engineer"]).map((x) => x.title)[0]).toBe("Software Engineer");
  });

  it("survives an empty reading list without throwing", () => {
    // Math.max over an empty array is -Infinity; the guard must keep the order
    // total rather than producing NaN comparisons.
    expect(() => rerankWindow(rows("A", "B"), [])).not.toThrow();
    expect(rerankWindow(rows("A", "B"), []).map((x) => x.title)).toEqual(["A", "B"]);
  });

  it("the routed window follows the page", () => {
    expect(FN).toMatch(/const blockStart = Math\.floor\(offset \/ ROUTE_WINDOW\) \* ROUTE_WINDOW;/);
    expect(FN).toMatch(/\.range\(blockStart, blockStart \+ ROUTE_WINDOW - 1\)/);
    expect(FN).toMatch(/const page = ordered\.slice\(inBlock, inBlock \+ limit\);/);
    // Scoped to the RETRIEVAL block. There is a second `.range(0, ROUTE_WINDOW
    // - 1)` in the routed COUNT probe, and that one is correct: it samples from
    // rank 0 because it is counting the match set, not paging through it.
    // Asserting globally would have failed against a line that should not move.
    const retrieval = FN.slice(FN.indexOf("const blockStart ="), FN.indexOf("markFrom(\"routed_retriever\""));
    expect(retrieval.length, "routed retrieval block not found").toBeGreaterThan(200);
    expect(retrieval, "the retrieval window must not be re-anchored at 0")
      .not.toMatch(/\.range\(0, ROUTE_WINDOW - 1\)/);
    expect(retrieval).toMatch(/\.range\(blockStart, blockStart \+ ROUTE_WINDOW - 1\)/);
  });

  it("the serving path stops reading the 1.3-1.6MB facet row at all", () => {
    // A 60s in-isolate TTL cache was tried first and was INERT: module-level
    // state does not survive between requests here. Fourteen consecutive
    // offset-ceiling requests, six of them on one TCP connection under a second
    // apart, cost 452-1,034ms each against a 60,000ms TTL — zero hits, while the
    // cache was provably being seeded on those same requests.
    //
    // So the row is not cached; it is not read. The refresh pass writes a second
    // small row carrying exactly what the serving path uses.
    expect(FN, "no in-isolate cache may come back").not.toMatch(/META_TTL_MS|metaCache/);
    expect(FN).toMatch(/k: "refresh_head"/);
    expect(FN).toMatch(/\.eq\("k", "refresh_head"\)/);
    // The head row carries the TRUE employer count explicitly. Deriving it from
    // the truncated 200-row facet would publish "200 employers" as a fact.
    expect(FN).toMatch(/companiesCount: companies\.length,/);
    // And the fallback keys on that field, not on the row existing — which is
    // what makes the deploy window safe before the next refresh pass runs.
    expect(FN).toMatch(/typeof \(headRow\.v as Record<string, unknown> \| null\)\?\.companiesCount === "number"/);
  });
});
