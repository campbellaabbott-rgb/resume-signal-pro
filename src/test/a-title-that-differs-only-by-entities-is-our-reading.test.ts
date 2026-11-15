// @vitest-environment node
/**
 * S14X-216, index half (board .102): Teamtailor and Personio titles were
 * stored with their XML entities still encoded ('R&amp;D Engineer'). The
 * normalize half reads titles and departments through xmlText, so the next
 * visit reads 'R&D Engineer', and every such row would have logged a title
 * "edit" to job_board_field_changes that the employer never made. A stored
 * value that differs from the new reading only by HTML entities is our
 * reading changing: the row is patched, the change is not logged. The
 * comparison is normalize's own unescapeEntities.
 *
 * Runs the shipped note() closure, lifted from index.ts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { unescapeEntities } from "../../supabase/functions/job-board/normalize";
import { sameButApostrophes } from "../../supabase/functions/job-board/typed-text";

const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const a = FN.indexOf("          const note = (field: string, oldV: unknown, newV: unknown) => {");
if (a < 0) throw new Error("note() moved; re-point this test");
const NOTE = FN.slice(a, FN.indexOf("\n          };\n", a) + "\n          };\n".length);

function logged(field: string, oldV: unknown, newV: unknown, source = "teamtailor"): number {
  const changeLog: unknown[] = [];
  const js = ts.transpileModule(`${NOTE}\nnote(field, oldV, newV);`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("field", "oldV", "newV", "s", "id", "changeLog", "corrections", "logMark", "capped", "changeAt",
    "DERIVED_NOT_EMPLOYER_EDITS", "OUR_READING_CHANGED", "FIELD_CHANGES_PER_VISIT", "sameButApostrophes", "unescapeEntities", js)(
    field, oldV, newV, { source, token: "acme" }, "teamtailor:acme:1", changeLog, [], 0, (v: unknown) => v, "2026-11-15T00:00:00Z",
    new Set(["region_code", "country"]), new Set<string>(), 500, sameButApostrophes, unescapeEntities,
  );
  return changeLog.length;
}

describe("a title that differs only by entities is our reading", () => {
  it("'R&amp;D Engineer' read again as 'R&D Engineer' is not logged", () => {
    expect(logged("title", "R&amp;D Engineer", "R&D Engineer")).toBe(0);
    expect(logged("title", "Sales &#8211; EMEA", "Sales – EMEA")).toBe(0);
    expect(logged("department", "Research &amp; Development", "Research & Development")).toBe(0);
  });

  it("a real edit is still logged, entities or not", () => {
    expect(logged("title", "R&amp;D Engineer", "Senior R&D Engineer")).toBe(1);
    expect(logged("title", "Engineer", "Senior Engineer")).toBe(1);
  });

  it("a value that was null or is not text is compared as before", () => {
    expect(logged("title", null, "R&D Engineer")).toBe(1);
    expect(logged("salary_min_annual", 50_000, 60_000)).toBe(1);
  });

  it("the comparison is normalize's own unescapeEntities, imported, not a copy", () => {
    expect(FN).toMatch(/\n  unescapeEntities,\n\} from "\.\/normalize\.ts";/);
    expect(NOTE).toMatch(/unescapeEntities\(oldV\) === unescapeEntities\(newV\)\) return;/);
  });
});
