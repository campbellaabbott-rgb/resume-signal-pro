import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";

/**
 * DEBUGGABILITY, made a first-class feature. Two adversarial sweeps this week
 * found their bugs by reconstructing the board's decision trace agent by
 * agent. `explain` makes that trace a single call: the parsed query, the
 * filters kept and refused, the route and retriever, the ranking regime — all
 * the inputs the serving path is about to act on, returned before any SQL runs.
 * Exposed as the MCP debug_search tool and /v1/jobs?explain=1.
 */
// Read with its comments gone: every assertion below is about the code, and the
// region it inspects is located by code, so that prose moving in or out of the
// file can neither satisfy nor fail it.
const BOARD = codeOf(readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8"));
const MCP = readFileSync(resolve(__dirname, "../../supabase/functions/agent-mcp/index.ts"), "utf8");
const API = readFileSync(resolve(__dirname, "../../supabase/functions/public-api/index.ts"), "utf8");

const EXPLAIN_OPENER = "if (body.explain === true) {";

/**
 * The block that `opener` starts, closed by the first `}` standing at the
 * opener's own indentation. A fixed character window used to stand in for
 * this, and once the comments between the explain branch and the salary path
 * moved out of the file the window ran on into the salary query and read that
 * query's paging call as explain's.
 */
function blockAt(code: string, opener: string): string {
  const at = code.indexOf(opener);
  if (at === -1) return "";
  const indent = code.slice(code.lastIndexOf("\n", at) + 1, at);
  const close = code.indexOf(`\n${indent}}`, at);
  return close === -1 ? code.slice(at) : code.slice(at, close + indent.length + 2);
}

describe("job-board explain is a read-only trace before any search", () => {
  it("returns early on explain, before the ranked/salary/routed exits", () => {
    const idx = BOARD.indexOf(EXPLAIN_OPENER);
    expect(idx, "the explain branch is missing").toBeGreaterThan(-1);
    // It must sit AFTER the decision variables are computed (deepPage) and
    // BEFORE the first search exit — the salary-sorted path, located by the
    // condition that opens it — so it reports the real decisions and runs no
    // query.
    const deepPageAt = BOARD.indexOf("const deepPage = pagePlan.deepPage;");
    const salaryAt = BOARD.search(/\bif \(salaryTextSort\)/);
    expect(deepPageAt, "the deepPage decision is missing").toBeGreaterThan(-1);
    expect(salaryAt, "the salary-sorted exit is missing").toBeGreaterThan(-1);
    expect(idx).toBeGreaterThan(deepPageAt);
    expect(idx).toBeLessThan(salaryAt);
  });

  it("reports the four decision groups a debugger needs", () => {
    const block = blockAt(BOARD, EXPLAIN_OPENER);
    expect(block, "the explain branch is missing").not.toBe("");
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
    const block = blockAt(BOARD, EXPLAIN_OPENER);
    expect(block, "the explain branch is missing").not.toBe("");
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
