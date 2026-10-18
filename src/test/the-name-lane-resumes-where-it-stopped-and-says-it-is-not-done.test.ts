/**
 * THE NAME LANE RESUMES WHERE IT STOPPED, AND SAYS IT IS NOT DONE (S12-015,
 * S12-084, S12-125; job-board .93, wave 4 round 2).
 *
 * .93 made the name-sync lane its own pass-end step on its own 90-second
 * clock, but the lane still walked every token from the first one each pass:
 * it re-read the 444 boards it had already renamed, two reads each, ran out
 * of clock before the m's, and Loblaw's tenant still read "Myview" on 7,312
 * rows. And the step answered ok:true whatever it did, so the receipt the
 * verifier reads stayed green while renames crawled.
 *
 * Now name_sync_progress keeps the last token finished and the tokens whose
 * rename failed; the next hop retries those first and resumes after the
 * other; a step its clock stopped answers ok:false with stop "clock" and runs
 * again (up to PASS_END_NAME_HOPS a pass); the receipt says how far it got.
 *
 * S12-125 (a finished tail wrote its whole run into slice_stats) was fixed by
 * .93's hops: no step function reads recordSliceStats. That is pinned here.
 *
 * passEndNames RUNS here, lifted from job-board/index.ts with the TypeScript
 * parser; every name it reads is bound below or the lift throws.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { nameSyncQueue } from "../../supabase/functions/job-board/name-sync";
import { nextPassEndStep, PASS_END_NAME_HOPS } from "../../supabase/functions/job-board/pass-end";

const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const SF = ts.createSourceFile("index.ts", FN, ts.ScriptTarget.ES2022, true);
const fnNode = (name: string) => SF.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === name) as ts.FunctionDeclaration;

function lift(name: string): (scope: Record<string, unknown>) => (...a: unknown[]) => Promise<Record<string, unknown>> {
  const js = ts.transpileModule(`${fnNode(name).getText(SF)}\nreturn ${name};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const make = new Function("__scope", `with (__scope) { return (function(){ ${js} })(); }`);
  return (deps) => make(new Proxy(deps, {
    has: (_t, k) => typeof k === "string" && (k in deps || !(k in globalThis)),
    get: (_t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (typeof k === "string" && k in deps) return deps[k];
      throw new Error(`passEndNames reads \`${String(k)}\`, which this test does not bind`);
    },
  }));
}
const passEndNames = lift("passEndNames");

type Meta = Record<string, unknown>;
/** A board world: `tokens` boards, each with stale rows until renamed; every database call costs `costMs` of the fake clock. */
function world(tokens: string[], opts: { costMs?: number; failing?: Set<string>; meta?: Meta } = {}) {
  let now = 1_000_000;
  const meta: Meta = { ...(opts.meta ?? {}) };
  const renamed = new Set<string>();
  const reads: string[] = [];
  const cost = opts.costMs ?? 1_000;
  class FakeDate extends Date {
    constructor(...a: unknown[]) { super(...((a.length ? a : [now]) as [number])); }
    static now() { return now; }
  }
  const chain = (table: string) => {
    let k = "", tok = "", op = "select";
    const q: Record<string, unknown> = {
      select: () => q, like: () => q, limit: () => q, neq: () => q,
      eq: (c: string, v: string) => { if (c === "k") k = v; if (c === "company_token") tok = v; return q; },
      update: () => { op = "update"; return q; },
      delete: () => { op = "delete"; return q; },
      upsert: (row: { k: string; v: unknown }) => { meta[row.k] = row.v; return Promise.resolve({ error: null }); },
      maybeSingle: async () => ({ data: k in meta ? { v: meta[k] } : null }),
      then: (ok: (v: unknown) => unknown) => {
        now += cost;
        if (table === "job_board_meta" && op === "delete") delete meta[k];
        if (table === "job_board_postings" && op === "select" && tok) reads.push(tok);
        if (op === "update" && tok) {
          if (opts.failing?.has(tok)) return Promise.resolve({ error: { message: "statement timeout" } }).then(ok);
          renamed.add(tok);
        }
        const stale = !renamed.has(tok);
        return Promise.resolve({ data: op === "select" && tok && stale ? [{ company_token: tok }] : [], error: null }).then(ok);
      },
    };
    return q;
  };
  const deps = {
    client: { from: chain },
    Date: FakeDate,
    NAME_SYNC_VERSION: 4,
    NAME_SYNC_UNTIL_MS: 90_000,
    RENAMED_TOKENS: [],
    JOB_SOURCES: tokens.map((t) => ({ source: "workday", token: t, name: t.toUpperCase() })),
    SHARED_TOKENS: new Set<string>(),
    overrideTable: () => new Map(tokens.map((t) => [t, `Name of ${t}`])),
    overrideFor: (t: string) => `Name of ${t}`,
    nameSyncTarget: (s: { token: string }) => `Name of ${s.token}`,
    nameSyncQueue,
    console: { log: () => {}, warn: () => {} },
  };
  return { deps, meta, reads, renamed, start: () => now };
}

