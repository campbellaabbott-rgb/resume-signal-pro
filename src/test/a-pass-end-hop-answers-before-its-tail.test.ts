import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import {
  nextPassEndStep, PASS_END_RETRIES, PASS_END_STALL_MS, PASS_END_STEPS, PASS_END_SWEEP_HOPS,
  stalledPassEndStep, withStepReceipt, type PassEndRow,
} from "../../supabase/functions/job-board/pass-end";
import { nameSyncQueue } from "../../supabase/functions/job-board/name-sync";

/**
 * S11-001: THE PASS-END TAIL DIED, FIRST AT THE GATEWAY, THEN IN THE BACKGROUND.
 *
 * Until .92 the tail ran inside the pass-end hop's request and the gateway's
 * 150 s idle timeout killed it on every pass from 2026-10-09 15:51Z. .92
 * answered first and ran the tail in waitUntil; that tail finished on the
 * first pass and never recorded a finish on the second (started
 * 2026-10-11 22:06:50Z), because background work dies with its isolate and
 * the one receipt could not say where. .93 runs each step as its own
 * maintenance request, inside that request and on its own clock, with a
 * receipt per step, and re-kicks a step whose request died.
 *
 * These tests RUN the shipped code, lifted from job-board/index.ts with the
 * TypeScript parser, with every name it reads bound to a stub that records
 * what happened and in what order. A name the code reads that the harness
 * does not bind throws, so a moved block fails loudly instead of passing on
 * nothing.
 */

const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const SF = ts.createSourceFile("index.ts", FN, ts.ScriptTarget.ES2022, true);
const constNum = (name: string) => Number(new RegExp(`^const ${name} = ([0-9_]+);`, "m").exec(FN)?.[1].replace(/_/g, "") ?? NaN);

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

/** A top-level function's source, by name. */
function fnSource(name: string): string {
  const f = SF.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === name);
  expect(f, `function ${name} was not found in job-board/index.ts`).toBeDefined();
  return f!.getText(SF);
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

