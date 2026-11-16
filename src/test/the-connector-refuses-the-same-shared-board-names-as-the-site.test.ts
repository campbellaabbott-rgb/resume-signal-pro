import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE CONNECTOR REFUSES THE SAME SHARED BOARD NAMES AS THE SITE (M2-01).
 *
 * A board name two hiring systems carry gets no employer facts on the site
 * (src/lib/board-collisions.ts, generated from the catalogue). The MCP server
 * refuses the same tokens on employer_hiring_record and employer_growth, but
 * the platform uploads one function's folder (plus _shared), so it cannot
 * import from src/: it carries a COPY at agent-mcp/board-collisions.ts. A copy
 * is right the day it is made and wrong the day the catalogue moves, and the
 * list is regenerated with every census merge.
 *
 * WHAT THIS GUARDS. The copy is byte-identical to the original. When this
 * fails, the fix is the copy, never an edit to it:
 *
 *   cp src/lib/board-collisions.ts supabase/functions/agent-mcp/board-collisions.ts
 *
 * and the view module keeps importing the copy, not a path outside the
 * function, or the deploy cannot bundle it. Buffer equality, not string
 * equality: an encoding difference is a difference.
 */
const ROOT = resolve(__dirname, "../..");
const ORIGINAL = "src/lib/board-collisions.ts";
const COPY = "supabase/functions/agent-mcp/board-collisions.ts";

describe("the connector refuses the same shared board names as the site", () => {
  it(`${COPY} is byte-identical to ${ORIGINAL}`, () => {
    const a = readFileSync(resolve(ROOT, ORIGINAL));
    const b = readFileSync(resolve(ROOT, COPY));
    expect(a.equals(b), `${COPY} (${b.length} bytes) has drifted from ${ORIGINAL} (${a.length} bytes); run: cp ${ORIGINAL} ${COPY}`).toBe(true);
  });

  it("the view module imports the copy and the shared gate, never a path outside the function", () => {
    const src = readFileSync(resolve(ROOT, "supabase/functions/agent-mcp/hiring-record-view.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(src).toMatch(/from\s+"\.\/board-collisions\.ts"/);
    expect(src).toMatch(/from\s+"\.\.\/_shared\/hiring-record-gate\.ts"/);
    expect(src, "an import from src/ breaks the deploy bundle").not.toMatch(/from\s+"(?:\.\.\/){2,}/);
  });

  it("the server takes its shared-token test from the view module, on both employer tools", () => {
    const mcp = readFileSync(resolve(ROOT, "supabase/functions/agent-mcp/index.ts"), "utf8")
      .replace(/^\s*\/\/[^\n]*/gm, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
    expect(mcp).toMatch(/from "\.\/hiring-record-view\.ts"/);
    const growth = mcp.slice(mcp.indexOf("async function runEmployerGrowth("));
    const record = mcp.slice(mcp.indexOf("async function runEmployerHiringRecord("));
    for (const [name, body] of [["runEmployerGrowth", growth], ["runEmployerHiringRecord", record]] as const) {
      expect(body.slice(0, body.indexOf("\n}\n")), name).toMatch(/sharedTokenBoards\(/);
    }
  });

  it("TEETH: a copy one byte off is caught", () => {
    const a = readFileSync(resolve(ROOT, ORIGINAL));
    const off = Buffer.concat([a, Buffer.from(" ")]);
    expect(a.equals(off)).toBe(false);
  });
});
