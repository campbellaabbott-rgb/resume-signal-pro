// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { transformSync } from "esbuild";
import { normalizeCloseTitle } from "../../supabase/functions/job-board/normalize";
import { codeOf } from "./helpers/strip-comments";

/**
 * A WINDOWED VISIT DELETED AGED ROWS WITHOUT THEIR EXIT ROW.
 *
 * Sweep S8-084 (2026-10-08). On a windowed board (a Workday, Oracle, iCIMS
 * or, since .92, Teamtailor board read over several visits) `vanished` holds
 * only the ids the freshness cap aged out, and every visit except the one that
 * proves a lap deleted them straight away, with no job_board_exits row. A full
 * read, or the proving visit, routes the same ids through closeVanishedChunk,
 * which writes the aged exit first and deletes only what was recorded (n416).
 * job_board_exits keeps 90 days with no rollup, so a censoring row lost here
 * is lost for good, on the largest employers.
 *
 * This runs the SHIPPED branch (from the closure-log `if` to `okKeys.push`,
 * lifted from index.ts) with the SHIPPED closeVanishedChunk and insertExits
 * over a recording stand-in for supabase-js.
 */
const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const CODE = codeOf(FN);
function lifted(name: string): string {
  const at = FN.search(new RegExp(`\\n(?:async )?function ${name}\\(`));
  expect(at, `${name} not found in job-board/index.ts`).toBeGreaterThan(-1);
  const src = FN.slice(at + 1, FN.indexOf("\n}\n", at) + 2);
  return ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
}
const branch = (() => {
  const a = FN.indexOf("        if (vanished.length && (!truncatedFetch || lapMode)) {");
  const b = FN.indexOf("        okKeys.push(boardKeyOf(s));", a);
  expect(a, "the closure-log branch moved; re-point this test").toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  return transformSync(FN.slice(a, b), { loader: "ts" }).code;
})();
const OPTIONAL = (name: string) => [...new RegExp(`const ${name} = \\[([\\s\\S]*?)\\] as const;`).exec(CODE)![1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);

type Q = { table: string; op: string; rows?: unknown; filters: Array<[string, string, unknown]> };
function fakeClient(rows: Array<Record<string, unknown>>, failExits = false) {
  const calls: Q[] = [];
  const from = (table: string) => {
    const q: Q = { table, op: "", filters: [] };
    const b: Record<string, unknown> = {
      select() { if (!q.op) q.op = "select"; return b; },
      insert(r: unknown) { q.op = "insert"; q.rows = r; return b; },
      delete() { q.op = "delete"; return b; },
      in(c: string, v: unknown) { q.filters.push(["in", c, v]); return b; },
      eq(c: string, v: unknown) { q.filters.push(["eq", c, v]); return b; },
      gt(c: string, v: unknown) { q.filters.push(["gt", c, v]); return b; },
      limit() { return b; },
      then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
        calls.push(q);
        const ids = (q.filters.find((f) => f[0] === "in" && f[1] === "id")?.[2] ?? []) as string[];
        const answer = q.table === "job_board_postings" && q.op === "select" ? { data: rows.filter((r) => ids.includes(String(r.id))), error: null }
          : q.table === "job_board_exits" && q.op === "insert" && failExits ? { data: null, error: { message: "timeout" } }
          : { data: q.table === "job_board_closures" && q.op === "select" ? [] : null, error: null };
        return Promise.resolve(answer).then(res, rej);
      },
    };
    return b;
  };
  return { client: { from }, calls };
}

const NOW = Date.parse("2026-10-08T12:00:00Z");
const OLD = new Date(NOW - 40 * 86_400_000).toISOString();
const ROWS = [1, 2, 3].map((n) => ({ id: `workday:acme~wd5~Ext:R${n}`, source: "workday", company_token: "acme~wd5~Ext", title: `Role ${n}`, category: "other", posted_at: OLD, first_seen: OLD }));

async function windowedVisit(failExits = false) {
  const fake = fakeClient(ROWS, failExits);
  const deps: Record<string, unknown> = {
    LIFECYCLE_SELECT: "*",
    EXIT_OPTIONAL_COLS: OPTIONAL("EXIT_OPTIONAL_COLS"),
    CLOSURE_OPTIONAL_COLS: OPTIONAL("CLOSURE_OPTIONAL_COLS"),
    tenureDays: () => ({ days: 40, basis: "stated" }),
    exitReasonFor: () => "aged_out",
    lifecycleFacets: () => ({}),
    normalizeCloseTitle,
    waitUntil: () => {},
    console: { warn: () => {}, log: () => {} },
  };
  const keys = Object.keys(deps);
  const helpers = new Function(...keys, `${["settleInsertError", "insertExits", "closeVanishedChunk", "dropTombstones"].filter((n) => new RegExp(`\\n(?:async )?function ${n}\\(`).test(FN)).map(lifted).join("\n")}\nreturn { closeVanishedChunk };`)(...keys.map((k) => deps[k]));
  const scope: Record<string, unknown> = {
    ...deps,
    closeVanishedChunk: helpers.closeVanishedChunk,
    client: fake.client,
    s: { source: "workday", token: "acme~wd5~Ext" },
    vanished: ROWS.map((r) => r.id),
    agedOutIds: new Set(ROWS.map((r) => r.id)),
    truncatedFetch: true,
    lapMode: false,
    rowsById: new Map(),
    nowMs: NOW,
    freshCutoffMs: NOW - 30 * 86_400_000,
    batchSuspect: false,
    absentInPass: 0,
    removableBefore: 900,
    lapBackfillUntil: "",
    missingSinceById: new Map(),
    startIso: new Date(NOW).toISOString(),
  };
  const names = Object.keys(scope);
  await new Function(...names, `return (async () => { ${branch} })();`)(...names.map((n) => scope[n]));
  return fake.calls;
}

describe("an aged row on a windowed board leaves its exit row before it is deleted", () => {
  it("every aged id deleted on a windowed visit has a job_board_exits row written first", async () => {
    const calls = await windowedVisit();
    const exits = calls.filter((c) => c.table === "job_board_exits" && c.op === "insert").flatMap((c) => c.rows as Array<{ posting_id: string; exit_reason: string }>);
    const deleted = calls.filter((c) => c.op === "delete" && c.table === "job_board_postings").flatMap((c) => (c.filters.find((f) => f[1] === "id")?.[2] ?? []) as string[]);
    expect(deleted.sort()).toEqual(ROWS.map((r) => r.id).sort());
    expect(exits.map((e) => e.posting_id).sort(), "aged rows were deleted with no exit row: a 90-day ledger with no rollup lost them").toEqual(deleted.sort());
    expect(exits.every((e) => e.exit_reason === "aged_out")).toBe(true);
    expect(calls.some((c) => c.table === "job_board_closures" && c.op === "insert"), "an age-out is never an employer takedown").toBe(false);
  });

  it("when the exit write fails the rows stay, retried next visit", async () => {
    const calls = await windowedVisit(true);
    expect(calls.filter((c) => c.op === "delete" && c.table === "job_board_postings")).toEqual([]);
  });
});