/** Compile source into an async function whose free names resolve through `scope` only. */
function compile(src: string, ret: string): (scope: Record<string, unknown>) => Promise<unknown> {
  const js = ts.transpileModule(`async function __lifted() {\n${src}\n${ret}\n}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const make = new Function("__scope", `with (__scope) { ${js}\n return __lifted(); }`);
  return (deps) => {
    const scope = new Proxy(deps, {
      has: (_t, k) => typeof k === "string" && (k in deps || !(k in globalThis)),
      get: (_t, k) => {
        if (k === Symbol.unscopables) return undefined;
        if (typeof k === "string" && k in deps) return deps[k];
        throw new Error(`the lifted code reads \`${String(k)}\`, which this harness does not bind`);
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

/** Everything the pass-end code reads, wired to one recorder. */
function world(opts: { aged?: number; now?: () => number } = {}) {
  const events: string[] = [];
  const background: Promise<unknown>[] = [];
  const kicks: Array<{ step: string; startedAt: string }> = [];
  const aged = Array.from({ length: opts.aged ?? 3 }, (_, i) => ({
    id: `greenhouse:acme:${i}`, source: "greenhouse", company_token: "acme", company: "Acme", title: "Role",
    category: "other", posted_at: "2026-08-01T00:00:00Z", first_seen: "2026-08-01T00:00:00Z", effective_posted: "2026-08-01T00:00:00Z",
  }));
  const meta: Record<string, { v: unknown; updated_at?: string } | undefined> = {
    catalog_highwater: { v: { size: 1 } },
    experience_version: { v: { version: -1 } },
    country_version: { v: { version: -1 } },
    salary_parse_version: { v: { version: -1 } },
    name_sync_version: { v: { version: 3 } },
    filter_audit: { v: {}, updated_at: "2026-10-09T14:56:50.022Z" },
    posted_backfill: { v: { version: 1, at: "2026-10-01T00:00:00Z" } },
  };
  const client = stubClient((c) => {
    if (c.rpc) {
      events.push(`rpc:${c.rpc}`);
      if (c.rpc === "refresh_job_board_facets") {
        return { data: { total: 100, companiesFacet: [{ token: "acme", name: "Acme", count: 60 }], categoriesFacet: { other: 100 } }, error: null };
      }
      if (c.rpc === "get_filter_coverage") return { data: { open: 100, salaryFloor: 10 }, error: null };
      if (c.rpc === "get_board_velocity") return { data: [], error: null };
      return { data: null, error: null };
    }
    const t = c.table!;
    const ups = op(c, "upsert");
    if (ups) {
      const row = ups[1][0] as { k?: string; v?: unknown } | Array<unknown>;
      if (!Array.isArray(row) && t === "job_board_meta" && row.k) meta[row.k] = { v: row.v };
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
  const META_READ = { light: true, oversize: false };
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
    stampPassEnd: async (_c: unknown, v: Record<string, unknown>) => {
      meta.pass_end = { v: { build: "test", ...v } };
      events.push(v.doneAt ? "pass_end:done" : "pass_end:stamp");
    },
    kickPassEndStep: (step: string, startedAt: string) => { kicks.push({ step, startedAt }); events.push(`step-kick:${step}`); },
    loadOversizeBoards: async () => { META_READ.oversize = true; },
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
    carriedCountsAt: () => null,
    overrideTable: () => new Map(),
    overrideFor: () => null,
    nameSyncTarget: (s: { name: string }) => s.name,
    nameSyncQueue,
    withStepReceipt,
    nextPassEndStep,
    PASS_END_STEPS,
    Deno: { env: { get: () => "https://example.test" } },
    sliceWallStart: Date.now(),
    inHotPhase: false,
    chainHop: 12,
    startIso: "2026-10-12T06:00:00.000Z",
    freshCutoffMs: Date.parse("2026-09-10T00:00:00Z"),
    failedAcc: [{ token: "gone", source: "lever" }],
    failedTotal: 1,
    cold: 10,
    lastUpsertError: null,
    COLD_LIST: [],
    HOT_SIZE: 120,
    VELOCITY_WINDOW_DAYS: 7,
    VELOCITY_HOT_SLOTS: 20,
    EXPERIENCE_VERSION: 9,
    COUNTRY_VERSION: 8,
    SALARY_PARSE_VERSION: 10,
    POSTED_BACKFILL_VERSION: 1,
    NAME_SYNC_VERSION: 3,
    NAME_SYNC_UNTIL_MS: constNum("NAME_SYNC_UNTIL_MS"),
    RENAMED_TOKENS: [],
    JOB_SOURCES: [{ source: "greenhouse", token: "acme", name: "Acme" }],
    ORACLE_SITE_RANK: new Map(),
    ORACLE_CANONICAL_SITES: [],
    BUILD_VERSION: "test",
    META_READ,
    OVERSIZE_BOARDS: new Map(),
    SHARED_TOKENS: new Set(),
    LIFECYCLE_SELECT: "id, source, company_token, company, title, category, posted_at, first_seen",
    POSTED_AT_GARBAGE_FLOOR_MS: Date.parse("2000-01-01T00:00:00Z"),
    FRESH_PRUNE_MAX: constNum("FRESH_PRUNE_MAX"),
    FRESH_WINDOW_DAYS: 30,
    PASS_END_SWEEP_UNTIL_MS: constNum("PASS_END_SWEEP_UNTIL_MS"),
    CORPUS_CEILING: 10_000_000,
    CORPUS_TARGET: 9_000_000,
  };
  return { deps, events, background, aged, meta, kicks };
}

/** The step functions and their plumbing, as shipped. */
const STEP_FNS = ["readMetaRow", "passEndReceipt", "runPassEndStep", "passEndServe", "passEndKicks", "passEndHygiene", "freshnessSweep", "passEndCapacity", "passEndNames"];
const runStep = compile(STEP_FNS.map(fnSource).join("\n"), "return runPassEndStep;");

/** Hand the pass over with the shipped passDone block, then follow every kick until the tail stops. */
async function wholeTail(w: ReturnType<typeof world>): Promise<Array<Record<string, unknown>>> {
  await compile(findPassDoneBlock(), "")(w.deps);
  const run = await runStep(w.deps) as (c: unknown, step: string, startedAt: string) => Promise<Record<string, unknown>>;
  const answers: Array<Record<string, unknown>> = [];
  for (let i = 0; i < 20 && w.kicks.length > 0; i++) {
    const k = w.kicks.shift()!;
    answers.push(await run(w.deps.client, k.step, k.startedAt));
    await Promise.all(w.background);
  }
  return answers;
}

describe("the pass-end hop hands its tail over and answers (S11-001)", () => {
  it("answers without running any of the tail, after keeping the pass's context and kicking the first step", async () => {
    const w = world();
    const r = await compile(findPassDoneBlock(), "")(w.deps) as { ok: boolean; detail: string };
    expect(r.ok).toBe(true);
    expect(w.events.filter((e) => e.startsWith("rpc:")), "the hop that ends the pass runs none of the tail's work").toEqual([]);
    expect(w.events).toContain("upsert:job_board_meta:pass_end_ctx");
    const ctx = w.meta.pass_end_ctx?.v as Record<string, unknown>;
    expect(ctx.failedSources, "the refresh row's failures reach the step that writes it").toEqual([{ token: "gone", source: "lever" }]);
    expect(ctx.refreshedAt).toBe("2026-10-12T06:00:00.000Z");
    expect((w.meta.pass_end?.v as PassEndRow).next).toBe("serve");
    expect(w.kicks.map((k) => k.step)).toEqual(["serve"]);
    expect(w.events.filter((e) => e === "slice-stats"), "the hop records its slice once").toHaveLength(1);
  });

  it("the step is a maintenance request that carries its pass, and nobody else may send it", () => {
    const kick = fnSource("kickPassEndStep");
    expect(kick).toContain('JSON.stringify({ action: "pass-end", step, startedAt, chainKey: key })');
    const action = FN.slice(FN.indexOf('if (action === "pass-end") {'), FN.indexOf('if (action === "filter-audit") {'));
    expect(action).toMatch(/body\.chainKey !== await chainKey\(\)\) \{\s*return json\(\{ error: "pass-end is a maintenance action" \}, 403\);/);
  });
});

describe("every step runs in its own request and records its own receipt (S11-001)", () => {
  it("runs every step in order, each with a start and a finish, and the tail's finish", async () => {
    const w = world();
    const answers = await wholeTail(w);
    expect(answers.map((a) => a.step)).toEqual([...PASS_END_STEPS]);
    expect(answers.every((a) => a.ok === true), JSON.stringify(answers)).toBe(true);
    const row = w.meta.pass_end?.v as PassEndRow;
    for (const s of PASS_END_STEPS) {
      const r = row.steps?.[s] ?? {};
      expect(typeof r.startedAt, `${s} has no start receipt`).toBe("string");
      expect(Date.parse(String(r.doneAt)) >= Date.parse(String(r.startedAt)), `${s} has no finish receipt`).toBe(true);
      expect(typeof r.ms).toBe("number");
    }
    expect(Date.parse(String(row.doneAt)) >= Date.parse(String(row.startedAt)), "the tail's finish is what the heartbeat reads").toBe(true);
    expect(row.next).toBeNull();
    expect(w.events.filter((e) => e === "maintenance"), "the last step hands on to maintenance once").toHaveLength(1);
  });

  it("writes what the board serves and fires every kick BEFORE the slow deletes", async () => {
    const w = world();
    await wholeTail(w);
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

  it("a step that throws records the failure in its receipt and the tail goes on", async () => {
    const w = world();
    w.deps.undatedBacklog = async () => { throw new Error("backlog unreadable"); };
    w.deps.postedBackfillDue = () => { throw new Error("never reached"); };
    const answers = await wholeTail(w);
    const kicks = answers.find((a) => a.step === "kicks")!;
    expect(kicks.ok).toBe(false);
    expect(String(kicks.detail)).toContain("backlog unreadable");
    const row = w.meta.pass_end?.v as PassEndRow;
    expect(row.steps?.kicks?.ok).toBe(false);
    expect(answers.map((a) => a.step), "the steps after it still run").toEqual([...PASS_END_STEPS]);
  });

  it("a step from a pass that has since been superseded does nothing", async () => {
    const w = world();
    await compile(findPassDoneBlock(), "")(w.deps);
    const run = await runStep(w.deps) as (c: unknown, step: string, startedAt: string) => Promise<Record<string, unknown>>;
    const r = await run(w.deps.client, "serve", "2026-10-01T00:00:00.000Z");
    expect(r.ok).toBe(false);
    expect(w.events.filter((e) => e.startsWith("rpc:")), "an old pass's step ran its work").toEqual([]);
  });

  it("a sweep its clock stopped runs again in a new hop, PASS_END_SWEEP_HOPS times at most", async () => {
    const w = world({ aged: 20_000 });
    let now = 1_000_000;
    class FakeDate extends Date {
      constructor(...a: unknown[]) { super(...((a.length ? a : [now]) as [number])); }
      static now() { return now; }
    }
    w.deps.Date = FakeDate;
    const client = w.deps.client as { from: (t: string) => unknown };
    w.deps.client = {
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
    const answers = await wholeTail(w);
    const sweeps = answers.filter((a) => a.step === "sweep");
    expect(sweeps.length, "the sweep never ran again after its clock stopped it").toBe(PASS_END_SWEEP_HOPS);
    const row = w.meta.pass_end?.v as PassEndRow;
    expect(row.steps?.sweep?.hops).toBe(PASS_END_SWEEP_HOPS);
    expect(row.steps?.sweep?.dropped, "the receipt counts every hop's deletes").toBe(20_000 - w.aged.length);
    expect(answers.at(-1)?.step, "the tail still reaches its last step").toBe("names");
  });
});

describe("a step whose request died is kicked again (S11-001)", () => {
  const T0 = Date.parse("2026-10-12T06:00:00Z");
  const iso = (ms: number) => new Date(T0 + ms).toISOString();

  it("re-kicks a step that started and never finished, once nothing has happened for the stall window", () => {
    const v: PassEndRow = { startedAt: iso(0), next: "sweep", nextKickedAt: iso(60_000), steps: { sweep: { startedAt: iso(61_000) } } };
    expect(stalledPassEndStep(v, T0 + 61_000 + PASS_END_STALL_MS - 1)).toBeNull();
    expect(stalledPassEndStep(v, T0 + 61_000 + PASS_END_STALL_MS)).toBe("sweep");
  });

  it("re-kicks a step whose kick never arrived", () => {
    const v: PassEndRow = { startedAt: iso(0), next: "kicks", nextKickedAt: iso(30_000), steps: { serve: { startedAt: iso(1_000), doneAt: iso(30_000) } } };
    expect(stalledPassEndStep(v, T0 + 30_000 + PASS_END_STALL_MS)).toBe("kicks");
  });

  it("leaves a finished tail, a running step and a step out of retries alone", () => {
    const done: PassEndRow = { startedAt: iso(0), doneAt: iso(300_000), next: null, steps: {} };
    expect(stalledPassEndStep(done, T0 + 10 * PASS_END_STALL_MS)).toBeNull();
    const spent: PassEndRow = { startedAt: iso(0), next: "names", nextKickedAt: iso(1), steps: { names: { startedAt: iso(2), tries: PASS_END_RETRIES } } };
    expect(stalledPassEndStep(spent, T0 + 10 * PASS_END_STALL_MS)).toBeNull();
    expect(stalledPassEndStep(null, T0)).toBeNull();
  });

  it("a sweep that finished and was asked to go again is watched by its kick", () => {
    const v: PassEndRow = { startedAt: iso(0), next: "sweep", nextKickedAt: iso(200_000), steps: { sweep: { startedAt: iso(100_000), doneAt: iso(190_000), hops: 1 } } };
    expect(stalledPassEndStep(v, T0 + 200_000 + PASS_END_STALL_MS)).toBe("sweep");
  });

  it("nextPassEndStep walks the steps and repeats only a clock-stopped sweep", () => {
    expect(nextPassEndStep("serve")).toBe("kicks");
    expect(nextPassEndStep("sweep", { stop: "clock", hops: 1 })).toBe("sweep");
    expect(nextPassEndStep("sweep", { stop: "clock", hops: PASS_END_SWEEP_HOPS })).toBe("capacity");
    expect(nextPassEndStep("sweep", { stop: "done", hops: 1 })).toBe("capacity");
    expect(nextPassEndStep("names")).toBeNull();
    expect(withStepReceipt({ startedAt: "a", steps: { serve: { ok: true } } }, "serve", { ms: 5 }).steps?.serve).toEqual({ ok: true, ms: 5 });
  });

  it("the hop-end maintenance check is where the re-kick happens", () => {
    const mk = FN.slice(FN.indexOf("async function maybeKickMaintenance("), FN.indexOf("maintenance kick skipped", FN.indexOf("async function maybeKickMaintenance(")));
    expect(mk).toContain("await maybeResumePassEnd(client);");
    expect(fnSource("maybeResumePassEnd")).toMatch(/stalledPassEndStep\(v, Date\.now\(\)\)[\s\S]*kickPassEndStep\(step, v\.startedAt\)/);
  });
});

describe("the freshness sweep deletes each chunk as it goes, and stops on its clock (S11-001)", () => {
  it("reads, logs and deletes chunk by chunk, and every row it read is gone when the clock stops it", async () => {
    const w = world({ aged: 1_000 });
    w.deps.META_READ = { light: true, oversize: true };
    // A clock that moves 50 s per delete: the sweep's budget from its own hop's
    // start fits ceil(budget / 50 s) chunks of 200, and no chunk after that.
    const budget = constNum("PASS_END_SWEEP_UNTIL_MS");
    const fits = Math.ceil(budget / 50_000);
    expect(fits * 200, "the fixture must outlast the clock").toBeLessThan(1_000);
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
    const r = await compile(findSweepBlock(), "")(deps) as { swept: number; stop: string };
    await Promise.all(w.background);
    const reads = w.events.filter((e) => e === "sweep-read").length;
    const deleted = w.events.filter((e) => e.startsWith("delete:")).reduce((n, e) => n + Number(e.slice(7)), 0);
    expect(
      w.events.indexOf("delete:200"),
      "the first chunk is deleted only after every chunk has been read: a tail that dies in the reads deletes nothing",
    ).toBeLessThan(w.events.indexOf("sweep-read", w.events.indexOf("sweep-read") + 1));
    expect(deleted, "the sweep ignored its clock and swept the whole backlog").toBeLessThan(1_000);
    expect(deleted, "every chunk the sweep read and logged is deleted").toBe(reads * 200);
    expect(deleted, `${fits} chunks fit inside the clock`).toBe(fits * 200);
    expect(w.aged).toHaveLength(1_000 - fits * 200);
    expect(r, "the sweep says why it stopped, so the step can run it again").toEqual({ swept: fits * 200, stop: "clock" });
  });
});
