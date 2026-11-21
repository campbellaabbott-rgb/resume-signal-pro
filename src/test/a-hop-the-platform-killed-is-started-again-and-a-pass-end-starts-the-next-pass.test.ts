import { describe, expect, it } from "vitest";
import ts from "typescript";
import { compile, constSource, eqOf, FN, fnSource, op, stubClient, type Call } from "./helpers/lift-index";

/**
 * BOARD .103, THE LAP STOPS WASTING TIME (jobs-clear spec section 3.1).
 *
 * SUP-a. On .101/.102 a hop the platform killed (546 WORKER_RESOURCE_LIMIT) or
 * whose self-call the runtime refused ("RateLimitError ... Retry after N s")
 * left the chain dark until the minute watchdog noticed: about 3.9 min a death,
 * 36-51 deaths a lap (capacity.md section 4). The hop before it now waits
 * (546: 3-5 s; RateLimitError: the stated retry, at most 40 s) and kicks the
 * same child again, at most twice, through a CAS on the refresh_progress stamp
 * it read before the wait, and only while the isolate's wall clock has room.
 * A 503, a 429 or a silent death is not re-kicked here: those need SUP-b's epoch.
 *
 * W4-2. A pass end used to stop the chain; the next pass's hop 0 waited for a
 * cron tick (4.7 min a pass, about 8 passes a lap). The pass end now kicks hop
 * 0 itself, admitted only through admitSlice's CAS on the stamp it wrote, so a
 * cron kick racing it is refused and hop 0 starts exactly once.
 *
 * INST and XR-6: a slice the platform shuts down stamps why; the per-board
 * breadcrumbs write at most once per 2 s per isolate.
 *
 * Everything below RUNS the shipped code, lifted from job-board/index.ts.
 */

const U0 = "2026-11-18T06:00:00.123+00:00";
const U1 = "2026-11-18T06:00:30.456+00:00";

type Stamp = Record<string, unknown>;

function chainWorld(opts: {
  answers: Array<{ status: number; body?: string } | Error>;
  stamps?: string[];
  bornAgoMs?: number;
  /** The hop refresh_progress names as its writer (default: the kicking hop itself, so the child was never admitted). */
  atHop?: number;
}) {
  let clock = Date.parse("2026-11-18T06:01:00Z");
  class FakeDate extends Date {
    constructor(...a: unknown[]) { super(...((a.length ? a : [clock]) as [number])); }
    static now() { return clock; }
  }
  const waits: number[] = [];
  const bodies: Array<Record<string, unknown>> = [];
  const stamps: Stamp[] = [];
  const reads = [...(opts.stamps ?? [U0, U0, U0, U0, U0, U0])];
  const background: Promise<unknown>[] = [];
  const answers = [...opts.answers];
  let runHop = 0;
  const client = stubClient((c: Call) => {
    const ups = op(c, "upsert");
    if (ups) { stamps.push(((ups[1][0] as { v: Stamp }).v)); return { error: null }; }
    if (op(c, "select") && eqOf(c, "k") === "refresh_progress") return { data: { v: { hot: 0, hop: opts.atHop ?? runHop }, updated_at: reads.shift() ?? U0 }, error: null };
    return { data: null, error: null };
  });
  const deps: Record<string, unknown> = {
    Deno: { env: { get: () => "https://example.test" } },
    waitUntil: (p: Promise<unknown>) => { background.push(p); },
    isIngestPaused: async () => false,
    chainKey: async () => "k",
    boundBody: (r: Response) => r,
    SELF_RESPONSE_BYTES: 400_000,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    Date: FakeDate,
    setTimeout: (cb: () => void, ms: number) => { waits.push(ms); clock += ms; cb(); return 0; },
    fetch: async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      clock += 20_000; // the child's slice
      const a = answers.shift() ?? { status: 200, body: '{"ok":true,"detail":"slice done"}' };
      if (a instanceof Error) throw a;
      return new Response(a.body ?? '{"ok":true,"detail":"slice done"}', { status: a.status });
    },
    REKICKS_PER_HOP: 2,
    REKICK_AGE_MS: 120_000,
    ISOLATE_BORN: clock - (opts.bornAgoMs ?? 30_000),
  };
  const run = async (hop: number, cas?: { after: string; passEnd?: string }) => {
    runHop = hop;
    const chainNextSlice = await compile(fnSource("chainNextSlice"), "return chainNextSlice;")(deps) as (...a: unknown[]) => void;
    chainNextSlice(hop, client, 120, cas);
    await Promise.all(background);
  };
  return { run, waits, bodies, stamps, deps };
}

