import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * AN AGENT COULD FILTER BY CITY AND A DEVELOPER'S CODE COULD NOT.
 *
 * agent-mcp and public-api are two doors onto the same board, and they drifted.
 * Measured 2026-09-02: MCP's search_jobs accepted twenty filters including
 * location, employmentType, maxYears, hasStatedPay, payBasis, maxAgeDays,
 * agentReadyOnly and sort; /v1/jobs answered `400 unknown_parameter` to every
 * one of them. Same board underneath, same capability, different exposure —
 * and nothing failed, because each surface was tested only against itself.
 *
 * The drift is the thing to catch, not the eight names. A filter added to the
 * agent surface and not the developer surface is a decision someone should make
 * deliberately; this test makes them make it.
 *
 * The escape hatch is deliberate and narrow: RANKED_ONLY names params the
 * DEFAULT /v1 engine refuses on purpose, because it cannot ask the board's
 * question honestly — location needs the board's metro alias expansion, and
 * sort would invalidate the keyset cursor the default engine pages by. They are
 * still accepted by /v1 (engine=ranked serves them), so they belong in
 * JOBS_PARAMS; what they must never do is silently answer a narrower question.
 */
const ROOT = resolve(__dirname, "../..");
const MCP = readFileSync(resolve(ROOT, "supabase/functions/agent-mcp/index.ts"), "utf8");
const API = readFileSync(resolve(ROOT, "supabase/functions/public-api/index.ts"), "utf8");

/** The board keys MCP's searchBody reads off its args, i.e. its real filter set. */
function mcpFilters(): string[] {
  const i = MCP.indexOf("function searchBody");
  const body = MCP.slice(i, MCP.indexOf("\n}", i));
  return [...new Set([...body.matchAll(/args\.([A-Za-z]+)/g)].map((m) => m[1]))];
}

/** The params /v1/jobs accepts. */
function v1Params(): string[] {
  const i = API.indexOf("const JOBS_PARAMS");
  const arr = API.slice(i, API.indexOf("] as const;", i));
  return [...new Set([...arr.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]))];
}

const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
/** MCP arg name -> /v1 param name, where the two surfaces named it differently. */
const RENAMED: Record<string, string> = {
  query: "q", vendor: "source", salaryMin: "salary_min", salaryMax: "salary_max",
  agentReadyOnly: "agent_ready_only", workMode: "work_mode",
};
/** Paging/shape, not filters. */
const NOT_A_FILTER = new Set(["limit", "offset"]);

describe("two doors onto one board", () => {
  it("locates both filter sets", () => {
    expect(mcpFilters().length, "searchBody not parsed").toBeGreaterThan(15);
    expect(v1Params().length, "JOBS_PARAMS not parsed").toBeGreaterThan(20);
  });

  it("every filter the agent surface accepts, the developer surface accepts too", () => {
    const v1 = new Set(v1Params());
    const missing = mcpFilters()
      .filter((a) => !NOT_A_FILTER.has(a))
      .map((a) => RENAMED[a] ?? snake(a))
      .filter((name) => !v1.has(name));
    expect(
      missing,
      "MCP exposes these and /v1 does not — an AI agent can ask for something a " +
        "developer's own code cannot. Add them to JOBS_PARAMS and map them, or " +
        "decide deliberately that /v1 should not carry them.",
    ).toEqual([]);
  });

  it("the eight that closed the 2026-09-02 gap are still there", () => {
    const v1 = new Set(v1Params());
    for (const p of ["location", "employment_type", "max_years", "has_stated_pay",
                     "pay_basis", "max_age_days", "agent_ready_only", "sort"]) {
      expect(v1.has(p), `/v1 lost ${p} — the MCP parity gap has reopened`).toBe(true);
    }
  });

  it("refuses, rather than approximates, what the default engine cannot ask honestly", () => {
    // Both refusals must NAME the ranked engine, so a caller is told where the
    // filter does work instead of being left with a bare rejection.
    for (const p of ["location", "sort"]) {
      const m = new RegExp(`if \\(p\\.get\\("${p}"\\)\\) \\{[\\s\\S]{0,600}?engine=ranked`);
      expect(API, `the default engine must refuse ${p} and point at engine=ranked`).toMatch(m);
    }
    expect(API, "a literal location match would answer a narrower question under the same name")
      .not.toMatch(/qb\.ilike\("location"/);
  });

  it("mirrors the board's own column semantics rather than inventing new ones", () => {
    // Each of these is copied from job-board's buildQuery. If the board changes
    // how it reads one, /v1 must change with it or the two disagree.
    expect(API).toMatch(/qb\.not\("salary_min_annual", "is", null\)/);
    expect(API).toMatch(/qb\.eq\("salary_period", "hour"\)/);
    expect(API).toMatch(/qb\.in\("salary_period", \["year", "month"\]\)/);
    expect(API).toMatch(/qb\.lte\("min_years", maxYears\)/);
    expect(API).toMatch(/qb\.in\("source", \[\.\.\.SENDABLE_VENDORS\]\)/);
  });
});
