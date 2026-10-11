import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

/**
 * S11-001: THE PASS-END TAIL DIED AT THE GATEWAY'S 150 s IDLE TIMEOUT ON EVERY PASS.
 *
 * The parent hop awaits the pass-end hop's whole body, and the tail ran inside
 * that request: the facets, the orphan prune, the date hygiene, then a
 * freshness sweep that read every one of its 15,000 ids' rows before it
 * deleted any. Live from 2026-10-09 15:51Z: 'pass-end-pruned' about 31 s in,
 * then chain_kick {status 504, IDLE_TIMEOUT} exactly 150 s after the hop
 * started, and no 'pass-end-swept'. Nothing after the sweep ever ran: the
 * refresh row, refresh_head, hot_tokens, the filter audit and the salary,
 * experience and country kicks.
 *
 * These tests RUN the shipped `if (passDone) { ... }` block, lifted from
 * job-board/index.ts with the TypeScript parser, with every name it reads
 * bound to a stub that records what happened and in what order. A name the
 * block reads that the harness does not bind throws, so a moved block fails
 * loudly instead of passing on nothing.
 */

const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const SF = ts.createSourceFile("index.ts", FN, ts.ScriptTarget.ES2022, true);

function findPassDoneBlock(): string {
  let found: ts.IfStatement | null = null;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isIfStatement(n) && n.expression.getText(SF) === "passDone") { found = n; return; }
    ts.forEachChild(n, visit);
  };
  visit(SF);
  expect(found, "the `if (passDone) {` block was not found in job-board/index.ts").not.toBeNull();
  const block = (found as unknown as ts.IfStatement).thenStatement as ts.Block;
  return block.statements.map((s) => s.getFullText(SF)).join("");
}

/** The freshness sweep's block: the braces enclosing its cutoff line. */
function findSweepBlock(): string {
  let found: ts.Block | null = null;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isBlock(n) && n.statements.some((s) => s.getText(SF).startsWith("const freshCutoffIso = new Date(freshCutoffMs)"))) { found = n; return; }
    ts.forEachChild(n, visit);
  };
  visit(SF);
  expect(found, "the freshness sweep's block was not found").not.toBeNull();
  return (found as unknown as ts.Block).statements.map((s) => s.getFullText(SF)).join("");
}

/** Compile a statement list into an async function whose free names resolve through `scope` only. */
function runner(statements: string): (scope: Record<string, unknown>) => Promise<unknown> {
  const js = ts.transpileModule(`async function __lifted() {\n${statements}\n}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const make = new Function("__scope", `with (__scope) { ${js}\n return __lifted(); }`);
  return (deps) => {
    const scope = new Proxy(deps, {
      has: (_t, k) => typeof k === "string" && (k in deps || !(k in globalThis)),
      get: (_t, k) => {
        if (k === Symbol.unscopables) return undefined;
        if (typeof k === "string" && k in deps) return deps[k];
        throw new Error(`the lifted block reads \`${String(k)}\`, which this harness does not bind`);
      },
    });
    return make(scope) as Promise<unknown>;
  };
}

type Op = [string, unknown[]];
type Call = { table?: string; rpc?: string; ops: Op[] };

/** A supabase-js stand-in: every chain is recorded and answered by `answer` when awaited. */
function stubClient(answer: (c: Call) => unknown) {
  const chain = (call: Call): unknown => {
    const p: unknown = new Proxy(function () { /* callable */ }, {
      get(_t, prop) {
        if (prop === "then") {
          const r = Promise.resolve(answer(call));
          return r.then.bind(r);
        }
        return (...args: unknown[]) => { call.ops.push([String(prop), args]); return p; };
      },
    });
    return p;
  };
  return {
    from: (table: string) => chain({ table, ops: [] }),
    rpc: (name: string, args?: unknown) => chain({ rpc: name, ops: [["args", [args]]] }),
  };
}

const op = (c: Call, name: string) => c.ops.find((o) => o[0] === name);
const eqK = (c: Call) => (c.ops.find((o) => o[0] === "eq" && o[1][0] === "k")?.[1][1] as string | undefined);