const rateLimit = (s: number) => Object.assign(new Error(`Rate limit exceeded for trace 4f2a. Retry after ${s} s`), { name: "RateLimitError" });

describe("SUP-a: a hop the platform killed is kicked again, through the CAS (legal-max plan 3.3)", () => {
  it("a 546 waits 3-5 s and re-kicks the same child once, CAS'd on the stamp read before the wait", async () => {
    const w = chainWorld({ answers: [{ status: 546, body: "WORKER_RESOURCE_LIMIT" }] });
    await w.run(12);
    expect(w.bodies, "the killed child was never started again").toHaveLength(2);
    expect(w.bodies[0]).toMatchObject({ action: "refresh", force: true, chain: 13 });
    expect(w.bodies[1], "the re-kick is admitted by CAS on the stamp, never forced").toEqual({ action: "refresh", after: U0, chain: 13, chainKey: "k", boards: 120 });
    expect(w.waits).toHaveLength(1);
    expect(w.waits[0]).toBeGreaterThanOrEqual(3_000);
    expect(w.waits[0]).toBeLessThanOrEqual(5_000);
    expect(w.stamps.map((s) => s.outcome)).toEqual(["kicked", "http_error", "rekicked", "continued"]);
    expect(w.stamps.at(-1)?.rekicked, "chain_kick says the hop was recovered").toBe(1);
  });

  it("a RateLimitError waits the retry it states, capped at 40 s", async () => {
    const short = chainWorld({ answers: [rateLimit(7)] });
    await short.run(40);
    expect(short.waits).toEqual([7_000]);
    expect(short.bodies[1]).toMatchObject({ after: U0, chain: 41 });
    const long = chainWorld({ answers: [rateLimit(90)] });
    await long.run(40);
    expect(long.waits).toEqual([40_000]);
    expect(long.bodies).toHaveLength(2);
  });

  it("declines when refresh_progress moved during the wait (the watchdog or another kick started a chain)", async () => {
    const w = chainWorld({ answers: [{ status: 546 }], stamps: [U0, U1] });
    await w.run(12);
    expect(w.bodies, "a second chain was started beside the one that moved the stamp").toHaveLength(1);
    expect(w.stamps.at(-1)).toMatchObject({ outcome: "declined", rekicked: 1 });
  });

  it("never kicks a third time", async () => {
    const w = chainWorld({ answers: [{ status: 546 }, { status: 546 }, { status: 546 }, { status: 546 }] });
    await w.run(12);
    expect(w.bodies).toHaveLength(3);
    expect(w.stamps.filter((s) => s.outcome === "rekicked")).toHaveLength(2);
  });

  it("skips the re-kick when the isolate's age plus the wait would pass 120 s", async () => {
    const w = chainWorld({ answers: [{ status: 546 }], bornAgoMs: 98_000 }); // + the child's 20 s + 3-5 s > 120 s
    await w.run(12);
    expect(w.bodies).toHaveLength(1);
    expect(w.waits).toEqual([]);
  });

  it("does not re-kick a 503, a 429 or a silent death (SUP-b's, with its epoch)", async () => {
    for (const a of [{ status: 503 }, { status: 429 }, new TypeError("connection reset by peer")]) {
      const w = chainWorld({ answers: [a] });
      await w.run(12);
      expect(w.bodies, String(a instanceof Error ? a.message : a.status)).toHaveLength(1);
    }
  });
});

