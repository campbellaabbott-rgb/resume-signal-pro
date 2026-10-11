// @vitest-environment node
/**
 * THE PAY REWRITE PATCHED EVERY SALARIED ROW ON EVERY VISIT (sweep S11-136).
 *
 * Wave 3 re-formats Lever and Recruitee pay text (L7-04/L7-05), so the first
 * rewrite of a stored figure is our correction and lands unlogged:
 * OUR_PAY_REWRITE in job-board/index.ts. Its test was
 * `curPay !== null && nextPay !== null`, so an UNCHANGED text counted too
 * (statesTheSameMoney(a, a) is false by design): every salaried row of those
 * vendors was patched on every visit, crowding the 1,000-corrections cap,
 * and the set had no enforced end. The decision block is cut out of index.ts
 * and run (index.ts cannot be imported: it serves at load), and a dated
 * guard fails from the removal day while the set exists.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { statesTheSameMoney } from "../../supabase/functions/job-board/normalize";
import { codeOf } from "./helpers/strip-comments";

const SRC = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const between = (from: string, to: string) => {
  const a = SRC.indexOf(from);
  const b = a < 0 ? -1 : SRC.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error("the salary decision moved in index.ts: re-point this test");
  return SRC.slice(a, b + to.length);
};
const BLOCK = between("const nextPay = (row.salary ?? null)", 'else put("salary", row.salary, prev.salary, false);');
const SET_LINE = /const OUR_PAY_REWRITE = new Set\(\[[^\]]*\]\);/.exec(SRC)?.[0] ?? "";
const FIRST_LINE = /const VENDOR_FIELD_FIRST_READ = new Set\(\[[^\]]*\]\);/.exec(SRC)?.[0] ?? "";

type Row = { salary: string | null; country?: string | null };
/** Run the shipped block: what it patches and what it logs. */
function decide(source: string, prev: Row, row: Row) {
  const js = transformSync(`${SET_LINE}\n${FIRST_LINE}\n${BLOCK}`, { loader: "ts" }).code;
  const patch: Record<string, unknown> = {};
  const logged: unknown[] = [];
  const put = (k: string, next: unknown, cur: unknown) => { if (next === null || next === undefined || next === "") return; if (next !== cur) { patch[k] = next; logged.push([k, cur, next]); } };
  new Function("row", "prev", "s", "patch", "put", "statesTheSameMoney", js)(row, prev, { source }, patch, put, statesTheSameMoney);
  return { patch, logged };
}

describe("an unchanged pay text is not rewritten", () => {
  it("the same Lever or Recruitee string patches nothing", () => {
    for (const source of ["lever", "recruitee"]) {
      const r = decide(source, { salary: "$120,000 - $150,000 per year", country: "US" }, { salary: "$120,000 - $150,000 per year", country: "US" });
      expect(r.patch, source).toEqual({});
      expect(r.logged, source).toEqual([]);
    }
  });

  it("a re-formatted text is still our correction, unlogged, inside the window", () => {
    const r = decide("lever", { salary: "$120k - $150k", country: "US" }, { salary: "$120,000 - $150,000 per year", country: "US" });
    expect(r.patch).toEqual({ salary: "$120,000 - $150,000 per year" });
    expect(r.logged).toEqual([]);
  });

  it("another vendor's changed figure is an employer edit, logged", () => {
    const r = decide("greenhouse", { salary: "$120,000", country: "US" }, { salary: "$130,000", country: "US" });
    expect(r.patch).toEqual({ salary: "$130,000" });
    expect(r.logged).toEqual([["salary", "$120,000", "$130,000"]]);
  });
});

describe("the one-shot rewrite has an enforced end", () => {
  // The day after which the set must be gone (one cold rotation after the
  // wave-3 deploy; the same day as the USAJOBS reading's own window, n444).
  const REMOVE_AFTER = "2026-11-09";
  it(`the set is removed by ${REMOVE_AFTER}`, () => {
    const today = new Date().toISOString().slice(0, 10);
    const present = /\bOUR_PAY_REWRITE\b/.test(codeOf(SRC));
    expect(today <= REMOVE_AFTER || !present, `remove the Lever/Recruitee pay rewrite from job-board/index.ts: its window closed ${REMOVE_AFTER}`).toBe(true);
  });
  it("the code names the same day beside the set", () => {
    expect(SRC).toMatch(new RegExp(`Remove after ${REMOVE_AFTER}[^\\n]*\\n[^\\n]*\\n\\s*const OUR_PAY_REWRITE`));
  });
});
