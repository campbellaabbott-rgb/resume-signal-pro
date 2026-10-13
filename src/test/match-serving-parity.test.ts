// @vitest-environment node
/**
 * RESUME-MATCH SERVES NO ROW THE BOARD WOULD NOT SERVE ON THE SAME SURFACE.
 *
 * - The mcp and v1 surfaces withhold the sources /v1 and the MCP may not
 *   redistribute. resume-match carries its own copy of that list (it may not
 *   import agent-mcp or public-api), so this test holds the three equal by
 *   reading each file's literal, comments stripped.
 * - The serving window is the board's and /v1's 30 days, held equal the same
 *   way until phase 2 moves all three into one shared module.
 * - resume-match never runs the scorer: MCP and /v1 keep calling job-fit's
 *   fit-batch on the ids it returns, in job-fit's own isolate and allowance.
 * - The base predicate itself is held equal by behaviour in
 *   match-candidates.test.ts (match_candidates against search_jobs in pglite).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { SERVER_SURFACE_EXCLUDED_SOURCES } from "../../supabase/functions/resume-match/handler";
import { FRESH_WINDOW_DAYS } from "../../supabase/functions/resume-match/pipeline";

const FN = resolve(__dirname, "../../supabase/functions");
const code = (rel: string) => codeOf(readFileSync(resolve(FN, rel), "utf8"));

function literalList(src: string, name: string): string[] {
  const m = new RegExp(`const ${name}\\s*=\\s*\\[([^\\]]*)\\]`).exec(src);
  if (!m) throw new Error(`${name} is no longer a literal list`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]).sort();
}
function literalNumber(src: string, name: string): number {
  const m = new RegExp(`const ${name}\\s*=\\s*(\\d+)\\s*;`).exec(src);
  if (!m) throw new Error(`${name} is no longer a literal number`);
  return Number(m[1]);
}

describe("the server surfaces withhold what /v1 and the MCP withhold", () => {
  it("resume-match's list equals public-api's and agent-mcp's NO_REDISTRIBUTION_SOURCES", () => {
    const mine = [...SERVER_SURFACE_EXCLUDED_SOURCES].sort();
    expect(mine).toEqual(literalList(code("public-api/index.ts"), "NO_REDISTRIBUTION_SOURCES"));
    expect(mine).toEqual(literalList(code("agent-mcp/index.ts"), "NO_REDISTRIBUTION_SOURCES"));
    expect(mine.length).toBeGreaterThan(0);
  });
  it("the handler passes the list for mcp and v1 and nothing for the site", () => {
    const h = code("resume-match/handler.ts");
    expect(h).toMatch(/excludeSources:\s*surface === "site"\s*\?\s*null\s*:\s*\[\.\.\.SERVER_SURFACE_EXCLUDED_SOURCES\]/);
    const p = code("resume-match/pipeline.ts");
    expect(p).toMatch(/p_exclude_sources:\s*opts\.excludeSources/);
  });
});

describe("the serving window", () => {
  it(`${FRESH_WINDOW_DAYS} days in resume-match, the board and /v1`, () => {
    expect(FRESH_WINDOW_DAYS).toBe(literalNumber(code("job-board/index.ts"), "FRESH_WINDOW_DAYS"));
    expect(FRESH_WINDOW_DAYS).toBe(literalNumber(code("public-api/index.ts"), "FRESH_WINDOW_DAYS"));
  });
});

describe("resume-match never runs the scorer", () => {
  it("no file of the function calls computeFit or fit-batch, and none imports fit-score directly", () => {
    const dir = resolve(FN, "resume-match");
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith("_test.ts"));
    expect(files.sort()).toEqual(["handler.ts", "index.ts", "pipeline.ts"]);
    for (const f of files) {
      const c = code(`resume-match/${f}`);
      expect(c, f).not.toMatch(/\bcomputeFit\b/);
      expect(c, f).not.toMatch(/fit-batch|functions\/v1\/job-fit/);
      expect(c, f).not.toMatch(/_shared\/fit-score/);
    }
    // posting-requirements walks the dictionary (postingTerms) and never scores.
    expect(code("_shared/posting-requirements.ts")).not.toMatch(/\bcomputeFit\s*\(/);
  });
});