describe("W4-2: the pass end starts the next pass's hop 0 itself, through the CAS", () => {
  it("the kick names hop 0, the stamp the pass end wrote and the pass end it closes, and is never forced", async () => {
    const w = chainWorld({ answers: [] });
    await w.run(160, { after: U0, passEnd: "2026-11-18T06:00:00.100Z" });
    expect(w.bodies).toEqual([{ action: "refresh", after: U0, chain: 0, chainKey: "k", boards: 120, passEnd: "2026-11-18T06:00:00.100Z" }]);
  });

  it("the passDone block kicks it once, after the tail's first step, with the stamp its own refresh_progress write used", () => {
    const SF = ts.createSourceFile("index.ts", FN(), ts.ScriptTarget.ES2022, true);
    let block = "";
    const visit = (n: ts.Node) => {
      if (block) return;
      if (ts.isIfStatement(n) && n.expression.getText(SF) === "passDone") { block = n.thenStatement.getText(SF); return; }
      ts.forEachChild(n, visit);
    };
    visit(SF);
    const calls = [...block.matchAll(/chainNextSlice\(([^;]*)\);/g)].map((m) => m[1]);
    expect(calls).toEqual(["chainHop, client, undefined, { after: progAt, passEnd: passEndStartedAt }"]);
    expect(block.indexOf("chainNextSlice(")).toBeGreaterThan(block.indexOf("kickPassEndStep(PASS_END_STEPS[0], passEndStartedAt);"));
    const rr = fnSource("runRefresh");
    expect(rr, "progAt must be the stamp the slice-end refresh_progress write used").toMatch(/const progAt = new Date\(\)\.toISOString\(\);\s*await client\.from\("job_board_meta"\)\.upsert\(\s*\{ k: "refresh_progress", v: \{ \.\.\.progressAfter, hop: chainHop \}, updated_at: progAt \}/);
  });

  it("a kick's stamp check: the stamp it was sent against must still stand, read to the millisecond", async () => {
    const kickStale = await compile(constSource("kickStale"), "return kickStale;")({}) as (a: string, p: { updated_at: string } | null) => boolean;
    expect(kickStale("", null), "an unstamped kick (cron, chain hop) is not judged here").toBe(false);
    expect(kickStale("2026-11-18T06:00:00.123Z", { updated_at: U0 }), "the ISO the writer used and PostgREST's spelling are one instant").toBe(false);
    expect(kickStale(U0, { updated_at: U1 })).toBe(true);
    expect(kickStale(U0, null)).toBe(true);
  });

  it("runRefresh declines a moved stamp before the lock, and only a stamped kick skips the lock", () => {
    const rr = fnSource("runRefresh");
    const stale = rr.indexOf("if (kickStale(after, prog as { updated_at: string } | null)) return");
    const lock = rr.indexOf("if (!force && !after && prog && Date.now() - new Date(prog.updated_at).getTime() < SLICE_LOCK_MS)");
    expect(stale).toBeGreaterThan(-1);
    expect(lock).toBeGreaterThan(stale);
    const handler = FN().slice(FN().indexOf('if (action === "refresh") {'));
    expect(handler).toMatch(/const after = keyOk && typeof body\.after === "string" \? body\.after : "";\s*const force = body\.force === true && keyOk && !after;/);
  });

  it("hop 0 is admitted exactly once: a second kick (or a racing cron kick) against the same stamp loses the CAS", async () => {
    const row = { updated_at: U0 };
    let n = 0;
    const client = stubClient((c: Call) => {
      if (op(c, "update")) {
        if (eqOf(c, "updated_at") !== row.updated_at) return { data: [], error: null };
        row.updated_at = `2026-11-18T06:00:5${n++}.000+00:00`;
        return { data: [{ k: "refresh_progress" }], error: null };
      }
      if (op(c, "select")) return { data: { updated_at: row.updated_at }, error: null };
      return { data: null, error: null };
    });
    const deps = { Date, console: { warn: () => {} } };
    const admitSlice = await compile(fnSource("admitSlice"), "return admitSlice;")(deps) as (c: unknown, next: unknown, ctx: unknown) => Promise<boolean>;
    const first = await admitSlice(client, { hot: 0 }, { force: false, prog: { updated_at: U0 } });
    const raced = await admitSlice(client, { hot: 0 }, { force: false, prog: { updated_at: U0 } });
    expect([first, raced]).toEqual([true, false]);
    expect(client.calls.some((c) => op(c, "upsert")), "the CAS path never fell back to the force upsert").toBe(false);
  });

  it("status.passEnd carries hop0At only for the pass end the pass_chain row names", async () => {
    const f = await compile(fnSource("passEndWithHop0"), "return passEndWithHop0;")({}) as (pe: unknown, pc: unknown) => unknown;
    const pe = { startedAt: "2026-11-18T06:00:00.100Z", doneAt: null };
    expect(f(pe, { startedAt: pe.startedAt, hop0At: "2026-11-18T06:00:02.000Z" })).toEqual({ ...pe, hop0At: "2026-11-18T06:00:02.000Z" });
    expect(f(pe, { startedAt: "2026-11-18T01:00:00.000Z", hop0At: "x" })).toEqual(pe);
    expect(f(null, undefined)).toBeNull();
  });
});

describe("INST: a slice the platform shuts down says why (legal-max plan 3.3)", () => {
  const instWorld = (at: number) => {
    const logged: string[] = [];
    const writes: Array<{ k: string; v: Record<string, unknown> }> = [];
    const client = stubClient((c: Call) => {
      const ups = op(c, "upsert");
      if (ups) writes.push(ups[1][0] as { k: string; v: Record<string, unknown> });
      return { error: null };
    });
    const deps: Record<string, unknown> = {
      instSlice: { at, boardsDone: 7, fetched: 312 },
      currentHop: 41,
      BUILD_VERSION: "2026-09-09.103",
      memStamp: () => ({ heapMb: 44 }),
      sliceCpuMs: 812.4,
      INST_SLOTS: ["inst:0", "inst:1", "inst:2", "inst:3", "inst:4"],
      db: () => client,
      console: { error: (...a: unknown[]) => logged.push(a.join(" ")) },
    };
    return { deps, logged, writes };
  };

  it("logs the reason line and writes it to a slot", async () => {
    const w = instWorld(Date.now() - 9_000);
    const onUnload = await compile(fnSource("instOnUnload"), "return instOnUnload;")(w.deps) as (ev: Event) => void;
    onUnload(new CustomEvent("beforeunload", { detail: { reason: "CPUTime" } }));
    await new Promise((r) => setTimeout(r, 0));
    expect(w.logged).toHaveLength(1);
    const line = JSON.parse(w.logged[0].slice(w.logged[0].indexOf("{")));
    expect(line).toMatchObject({ reason: "CPUTime", hop: 41, boardsDone: 7, fetched: 312, heapMb: 44, cpuProxyMs: 812, build: "2026-09-09.103" });
    expect(line.elapsedMs).toBeGreaterThanOrEqual(9_000);
    expect(w.writes).toHaveLength(1);
    expect(w.deps.INST_SLOTS).toContain(w.writes[0].k);
    expect(w.writes[0].v).toEqual(line);
  });

  it("stays quiet when no slice is running (an idle isolate's shutdown is not a death)", async () => {
    const w = instWorld(0);
    const onUnload = await compile(fnSource("instOnUnload"), "return instOnUnload;")(w.deps) as (ev: Event) => void;
    onUnload(new CustomEvent("beforeunload", { detail: { reason: "EarlyDrop" } }));
    expect([w.logged, w.writes]).toEqual([[], []]);
  });

  it("the listener is registered at the module's top level", () => {
    const SF = ts.createSourceFile("index.ts", FN(), ts.ScriptTarget.ES2022, true);
    const reg = SF.statements.filter((s) => ts.isExpressionStatement(s) && /^globalThis\.addEventListener\?\.\("beforeunload", instOnUnload\)$/.test(s.expression.getText(SF)));
    expect(reg).toHaveLength(1);
  });

  it("each slice stamps cpuProxyMs on slice_stats and clears the running mark at its record", async () => {
    const writes: Array<Record<string, unknown>> = [];
    const client = stubClient((c: Call) => {
      const ups = op(c, "upsert");
      if (ups) { writes.push((ups[1][0] as { v: Record<string, unknown> }).v); return { error: null }; }
      return { data: { v: {} }, error: null };
    });
    const instSlice = { at: Date.now() - 5_000, boardsDone: 3, fetched: 90 };
    const deps: Record<string, unknown> = {
      instSlice, sliceCpuMs: 1_234.6, memStamp: () => ({}), sliceBudgetNote: null, sliceStampError: null, sliceCursorNote: null,
      DYNAMIC_LIGHT: new Set(), AUTO_LIGHT_CAP: 1, sliceStaleNote: null, sliceDbFailNote: null, sliceLightReread: null,
      addLightReread: () => ({}), sliceReads: { streamed: 0, bare: 0, rateLimited: [], rawNoRows: [], srPartial: [] },
      SLICE_STATS_WRITE_MS: 5_000, currentHop: 3,
    };
    const rec = await compile(fnSource("recordSliceStats"), "return recordSliceStats;")(deps) as (c: unknown, t: number, hot: boolean) => Promise<void>;
    await rec(client, Date.now() - 5_000, false);
    expect(writes.at(-1)?.cpuProxyMs).toBe(1_235);
    expect(instSlice.at, "a recorded slice is not a running one").toBe(0);
  });

  it("cpuProxyMs sums each board's description and row building, and the slice resets it once admitted", () => {
    const rr = fnSource("runRefresh");
    const start = rr.indexOf("const cpu0 = performance.now();");
    expect(start).toBeGreaterThan(-1);
    expect(rr.indexOf("const descs = new Map<string, string>();")).toBeGreaterThan(start);
    const rows = rr.indexOf("const rows = [...rowsById.values()];");
    expect(rows).toBeGreaterThan(start);
    expect(rr.slice(rows).split("\n")[1].trim(), "the span closes on the line after the rows are built").toBe("sliceCpuMs += performance.now() - cpu0;");
    expect(rr).toMatch(/currentHop = chainHop;\s*sliceCpuMs = 0;\s*instSlice = \{ at: sliceWallStart, boardsDone: 0, fetched: 0 \};/);
  });

  it("status.inst lists the slots newest first and counts this build's", async () => {
    const f = await compile(fnSource("instStatus"), "return instStatus;")({ INST_SLOTS: ["inst:0", "inst:1", "inst:2", "inst:3", "inst:4"], BUILD_VERSION: "2026-09-09.103" }) as (r: Map<string, unknown>, hb: unknown) => Record<string, unknown>;
    const rows = new Map<string, Record<string, unknown>>([
      ["inst:3", { at: "2026-11-18T06:00:00Z", build: "2026-09-09.103", reason: "Memory" }],
      ["inst:1", { at: "2026-11-18T07:00:00Z", build: "2026-09-09.103", reason: "CPUTime" }],
      ["inst:0", { at: "2026-11-17T07:00:00Z", build: "2026-09-09.102", reason: "WallClockTime" }],
      ["pass_chain", { startedAt: "x" }],
    ]);
    const out = f(rows, { mark: "board-fetched", cpuProxyMs: 9 });
    expect((out.lastStamps as Array<{ reason: string }>).map((x) => x.reason)).toEqual(["CPUTime", "Memory", "WallClockTime"]);
    expect(out.countThisBuild).toBe(2);
    expect(out.lastHeartbeat).toEqual({ mark: "board-fetched", cpuProxyMs: 9 });
  });
});

describe("XR-6 (W4-4): the per-board breadcrumbs write at most once per 2 s per isolate", () => {
  const traceWorld = () => {
    let clock = 1_000_000;
    class FakeDate extends Date {
      constructor(...a: unknown[]) { super(...((a.length ? a : [clock]) as [number])); }
      static now() { return clock; }
    }
    const marks: string[] = [];
    const client = stubClient((c: Call) => {
      const ups = op(c, "upsert");
      if (ups) marks.push(String((ups[1][0] as { v: { mark: string } }).v.mark));
      return { error: null };
    });
    const instSlice = { at: clock, boardsDone: 0, fetched: 0 };
    const deps: Record<string, unknown> = {
      Date: FakeDate, currentHop: 5, traceSeq: 0, memStamp: () => ({}), sliceCpuMs: 0, instSlice,
      TRACE_GAP_MS: 2_000, traceWroteAt: 0,
    };
    const tick = (ms: number) => { clock += ms; };
    return { deps, marks, client, tick, instSlice };
  };

  it("boards inside 2 s of the last trace write none; a board after the gap writes again; the phase marks always write", async () => {
    const w = traceWorld();
    const breadcrumb = await compile(fnSource("breadcrumb"), "return breadcrumb;")(w.deps) as (c: unknown, m: string, x?: Record<string, unknown>) => Promise<void>;
    await breadcrumb(w.client, "slice-start");
    for (let i = 1; i <= 10; i++) { w.tick(100); await breadcrumb(w.client, i % 2 ? "board-fetched" : "board-stored", { boardsDone: i, fetched: i * 30 }); }
    await breadcrumb(w.client, "loop-done");
    await breadcrumb(w.client, "pass-end");
    w.tick(2_000);
    await breadcrumb(w.client, "board-fetched", { boardsDone: 11, fetched: 330 });
    expect(w.marks).toEqual(["slice-start", "loop-done", "pass-end", "board-fetched"]);
    expect(w.instSlice, "the shutdown stamp still sees the last board the throttle skipped").toMatchObject({ boardsDone: 11, fetched: 330 });
  });
});
