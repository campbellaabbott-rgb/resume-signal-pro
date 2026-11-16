// @vitest-environment node
/**
 * BR-03 (board .102): exists answered `false` alike for a posting that closed
 * and an id the board never held (a typo, another site's id, an id from a
 * build that read the employer under a different key). A caller could not
 * tell "closed" from "not ours". The answer now names `unknown`: the asked ids
 * with neither a stored row nor a job_board_exits record. Exits prune at 90
 * days, so the word is "unknown", not "never held". When either read fails the
 * key is null, never a guess.
 *
 * This runs the SHIPPED exists block, lifted from index.ts, over in-memory
 * tables that honour the filters the block sends.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const a = FN.indexOf('    if (action === "exists") {');
const z = FN.indexOf("unknown: unknownIds });\n    }\n", a);
if (a < 0 || z < 0) throw new Error("the exists block moved; re-point this test");
const EXISTS = FN.slice(a, z + "unknown: unknownIds });\n    }\n".length);
const pf = FN.indexOf("\nfunction pastFence(");
const PAST_FENCE = FN.slice(pf + 1, FN.indexOf("\n}\n", pf) + 2);

type Table = Record<string, unknown>[];
function run(tables: Record<string, Table>, ids: unknown[], failing: string[] = []) {
  const reads: Array<{ table: string; ins: Array<[string, unknown[]]> }> = [];
  const client = {
    from: (table: string) => {
      const ins: Array<[string, unknown[]]> = [];
      const iss: Array<[string, unknown]> = [];
      let cols = "*";
      const b: Record<string, unknown> = {
        select(c: string) { cols = c; return b; },
        in(c: string, v: unknown[]) { ins.push([c, v]); return b; },
        is(c: string, v: unknown) { iss.push([c, v]); return b; },
        then(res: (v: unknown) => unknown) {
          reads.push({ table, ins });
          if (failing.includes(table)) return Promise.resolve({ data: null, error: { message: "statement timeout" } }).then(res);
          const hit = (tables[table] ?? []).filter((r) => ins.every(([c, v]) => v.includes(r[c])) && iss.every(([c, v]) => r[c] === v));
          const pick = cols.split(",").map((c) => c.trim());
          return Promise.resolve({ data: hit.map((r) => Object.fromEntries(pick.map((c) => [c, r[c]]))), error: null }).then(res);
        },
      };
      return b;
    },
  };
  const js = ts.transpileModule(`${PAST_FENCE}\nreturn (async () => {\n${EXISTS}\n})();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const go = new Function("action", "body", "client", "json", "EXISTS_ID_MAX", "FRESH_WINDOW_DAYS", js);
  return (go("exists", { ids }, client, (x: unknown) => x, 300, 30) as Promise<{ open: Record<string, boolean>; unknown: string[] | null }>)
    .then((r) => ({ ...r, reads }));
}

const NOW = Date.now();
const ago = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const TABLES = {
  job_board_postings: [
    { id: "greenhouse:acme:open", missing_since: null, effective_posted: ago(2) },
    { id: "greenhouse:acme:dropped", missing_since: ago(0.2), effective_posted: ago(5) },
    { id: "greenhouse:acme:aged", missing_since: null, effective_posted: ago(40) },
  ],
  job_board_exits: [
    { posting_id: "greenhouse:acme:closed", company_token: "acme" },
    { posting_id: "lever:other:gone", company_token: "other" },
  ],
};

describe("exists names what it never held", () => {
  it("a fake id is unknown; a closed id, a dropped row, an aged row and an open id are not", async () => {
    const ids = ["greenhouse:acme:open", "greenhouse:acme:closed", "greenhouse:acme:dropped", "greenhouse:acme:aged", "greenhouse:acme:fake", "lever:other:gone"];
    const r = await run(TABLES, ids);
    expect(r.unknown).toEqual(["greenhouse:acme:fake"]);
    expect(r.open).toEqual({
      "greenhouse:acme:open": true, "greenhouse:acme:closed": false, "greenhouse:acme:dropped": false,
      "greenhouse:acme:aged": false, "greenhouse:acme:fake": false, "lever:other:gone": false,
    });
  });

  it("an id longer than any posting id is unknown and is never put in a read", async () => {
    const long = `greenhouse:acme:${"x".repeat(400)}`;
    const r = await run(TABLES, [long, "greenhouse:acme:closed"]);
    expect(r.unknown).toEqual([long]);
    for (const read of r.reads) for (const [, v] of read.ins) expect(v).not.toContain(long);
  });

  it("the exit read is keyed by the ids' tokens, so it walks the company index and never the whole log", async () => {
    const r = await run(TABLES, ["greenhouse:acme:fake", "lever:other:gone"]);
    const exit = r.reads.find((x) => x.table === "job_board_exits");
    expect(exit?.ins).toEqual([["posting_id", ["greenhouse:acme:fake", "lever:other:gone"]], ["company_token", ["acme", "other"]]]);
  });

  it("only ids that are not open are looked for, and nothing is read past the open test when every id is open", async () => {
    const r = await run(TABLES, ["greenhouse:acme:open"]);
    expect(r.unknown).toEqual([]);
    expect(r.reads.map((x) => x.table)).toEqual(["job_board_postings"]);
  });

  it("a read that fails answers unknown null, not a guess", async () => {
    for (const t of ["job_board_exits"]) {
      const r = await run(TABLES, ["greenhouse:acme:fake", "greenhouse:acme:closed"], [t]);
      expect(r.unknown, t).toBeNull();
      expect(r.open["greenhouse:acme:closed"]).toBe(false);
    }
  });

  it("the exit read names at most five tokens: job_board_exits has no posting_id index, so six or more answer unknown null and read no exit", async () => {
    const five = ["a", "b", "c", "d", "e"].map((t) => `greenhouse:${t}:1`);
    const r5 = await run(TABLES, five);
    expect(r5.unknown).toEqual(five);
    expect(r5.reads.find((x) => x.table === "job_board_exits")?.ins[1]).toEqual(["company_token", ["a", "b", "c", "d", "e"]]);
    const six = [...five, "greenhouse:f:1"];
    const r6 = await run(TABLES, six);
    expect(r6.unknown, "past five tokens the answer does not guess").toBeNull();
    expect(r6.reads.map((x) => x.table), "and the exit log is not read").toEqual(["job_board_postings", "job_board_postings"]);
    // Many ids of one employer are one token.
    const one = Array.from({ length: 40 }, (_, i) => `greenhouse:acme:x${i}`);
    expect((await run(TABLES, one)).unknown).toEqual(one);
  });

  it("an empty ask answers an empty unknown list", async () => {
    expect((await run(TABLES, [])).unknown).toEqual([]);
  });
});