/** Everything the pass-end block reads, wired to one recorder. */
function world(opts: { facetsGate?: Promise<void>; aged?: number } = {}) {
  const events: string[] = [];
  const background: Promise<unknown>[] = [];
  const aged = Array.from({ length: opts.aged ?? 3 }, (_, i) => ({
    id: `greenhouse:acme:${i}`, source: "greenhouse", company_token: "acme", company: "Acme", title: "Role",
    category: "other", posted_at: "2026-08-01T00:00:00Z", first_seen: "2026-08-01T00:00:00Z", effective_posted: "2026-08-01T00:00:00Z",
  }));
  const meta: Record<string, unknown> = {
    catalog_highwater: { v: { size: 1 } },
    experience_version: { v: { version: -1 } },
    country_version: { v: { version: -1 } },
    salary_parse_version: { v: { version: -1 } },
    name_sync_version: { v: { version: 3 } },
    filter_audit: { updated_at: "2026-10-09T14:56:50.022Z" },
    posted_backfill: { v: { version: 1, at: "2026-10-01T00:00:00Z" } },
  };
  const client = stubClient((c) => {
    if (c.rpc) {
      events.push(`rpc:${c.rpc}`);
      if (c.rpc === "refresh_job_board_facets") {
        const facets = { data: { total: 100, companiesFacet: [{ token: "acme", name: "Acme", count: 60 }], categoriesFacet: { other: 100 } }, error: null };
        return opts.facetsGate ? opts.facetsGate.then(() => facets) : facets;
      }
      if (c.rpc === "get_filter_coverage") return { data: { open: 100, salaryFloor: 10 }, error: null };
      if (c.rpc === "get_board_velocity") return { data: [], error: null };
      return { data: null, error: null };
    }
    const t = c.table!;
    const ups = op(c, "upsert");
    if (ups) {
      const row = ups[1][0] as { k?: string } | Array<unknown>;
      events.push(Array.isArray(row) ? `upsert:${t}` : `upsert:${t}:${row.k ?? ""}`);
      return { error: null };
    }
    if (op(c, "delete")) {
      const ids = (op(c, "in")?.[1][1] as string[] | undefined) ?? [];
      if (t === "job_board_postings") {
        events.push(`delete:${ids.length}`);
        for (const id of ids) { const i = aged.findIndex((r) => r.id === id); if (i >= 0) aged.splice(i, 1); }
      }
      return { error: null };
    }
    if (op(c, "update")) { events.push(`update:${t}`); return { error: null }; }
    const sel = op(c, "select");
    if (sel && t === "job_board_meta") {
      const k = eqK(c);
      return { data: k ? (meta[k] ?? null) : null, error: null };
    }
    if (sel && t === "job_board_postings") {
      const cols = String(sel[1][0]);
      const countOpt = sel[1][1] as { count?: string } | undefined;
      if (countOpt?.count) return { count: 100, error: null };
      if (op(c, "lt") && cols === "id") {
        events.push("sweep-select");
        const range = op(c, "range")?.[1] as [number, number];
        return { data: aged.slice(range[0], range[1] + 1).map((r) => ({ id: r.id })), error: null };
      }
      const ids = (op(c, "in")?.[1][1] as string[] | undefined) ?? [];
      events.push("sweep-read");
      return { data: aged.filter((r) => ids.includes(r.id)), error: null };
    }
    return { data: [], error: null };
  });
  const deps: Record<string, unknown> = {
    client,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    waitUntil: (p: Promise<unknown>) => { background.push(Promise.resolve(p).catch(() => {})); },
    fetch: async (_url: string, init: { body: string }) => {
      events.push(`kick:${(JSON.parse(init.body) as { action: string }).action}`);
      return new Response("{}");
    },
    chainKey: async () => "k",
    discardBody: () => {},
    breadcrumb: async (_c: unknown, mark: string) => { events.push(`mark:${mark}`); },
    stampPassEnd: async (_c: unknown, v: { doneAt?: string }) => { events.push(v.doneAt ? "pass_end:done" : "pass_end:start"); },
    maybeKickMaintenance: async () => { events.push("maintenance"); },
    recordSliceStats: async () => { events.push("slice-stats"); },
    pruneWholeBoard: async () => ({ logged: 0, complete: true }),
    insertExits: async (_c: unknown, rows: unknown[]) => { events.push(`exits:${rows.length}`); return { error: null }; },
    heldOversize: () => false,
    tenureDays: () => ({ days: 70, basis: "posted_at" }),
    exitReasonFor: () => "aged_out",
    lifecycleFacets: () => ({}),
    undatedBacklog: async () => 0,
    postedBackfillDue: () => false,
    Deno: { env: { get: () => "https://example.test" } },
    sliceWallStart: Date.now(),
    inHotPhase: false,
    chainHop: 12,
    startIso: new Date().toISOString(),
    freshCutoffMs: Date.parse("2026-09-10T00:00:00Z"),
    failedAcc: [],
    failedTotal: 0,
    cold: 10,
    lastUpsertError: null,
    HOT_LIST: [],
    COLD_LIST: [],
    COLD_SLICES_PER_PASS: 160,
    HOT_SIZE: 120,
    VELOCITY_WINDOW_DAYS: 7,
    VELOCITY_HOT_SLOTS: 20,
    EXPERIENCE_VERSION: 9,
    COUNTRY_VERSION: 8,
    SALARY_PARSE_VERSION: 10,
    POSTED_BACKFILL_VERSION: 1,
    NAME_SYNC_VERSION: 3,
    RENAMED_TOKENS: [],
    JOB_SOURCES: [{ source: "greenhouse", token: "acme", name: "Acme" }],
    ORACLE_SITE_RANK: new Map(),
    ORACLE_CANONICAL_SITES: [],
    BUILD_VERSION: "test",
    META_READ: { light: true, oversize: true },
    OVERSIZE_BOARDS: new Map(),
    SHARED_TOKENS: new Set(),
    LIFECYCLE_SELECT: "id, source, company_token, company, title, category, posted_at, first_seen",
    POSTED_AT_GARBAGE_FLOOR_MS: Date.parse("2000-01-01T00:00:00Z"),
    FRESH_PRUNE_MAX: 15_000,
    FRESH_WINDOW_DAYS: 30,
    PASS_END_SWEEP_UNTIL_MS: 180_000,
    CORPUS_CEILING: 10_000_000,
    CORPUS_TARGET: 9_000_000,
  };
  return { deps, events, background, aged };
}

