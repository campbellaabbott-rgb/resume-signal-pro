// @vitest-environment node
/**
 * Board .102: the cold wrap stamps its own length (cold_rotation.wrapMin, the
 * minutes since the previous wrap's completedAt) and status never published
 * it. Section 90 already reads `st.lastWrapMin` first and fell back to a
 * ledger it fills by sampling, so "no completed wrap is readable" was the
 * verifier's line on every build. Status now carries lastWrapMin (null when
 * the wrap could not stamp one) and lastWrapAt, from the row the wrap writes.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const status = FN.slice(FN.indexOf('if (action === "status") {'));
const line = (src: string, re: RegExp) => { const m = re.exec(src); if (!m) throw new Error(`${re} moved; re-point this test`); return m[0]; };
const ROT = line(status, /const rotV = \(rot\.data\?\.v \?\? \{\}\) as [^;]*;/);
const KEYS = line(status, /lastWrapMin: [^\n]*\n\s*lastWrapAt: [^\n]*\n/);

const read = (rot: { data: { v?: unknown; updated_at?: string } | null }) => new Function("rot",
  ts.transpileModule(`${ROT}\nreturn { ${KEYS} };`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
)(rot) as { lastWrapMin: number | null; lastWrapAt: string | null };

describe("the wrap is readable from status", () => {
  it("a wrap that stamped its length is published as lastWrapMin and lastWrapAt", () => {
    expect(read({ data: { v: { completedAt: "2026-11-15T03:00:00.000Z", coldBoards: 44_000, wrapMin: 1_312 } } }))
      .toEqual({ lastWrapMin: 1_312, lastWrapAt: "2026-11-15T03:00:00.000Z" });
  });

  it("a wrap that could not stamp its length reads null, never a guess from updated_at", () => {
    expect(read({ data: { v: { completedAt: "2026-11-15T03:00:00.000Z" }, updated_at: "2026-11-15T04:00:00.000Z" } }))
      .toEqual({ lastWrapMin: null, lastWrapAt: "2026-11-15T03:00:00.000Z" });
    expect(read({ data: null })).toEqual({ lastWrapMin: null, lastWrapAt: null });
  });

  it("the row it reads is the one the cold wrap writes", () => {
    expect(FN).toMatch(/k: "cold_rotation",\n\s*v: \{ completedAt: new Date\(\)\.toISOString\(\), coldBoards: COLD_LIST\.length, \.\.\.\(wrapMin !== null \? \{ wrapMin \} : \{\}\) \},/);
    expect(status).toMatch(/client\.from\("job_board_meta"\)\.select\("v, updated_at"\)\.eq\("k", "cold_rotation"\)\.maybeSingle\(\),/);
  });
});
