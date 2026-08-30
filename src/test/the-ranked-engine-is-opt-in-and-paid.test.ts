import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * /v1/jobs keeps its cheap default engine (title/company websearch, keyset
 * paging, flat latency) and offers the site's full ranked/rescue engine as a
 * PAID opt-in. The default is untouched; the ranked path is a translator over
 * the same job-board engine the site and MCP use — no second search
 * implementation, and every honesty disclosure passed through.
 */
const API = readFileSync(resolve(__dirname, "../../supabase/functions/public-api/index.ts"), "utf8");

describe("the ranked engine is opt-in and paid", () => {
  it("engine is an allowed param, validated to simple|ranked", () => {
    expect(API).toMatch(/"engine",/);
    expect(API).toMatch(/engine must be "simple" \(default\) or "ranked"/);
  });

  it("ranked is gated to the paid tier, default stays open", () => {
    expect(API).toMatch(/const paid = tier != null && tier !== "free" && tier !== "trial";/);
    expect(API).toMatch(/402, "upgrade_required"/);
    // The default engine must be reachable BEFORE any ranked branch — the
    // ranked check returns early, leaving the rest of listJobs the default.
    const engineAt = API.indexOf('engine === "ranked"');
    const baseQueryAt = API.indexOf("const baseQuery = (opts:");
    expect(engineAt).toBeGreaterThan(-1);
    expect(engineAt).toBeLessThan(baseQueryAt);
  });

  it("routes through the board engine, not a second implementation", () => {
    expect(API).toMatch(/function board\(body: Record<string, unknown>\)/);
    expect(API).toMatch(/functions\/v1\/job-board/);
    expect(API).toMatch(/action: "list", limit, offset, includeFacets: false/);
  });

  it("refuses what the ranked engine cannot do, rather than dropping it silently", () => {
    expect(API, "ranked pages by offset, not cursor").toMatch(/engine=ranked pages by offset, not cursor/);
    expect(API, "the board has no posted_before").toMatch(/engine=ranked has no posted_before filter/);
  });

  it("maps board rows to the /v1 field contract, first_seen honestly null", () => {
    expect(API).toMatch(/company_token: j\.token/);
    expect(API).toMatch(/work_mode: j\.workMode/);
    expect(API).toMatch(/first_seen: null/);
  });

  it("passes the board's honesty disclosures through verbatim", () => {
    expect(API).toMatch(/"ignoredFilters", "excludedTerms", "intentFilters", "aliases", "didYouMean", "searchRoute", "coverage", "salaryStatedOnly"/);
  });

  it("names the engine and a keyset-independent count basis on the envelope", () => {
    expect(API).toMatch(/engine: "ranked"/);
    expect(API).toMatch(/basis: r\.countUnavailable === true \? "unavailable"/);
  });
});

describe("the headline count survives a text query", () => {
  it("falls back to planned when estimated fails, and never publishes a bare null", () => {
    // MEASURED LIVE the hour engine=ranked shipped: total.value was a number
    // for every filter-only query and NULL for EVERY text query. PostgREST's
    // `estimated` returns the planner figure only while it is ABOVE a
    // threshold; a websearch tsquery plans small, so it escalated to a real
    // count over ~575k rows and hit the statement timeout. `planned` cannot
    // escalate, so it cannot time out — it is the fallback, and the basis says
    // which one answered.
    expect(API).toMatch(/count: "planned", head: true/);
    expect(API).toMatch(/countBasis: "estimated" \| "planned" \| "unavailable"/);
    expect(API, "the envelope must report the basis that actually answered")
      .toMatch(/total: \{ value: count, basis: countBasis \}/);
    expect(API, "a hardcoded basis is a claim the count cannot back")
      .not.toMatch(/basis: "estimated" \}/);
  });

  it("baseQuery accepts both count modes, so the fallback can use it", () => {
    expect(API).toMatch(/count\?: "estimated" \| "planned"/);
  });
});