const TOKENS = Array.from({ length: 30 }, (_, i) => `t${String(i).padStart(2, "0")}`);

describe("the name-sync step resumes and reports (S12-015, S12-084)", () => {
  it("a hop its clock stops answers ok:false with stop clock, and keeps where it got to", async () => {
    const w = world(TOKENS);
    const r = await passEndNames(w.deps)(w.deps.client, w.start());
    expect(r.ok, JSON.stringify(r)).toBe(false);
    expect(r.stop).toBe("clock");
    expect(String(r.detail)).toMatch(/renamed, \d+ already correct, 0 failed, \d+ waiting \(resumes after t\d\d\)/);
    const prog = w.meta.name_sync_progress as { after: string; version: number };
    expect(prog.version).toBe(4);
    expect(TOKENS).toContain(prog.after);
    expect(w.meta.name_sync_version, "no stamp while boards wait").toBeUndefined();
    expect(nextPassEndStep("names", { stop: String(r.stop), hops: 1 }), "it runs again this pass").toBe("names");
    expect(nextPassEndStep("names", { stop: "clock", hops: PASS_END_NAME_HOPS }), "within its hops").toBeNull();
    expect(nextPassEndStep("names", { stop: "done", hops: 1 })).toBeNull();
  });

  it("the next hop never re-reads a board it finished, and the walk ends stamped and green", async () => {
    const w = world(TOKENS);
    const first = await passEndNames(w.deps)(w.deps.client, w.start());
    const after = (w.meta.name_sync_progress as { after: string }).after;
    const finished = new Set(w.reads);
    w.reads.length = 0;
    let r = first;
    for (let hop = 0; hop < 10 && r.stop === "clock"; hop++) r = await passEndNames(w.deps)(w.deps.client, w.start());
    expect(w.reads.filter((t) => t <= after), "boards finished on the first hop were read again").toEqual([]);
    expect(finished.size).toBeGreaterThan(0);
    expect(r).toMatchObject({ ok: true, stop: "done" });
    expect((w.meta.name_sync_version as { version: number }).version).toBe(4);
    expect(w.meta.name_sync_progress, "the progress row goes with the stamp").toBeUndefined();
    expect(w.renamed.size).toBe(TOKENS.length);
  });

  it("a board whose rename failed is retried first by the next hop, and the lane is not stamped over it", async () => {
    const w = world(TOKENS.slice(0, 5), { costMs: 10, failing: new Set(["t02"]) });
    const r = await passEndNames(w.deps)(w.deps.client, w.start());
    expect(r).toMatchObject({ ok: false, stop: "failed" });
    expect((w.meta.name_sync_progress as { retry: string[] }).retry).toEqual(["t02"]);
    expect(w.meta.name_sync_version).toBeUndefined();
    expect(nameSyncQueue(TOKENS.slice(0, 5), w.meta.name_sync_progress as never, 4).tokens, "only the failed board is left").toEqual(["t02"]);
  });

  it("a progress row from older rules is not trusted", () => {
    expect(nameSyncQueue(["a", "b", "c"], { version: 3, after: "b", retry: [] }, 4).tokens).toEqual(["a", "b", "c"]);
    expect(nameSyncQueue(["a", "b", "c"], { version: 4, after: "b", retry: ["a", "zz"] }, 4).tokens).toEqual(["a", "c"]);
  });

  it("a lane already stamped answers green at once", async () => {
    const w = world(TOKENS, { meta: { name_sync_version: { version: 4 } } });
    expect(await passEndNames(w.deps)(w.deps.client, w.start())).toMatchObject({ ok: true, stop: "done" });
    expect(w.reads).toEqual([]);
  });
});

describe("a finished tail stays out of slice_stats (S12-125, fixed by .93's hops)", () => {
  it("no pass-end step function reads recordSliceStats", () => {
    const reads = (name: string) => {
      const found: string[] = [];
      const visit = (n: ts.Node) => { if (ts.isIdentifier(n) && n.text === "recordSliceStats") found.push(name); ts.forEachChild(n, visit); };
      visit(fnNode(name));
      return found.length;
    };
    for (const f of ["runPassEndStep", "passEndServe", "passEndKicks", "passEndHygiene", "freshnessSweep", "passEndCapacity", "passEndNames", "maybeResumePassEnd"]) {
      expect(fnNode(f), `${f} moved`).toBeDefined();
      expect(reads(f), `${f} writes the tail's run into slice_stats`).toBe(0);
    }
  });
});
