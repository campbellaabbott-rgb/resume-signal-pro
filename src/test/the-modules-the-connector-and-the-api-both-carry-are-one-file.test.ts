// @vitest-environment node
/**
 * COUNTRY-NAMES.TS, BOARD-PAGE-FILL.TS AND FEED-FRESHNESS.TS ARE BYTE-IDENTICAL
 * UNDER agent-mcp AND public-api, AND NEITHER FUNCTION IMPORTS THE OTHER'S
 * FOLDER (lane fix/1121-connector-errors).
 *
 * The connector and the data API read a country name, fill a thinned page and
 * say how fresh the data is by the same rules. A shared module would cost
 * job-board's upload room (every _shared file is bundled by the board too), so
 * each function carries its own copy, and this test is what keeps the two one
 * file: a fix made in one copy and not the other fails here.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const FN = resolve(__dirname, "../../supabase/functions");
const read = (rel: string) => readFileSync(resolve(FN, rel), "utf8");
const MODULES = ["country-names.ts", "board-page-fill.ts", "feed-freshness.ts"] as const;
const importsOf = (src: string) => [...src.matchAll(/^\s*(?:import|export)\b[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]);

describe("the copies are one file", () => {
  it.each(MODULES)("%s is byte-identical in agent-mcp and public-api", (name) => {
    const mcp = read(`agent-mcp/${name}`);
    const api = read(`public-api/${name}`);
    expect(mcp.length).toBeGreaterThan(0);
    expect(api).toBe(mcp);
  });
  it.each(MODULES)("%s imports nothing at all, so a copy cannot reach either folder", (name) => {
    expect(importsOf(read(`agent-mcp/${name}`))).toEqual([]);
  });
});

describe("neither function imports the other's folder", () => {
  const files = (fn: string) => ["index.ts", ...MODULES].map((m) => `${fn}/${m}`);
  it("agent-mcp reads none of public-api, and public-api none of agent-mcp", () => {
    for (const f of files("agent-mcp")) for (const i of importsOf(read(f))) expect(i, f).not.toMatch(/public-api\//);
    for (const f of files("public-api")) for (const i of importsOf(read(f))) expect(i, f).not.toMatch(/agent-mcp\//);
  });
  it("each index imports its own copy of all three", () => {
    for (const fn of ["agent-mcp", "public-api"]) {
      const imports = importsOf(read(`${fn}/index.ts`));
      for (const m of MODULES) expect(imports, `${fn} -> ${m}`).toContain(`./${m}`);
    }
  });
});