describe("the pass-end hop answers its parent before the tail's long work (S11-001)", () => {
  it("returns while the facets aggregate is still running, and the tail finishes in the background", async () => {
    let release!: () => void;
    const facetsGate = new Promise<void>((r) => { release = r; });
    const w = world({ facetsGate });
    const run = runner(findPassDoneBlock());
    const answered = run(w.deps);
    const first = await Promise.race([
      answered.then(() => "answered"),
      new Promise((r) => setTimeout(() => r("still waiting"), 100)),
    ]);
    expect(
      first,
      "the hop is still inside its tail while refresh_job_board_facets runs: the parent's fetch gets no answer, and at 150 s the gateway 504s the hop and kills the tail",
    ).toBe("answered");
    expect(w.events, "the answer must not wait for the facets").not.toContain("upsert:job_board_meta:refresh");
    release();
    await answered;
    await Promise.all(w.background);
    expect(w.events, "the tail still runs to its end in the background").toContain("upsert:job_board_meta:refresh_head");
    expect(w.events).toContain("mark:pass-end-swept");
    expect(w.events.filter((e) => e === "slice-stats"), "the tail records its slice once").toHaveLength(1);
  });

  it("writes what the board serves and fires every kick BEFORE the slow deletes", async () => {
    const w = world();
    await runner(findPassDoneBlock())(w.deps);
    await Promise.all(w.background);
    const at = (e: string) => {
      const i = w.events.indexOf(e);
      expect(i, `${e} never happened: ${w.events.join(", ")}`).toBeGreaterThanOrEqual(0);
      return i;
    };
    const sweep = at("sweep-select");
    for (const e of [
      "upsert:job_board_meta:refresh",
      "upsert:job_board_meta:refresh_head",
      "kick:filter-audit",
      "kick:backfill-salary",
      "kick:backfill-experience",
      "kick:backfill-country",
    ]) {
      expect(at(e), `${e} comes after the freshness sweep starts, so a tail that dies in the sweep never writes it`).toBeLessThan(sweep);
    }
    expect(at("update:job_board_postings"), "date hygiene rides with the slow work, after the serving rows").toBeGreaterThan(at("upsert:job_board_meta:refresh_head"));
  });

  it("stamps a pass_end receipt at the start and at the end, so a tail that dies is visible after the next pass begins", async () => {
    const w = world();
    await runner(findPassDoneBlock())(w.deps);
    await Promise.all(w.background);
    expect(w.events.filter((e) => e.startsWith("pass_end:"))).toEqual(["pass_end:start", "pass_end:done"]);
    expect(w.events.indexOf("pass_end:done"), "done is stamped after the sweep").toBeGreaterThan(w.events.indexOf("mark:pass-end-swept"));
  });
});

describe("the freshness sweep deletes each chunk as it goes, and stops on its clock (S11-001)", () => {
  it("reads, logs and deletes chunk by chunk, and every row it read is gone when the clock stops it", async () => {
    const w = world({ aged: 1_000 });
    // A clock that moves 50 s per delete: the sweep's 180 s budget from the
    // hop's start fits four chunks of 200, so a fifth must never start.
    let now = 1_000_000;
    class FakeDate extends Date {
      constructor(...a: unknown[]) { super(...((a.length ? a : [now]) as [number])); }
      static now() { return now; }
    }
    const deps: Record<string, unknown> = { ...w.deps, Date: FakeDate, sliceWallStart: now };
    const client = deps.client as { from: (t: string) => unknown };
    deps.client = {
      ...client,
      from: (t: string) => {
        const q = client.from(t) as Record<string, (...a: unknown[]) => unknown>;
        if (t !== "job_board_postings") return q;
        return new Proxy(q, {
          get(target, prop) {
            if (prop !== "delete") return (target as Record<string | symbol, unknown>)[prop];
            return (...a: unknown[]) => { now += 50_000; return target.delete(...a); };
          },
        });
      },
    };
    await runner(findSweepBlock())(deps);
    await Promise.all(w.background);
    const reads = w.events.filter((e) => e === "sweep-read").length;
    const deleted = w.events.filter((e) => e.startsWith("delete:")).reduce((n, e) => n + Number(e.slice(7)), 0);
    expect(
      w.events.indexOf("delete:200"),
      "the first chunk is deleted only after every chunk has been read: a tail that dies in the reads deletes nothing",
    ).toBeLessThan(w.events.indexOf("sweep-read", w.events.indexOf("sweep-read") + 1));
    expect(deleted, "the sweep ignored its clock and swept the whole backlog").toBeLessThan(1_000);
    expect(deleted, "every chunk the sweep read and logged is deleted").toBe(reads * 200);
    expect(deleted, "four chunks fit inside the clock").toBe(800);
    expect(w.aged).toHaveLength(200);
  });
});
