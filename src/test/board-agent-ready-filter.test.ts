/**
 * THE RETIRED AGENT-READY FILTER NARROWS NOTHING, AND IS NAMED WHEN ASKED FOR
 * (job-board .101, audit-rest S13-118).
 *
 * The flag narrowed a search to the four vendors the worker could drive, about
 * 5% of the board. The owner retired the server-side apply agent on 2026-10-11
 * and the board's own control went, but a search saved with the flag kept being
 * mailed through that narrowing while the page it linked to showed everything.
 * Now no caller can narrow through it: a request carrying it is answered on the
 * whole board with the flag named in ignoredFilters.
 *
 * WHAT STAYS FROM THE FILTER'S LIFE: the vendor list reaches the RPCs through
 * p_sources, and two incidents still shape that. Ranking by a non-indexed
 * expression turned a 0.3s page into a 17.5s 500, so no source ORDER BY exists;
 * and a filter once reached the direct query and missed the RPCs, so this file
 * counts call sites.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeFilters, vendorSourcesParam, filterViolations, type AppliedFilters } from "../../supabase/functions/job-board/filters";
import { SENDABLE_VENDORS } from "../../supabase/functions/_shared/apply-automation";

const board = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const jobs = readFileSync(resolve(__dirname, "../pages/Jobs.tsx"), "utf8");
const DIR = resolve(__dirname, "../../supabase/migrations");
// Picks the last migration that DEFINES these functions, not merely mentions
// them. A comment naming p_sources used to win this selection — a reverted
// migration explaining the parameter was chosen over the one declaring it, and
// every assertion below failed against a file containing no SQL at all. Grep
// selectors must match the thing, not talk about it.
const mig = readdirSync(DIR).filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(resolve(DIR, f), "utf8"))
  .filter((t) => /CREATE (OR REPLACE )?FUNCTION public\.(search_jobs|count_jobs_capped)\(/.test(t)
    && t.includes("p_sources")).pop() ?? "";

const norm = (b: Record<string, unknown>) => normalizeFilters(b, 200).applied;

describe("the flag narrows nothing, for any caller", () => {
  it("leaves no trace on the filters a query is built from, whatever was sent", () => {
    for (const v of [undefined, true, false, "true", "1", 1, {}, []]) {
      const applied = norm({ sendableOnly: v });
      expect(Object.keys(applied), `${JSON.stringify(v)} must not reach the applied filters`).not.toContain("sendableOnly");
      expect(applied).toEqual(norm({}));
    }
  });

  it("a request asking for it is told the filter was not applied", () => {
    for (const v of [true, "true", 1, {}, []]) {
      expect(normalizeFilters({ sendableOnly: v } as never, 15).ignored, JSON.stringify(v)).toContain("sendableOnly");
    }
  });

  it("a request not asking for it is told nothing", () => {
    for (const body of [{}, { sendableOnly: false }, { sendableOnly: null }]) {
      expect(normalizeFilters(body as never, 15).ignored, JSON.stringify(body)).not.toContain("sendableOnly");
    }
  });
});

describe("the RPC fragment, and why it is a fragment", () => {
  it("omits the key entirely when no vendor was asked for, the flag included", () => {
    // Including p_sources (even null) against the pre-migration SQL matches no
    // signature and PostgREST 404s the WHOLE search.
    expect(vendorSourcesParam(norm({}))).toEqual({});
    expect(vendorSourcesParam(norm({ sendableOnly: true }))).toEqual({});
    expect("p_sources" in vendorSourcesParam(norm({ sendableOnly: true }))).toBe(false);
  });

  it("carries the vendors a caller did ask for", () => {
    expect(vendorSourcesParam({ vendors: ["greenhouse", "lever"] })).toEqual({ p_sources: ["greenhouse", "lever"] });
  });
});

describe("every call site, because there are four", () => {
  it("the direct query has no agent-ready branch left", () => {
    expect(board).not.toMatch(/applied\.sendableOnly/);
    expect(board).not.toMatch(/q = q\.in\("source", \[\.\.\.SENDABLE_VENDORS\]\)/);
  });

  it("all three RPC bodies spread the fragment", () => {
    // Asserts the PROPERTY, not a count. This hardcoded the number of
    // search_jobs call sites, so adding a legitimate one — the clustering
    // top-up on the ranked path — failed a guard about vendor sources
    // that the new call actually satisfies. Every call site must spread the
    // fragment; how many there are is not the contract.
    const calls = (board.match(/client\.rpc\("search_jobs", \{/g) ?? []).length;
    const withFragment = (board.match(/vendorSourcesParam\(applied\)/g) ?? []).length;
    expect(calls, "guard would be vacuous with no search_jobs calls").toBeGreaterThanOrEqual(2);
    expect(withFragment, `a search_jobs call site omits vendorSourcesParam(applied)`).toBeGreaterThanOrEqual(calls);
  });

  it("never sorts by sendability", () => {
    const code = board.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
    expect(code).not.toMatch(/\.order\("source"/);
  });
});

describe("the SQL took the list as a parameter", () => {
  it("widened BOTH functions", () => {
    expect(mig).toMatch(/CREATE FUNCTION public\.search_jobs\(/);
    expect(mig).toMatch(/CREATE FUNCTION public\.count_jobs_capped\(/);
    expect((mig.match(/p_sources text\[\] DEFAULT NULL/g) ?? []).length).toBe(2);
  });

  it("binds rather than interpolates", () => {
    expect((mig.match(/AND p\.source = ANY\(\$11\)/g) ?? []).length).toBe(2);
  });

  it("does NOT bake the vendor list into SQL", () => {
    // A vendor list in the migration is the fifth copy of SENDABLE_VENDORS,
    // and the fifth copy is the one that goes stale when adapter five lands.
    for (const v of SENDABLE_VENDORS) {
      expect(mig.includes(`'${v}'`), `${v} must not be hardcoded in the migration`).toBe(false);
    }
  });

  it("drops the old signatures before recreating — an overload would be ambiguous", () => {
    const sj = mig.indexOf("DROP FUNCTION IF EXISTS public.search_jobs");
    const cj = mig.indexOf("DROP FUNCTION IF EXISTS public.count_jobs_capped");
    expect(sj).toBeGreaterThan(-1);
    expect(cj).toBeGreaterThan(-1);
    expect(mig.indexOf("CREATE FUNCTION public.search_jobs")).toBeGreaterThan(sj);
    expect(mig.indexOf("CREATE FUNCTION public.count_jobs_capped")).toBeGreaterThan(cj);
  });

  it("renumbered the paged params past the new bind", () => {
    expect(mig).toMatch(/\$12::bigint AS total_rows/);
    expect(mig).toMatch(/LIMIT GREATEST\(LEAST\(\$13, 200\), 1\) OFFSET GREATEST\(\$14, 0\)/);
  });
});

describe("the self-check no longer knows the retired filter", () => {
  const row = (source: string, category = "engineering") => ({ source, category, token: "t" });

  it("a row from a vendor the agent never drove is no violation, even on a request carrying the flag", () => {
    const applied: AppliedFilters = norm({ sendableOnly: true });
    expect(filterViolations([row("workday")], applied)).toEqual([]);
  });

  it("says nothing when the flag was not sent", () => {
    expect(filterViolations([row("workday")], norm({}))).toEqual([]);
  });
});

describe("REGRESSION: the opt-in's own rows are not violations", () => {
  // Found while wiring the check above, one day after the two-subset pager
  // shipped: the category self-check flagged every `other` row an opted-in
  // page legitimately returns. Unsampled, that logs a false filter-integrity
  // incident on every such page — a permanent red light over a working
  // feature. Nothing had used the opt-in yet, which is the only reason the
  // incident log stayed clean.
  const base = norm({ category: "engineering", includeUncategorised: true });

  it("allows `other` when the caller opted in", () => {
    const v = filterViolations([{ source: "x", category: "other", token: "t" }], base);
    expect(v.filter((x) => x.field === "category")).toEqual([]);
  });

  it("still flags a genuinely wrong category", () => {
    const v = filterViolations([{ source: "x", category: "sales", token: "t" }], base);
    expect(v.some((x) => x.field === "category")).toBe(true);
  });

  it("still flags `other` when the caller did NOT opt in", () => {
    const strict = norm({ category: "engineering" });
    const v = filterViolations([{ source: "x", category: "other", token: "t" }], strict);
    expect(v.some((x) => x.field === "category")).toBe(true);
  });
});

describe("the board's side of the filter is retired with the apply agent", () => {
  // The board stopped offering it when the owner retired the server-side apply
  // agent (2026-10-11; pass B, 2026-10-12): applying happens through people's
  // own AIs, so no board filter narrows to the forms that agent could drive.
  const code = jobs.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

  it("the board neither reads nor writes the parameter", () => {
    expect(code).not.toMatch(/initial\.get\("agentOnly"\)/);
    expect(code).not.toMatch(/p\.set\("agentOnly"/);
  });

  it("and sends no sendableOnly at any site", () => {
    expect((code.match(/sendableOnly:/g) ?? []).length).toBe(0);
  });

  it("and no control, chip or tooltip offers it", () => {
    expect(code).not.toMatch(/agentOnlyTip|chipAgentOnly|setAgentOnly|\bagentOnly\b/);
  });
});

describe("the rescue tiers' gate", () => {
  it("derives filtersActive mechanically, so a new filter cannot be forgotten", () => {
    // The rescue tiers (fuzzy, semantic, fuzzy-augmentation) stand down when a
    // filter is active, because none of those RPCs takes filter params. That
    // gate was a hand-written list of ten fields and sendableOnly was never
    // added — so with the agent filter alone, all three fired UNFILTERED.
    // Live proof: {"q":"nurse practicioner","sendableOnly":true} returned an
    // IDENTICAL id set to the unfiltered control, with filterIntegrity
    // reporting 12 violations across 13 rows.
    const fn = readFileSync(
      resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8",
    );
    const start = fn.indexOf("const filtersActive =");
    expect(start, "filtersActive not found").toBeGreaterThan(-1);
    const body = fn.slice(start, start + 700);
    expect(
      /Object\.entries\(applied\)/.test(body),
      "filtersActive must be derived from `applied`, not hand-listed — a " +
        "conjunction that needs editing whenever a filter is added is one that " +
        "goes stale, and it already did once.",
    ).toBe(true);
  });
});
