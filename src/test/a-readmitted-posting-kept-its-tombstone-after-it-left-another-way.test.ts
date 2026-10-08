// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { normalizeCloseTitle } from "../../supabase/functions/job-board/normalize";
import { splitTombstoned } from "../../supabase/functions/job-board/tombstone";
import { codeOf } from "./helpers/strip-comments";

/**
 * A READMITTED POSTING KEPT ITS TOMBSTONE AFTER IT LEFT ANOTHER WAY.
 *
 * Sweep S8-085 (2026-10-08). A posting that aged out leaves a tombstone in
 * job_board_aged_out; when the feed re-dates it the posting is re-admitted and
 * the tombstone MOVED to the new date, never deleted (deleting it there
 * reopens the Workday betterDate loop, n412). If that posting then left by a
 * closure or a board prune, the moved tombstone stayed, and the same id
 * relisted on an unchanged date was refused for up to 180 days. Wave 2 (.91,
 * n427) let such a row back on every vendor whose stored date never moves;
 * Workday's date does move, so on Workday the refusal stood.
 *
 * This runs the SHIPPED closeVanishedChunk and pruneWholeBoard (lifted from
 * index.ts with whatever they call today) over a recording stand-in for
 * supabase-js.
 */
const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const CODE = codeOf(FN);
const has = (name: string) => new RegExp(`\\n(?:async )?function ${name}\\(`).test(FN);
function lifted(name: string): string {
  const at = FN.search(new RegExp(`\\n(?:async )?function ${name}\\(`));
  expect(at, `${name} not found in job-board/index.ts`).toBeGreaterThan(-1);
  const src = FN.slice(at + 1, FN.indexOf("\n}\n", at) + 2);
  return ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
}
const OPTIONAL = (name: string) => [...new RegExp(`const ${name} = \\[([\\s\\S]*?)\\] as const;`).exec(CODE)![1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);

type Q = { table: string; op: string; rows?: unknown; filters: Array<[string, string, unknown]>; range?: [number, number] };
function fakeClient(postings: Array<Record<string, unknown>>) {
  const calls: Q[] = [];
  const from = (table: string) => {
    const q: Q = { table, op: "", filters: [] };
    const b: Record<string, unknown> = {
      select() { if (!q.op) q.op = "select"; return b; },
      insert(r: unknown) { q.op = "insert"; q.rows = r; return b; },
      delete() { q.op = "delete"; return b; },
      in(c: string, v: unknown) { q.filters.push(["in", c, v]); return b; },
      eq(c: string, v: unknown) { q.filters.push(["eq", c, v]); return b; },
      match(o: Record<string, unknown>) { for (const [k, v] of Object.entries(o)) q.filters.push(["eq", k, v]); return b; },
      order() { return b; },
      range(a: number, z: number) { q.range = [a, z]; return b; },
      then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
        calls.push(q);
        let data: unknown = null;
        if (q.table === "job_board_postings" && q.op === "select") {
          const ids = q.filters.find((f) => f[0] === "in" && f[1] === "id")?.[2] as string[] | undefined;
          data = ids ? postings.filter((p) => ids.includes(String(p.id))) : (q.range?.[0] ?? 0) === 0 ? postings : [];
        }
        return Promise.resolve({ data, error: null }).then(res, rej);
      },
    };
    return b;
  };
  return { client: { from }, calls };
}
const dropped = (calls: Q[]) => calls.filter((c) => c.table === "job_board_aged_out" && c.op === "delete")
  .flatMap((c) => (c.filters.find((f) => f[1] === "id")?.[2] ?? []) as string[]);

function shipped(names: string[]) {
  const background: Promise<unknown>[] = [];
  const deps: Record<string, unknown> = {
    LIFECYCLE_SELECT: "*",
    EXIT_OPTIONAL_COLS: OPTIONAL("EXIT_OPTIONAL_COLS"),
    CLOSURE_OPTIONAL_COLS: OPTIONAL("CLOSURE_OPTIONAL_COLS"),
    tenureDays: () => ({ days: 9, basis: "stated" }),
    exitReasonFor: () => "aged_out",
    lifecycleFacets: () => ({}),
    normalizeCloseTitle,
    waitUntil: (p: Promise<unknown>) => { background.push(p); },
    console: { warn: () => {}, log: () => {} },
  };
  const keys = Object.keys(deps);
  const fns = new Function(...keys, `${[...names, "dropTombstones"].filter(has).map(lifted).join("\n")}\nreturn { ${names.join(", ")} };`)(...keys.map((k) => deps[k]));
  return { fns, settle: () => Promise.all(background) };
}

const NOW = Date.parse("2026-10-08T12:00:00Z");
const FRESH = new Date(NOW - 9 * 86_400_000).toISOString();
const OLD = new Date(NOW - 40 * 86_400_000).toISOString();
const READMITTED = { id: "workday:acme~wd5~Ext:R7", source: "workday", company_token: "acme~wd5~Ext", title: "Teller", category: "other", posted_at: FRESH, first_seen: FRESH };
const AGED = { id: "workday:acme~wd5~Ext:R8", source: "workday", company_token: "acme~wd5~Ext", title: "Clerk", category: "other", posted_at: OLD, first_seen: OLD };

describe("a posting that leaves by a closure or a prune takes its tombstone with it", () => {
  it("why it matters: on Workday the moved tombstone refuses the same id relisted on its date", () => {
    const cutoff = NOW - 30 * 86_400_000;
    const tomb = { id: READMITTED.id, posted_at: FRESH, aged_at: OLD };
    expect(splitTombstoned([{ id: READMITTED.id, source: "workday", posted_at: FRESH }], [tomb], { cutoffMs: cutoff }).refused.has(READMITTED.id)).toBe(true);
  });

  it("a closure drops the closed posting's tombstone; an age-out keeps its own", async () => {
    const { fns, settle } = shipped(["settleInsertError", "insertExits", "closeVanishedChunk"]);
    const fake = fakeClient([READMITTED, AGED]);
    const gone = await fns.closeVanishedChunk(fake.client, { source: "workday", token: "acme~wd5~Ext" }, [READMITTED.id, AGED.id], {
      closedAt: new Date(NOW).toISOString(), agedOutIds: new Set<string>(), freshCutoffMs: NOW - 30 * 86_400_000,
      liveTitles: new Set<string>(), recentSuperseded: new Set<string>(), batchSuspect: false,
      absentInPass: 1, removableBefore: 50, lapMode: false, lapBackfillUntil: "", missingSinceById: new Map(), startIso: new Date(NOW).toISOString(),
    });
    await settle();
    expect(gone.sort()).toEqual([READMITTED.id, AGED.id].sort());
    expect(dropped(fake.calls), "the closed posting's tombstone outlived it and refuses its relisting").toEqual([READMITTED.id]);
  });

  it("a board prune drops the tombstones of every posting it logged and deleted", async () => {
    const { fns, settle } = shipped(["settleInsertError", "insertExits", "logWholeBoardExit", "pruneWholeBoard"]);
    const fake = fakeClient([READMITTED, AGED]);
    expect(await fns.pruneWholeBoard(fake.client, "acme~wd5~Ext", "board_dormant", "workday")).toEqual({ logged: 2, complete: true });
    await settle();
    expect(dropped(fake.calls).sort()).toEqual([READMITTED.id, AGED.id].sort());
  });
});
