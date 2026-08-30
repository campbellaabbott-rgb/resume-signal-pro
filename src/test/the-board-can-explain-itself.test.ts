import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * DEBUGGABILITY, made a first-class feature. Two adversarial sweeps this week
 * found their bugs by reconstructing the board's decision trace agent by
 * agent. `explain` makes that trace a single call: the parsed query, the
 * filters kept and refused, the route and retriever, the ranking regime — all
 * the inputs the serving path is about to act on, returned before any SQL runs.
 * Exposed as the MCP debug_search tool and /v1/jobs?explain=1.
 */
const BOARD = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const MCP = readFileSync(resolve(__dirname, "../../supabase/functions/agent-mcp/index.ts"), "utf8");
const API = readFileSync(resolve(__dirname, "../../supabase/functions/public-api/index.ts"), "utf8");

describe("job-board explain is a read-only trace before any search", () => {
  it("returns early on explain, before the ranked/salary/routed exits", () => {
    const idx = BOARD.indexOf("if (body.explain === true) {");
    expect(idx, "the explain branch is missing").toBeGreaterThan(-1);
    // It must sit AFTER the decision variables are computed (deepPage) and
    // BEFORE the first search exit (the salary block) — so it reports the real
    // decisions and runs no query.
    const deepPageAt = BOARD.indexOf("const deepPage = pagePlan.deepPage;");
    const salaryAt = BOARD.indexOf("A SALARY-SORTED SEARCH CAN HAVE BOTH");
    expect(idx).toBeGreaterThan(deepPageAt);
    expect(idx).toBeLessThan(salaryAt);
  });

  it("reports the four decision groups a debugger needs", () => {
    const block = BOARD.slice(BOARD.indexOf("if (body.explain === true) {"), BOARD.indexOf("if (body.explain === true) {") + 2200);
    for (const group of ["query:", "filters:", "routing:", "ranking:"]) {
      expect(block, `explain must report ${group}`).toContain(group);
    }
    // The load-bearing fields: filters kept vs refused, the ring regime, the seam.
    expect(block).toMatch(/ignored: ignoredFilters/);
    expect(block).toMatch(/rpcBlind: rpcBlindFilters\(applied\)/);
    expect(block).toMatch(/ringMerged,/);
    expect(block).toMatch(/seam: ringMerged \? RING_WINDOW : RANKED_WINDOW/);
    expect(block).toMatch(/plan: pagePlan/);
  });

  it("executes no SQL — it is a decision trace, and says so", () => {
    const block = BOARD.slice(BOARD.indexOf("if (body.explain === true) {"), BOARD.indexOf("if (body.explain === true) {") + 2400);
    expect(block, "explain must not call the RPC or a query").not.toMatch(/await client\.rpc|await buildQuery|\.range\(/);
    expect(block).toMatch(/Decision trace only/);
  });
});

describe("the MCP exposes the trace as debug_search", () => {
  it("declares the tool and dispatches it", () => {
    expect(MCP).toMatch(/name: "debug_search"/);
    expect(MCP).toMatch(/case "debug_search": return toolOk\(await runDebugSearch\(args\)\)/);
  });

  it("merges the decision trace with the real run's outcome", () => {
    expect(MCP).toMatch(/board\(\{ \.\.\.base, explain: true \}\)/);
    expect(MCP, "the outcome half must be the real run").toMatch(/board\(base\),/);
    expect(MCP).toMatch(/decision,\s*\n\s*outcome:/);
  });

  it("shares ONE body mapping between search and debug — they cannot diverge", () => {
    expect(MCP).toMatch(/function searchBody\(args: Record<string, unknown>\)/);
    expect(MCP).toMatch(/const r = await board\(searchBody\(args\)\)/);
    expect(MCP).toMatch(/const base = searchBody\(args\)/);
  });
});

describe("the API exposes an honest per-engine diagnostics block", () => {
  it("accepts explain as a param and appends diagnostics", () => {
    expect(API).toMatch(/"explain",/);
    expect(API).toMatch(/p\.get\("explain"\) === "1" \|\| p\.get\("explain"\) === "true"/);
    expect(API).toMatch(/diagnostics: \{/);
  });

  it("names its OWN engine, not the site's ranked path", () => {
    // /v1 runs a simpler engine; its explain must describe that, not borrow the
    // board's richer reasoning it does not actually run.
    expect(API).toMatch(/boundFilters:/);
    expect(API).toMatch(/countBasis:/);
    expect(API).toMatch(/This is \/v1's own simpler engine/);
  });
});
