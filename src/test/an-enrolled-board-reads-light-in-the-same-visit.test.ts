// @vitest-environment node
import { describe, expect, it } from "vitest";
import { advanceProgress } from "../../supabase/functions/job-board/rotation";
import { addLightReread, lightReread, lightRereadStats, type LightRereadInput } from "../../supabase/functions/job-board/light-reread";
import { startGate, type StartState } from "../../supabase/functions/job-board/start-gate";
import { runVisit } from "./helpers/slice-worker";

/**
 * AN ENROLLED BOARD READS LIGHT IN THE SAME VISIT (job-board .90, F1).
 *
 * When a greenhouse board's ?content=true list crossed the 4 MB byte bound,
 * the visit enrolled it in light mode, deferred it, and took one off the
 * cold-cursor count to "give its slot back". The cursor moves by POSITION
 * (cold + count), so taking one off made the next slice start one place
 * earlier: it re-read whichever base board was last in this slice, never the
 * board just enrolled. Every board enrolled at the byte bound waited a full
 * cold rotation for its light read. Measured on .89, 2026-10-05/06:
 * speechify 19:47 -> 01:44Z (5h57m), samsara 21:22 -> 02:59Z (5h37m), and
 * lush (73 rows served of ~212, 19 of them closed) still waiting.
 *
 * Now the visit reads the light list itself, once, under the same start gate
 * a new board passes, and the cursor counts the board as started because it
 * was. These run the shipped worker span (helpers/slice-worker.ts) and the
 * pure modules; nothing here reads a spelling.
 */

const GH = { source: "greenhouse", token: "speechify" };
const rows = (n: number) => ({ jobs: Array.from({ length: n }, (_, i) => ({ id: String(i) })), raw: { jobs: [] } });
const lightReads = (n: number) => ({ light }: { light: boolean }) =>
  light ? { read: rows(n) } : { read: null, reason: "oversize 6.1MB" };

describe("the visit, run: an oversize greenhouse board that enrols reads its light list now", () => {
  it("re-reads the LIGHT list once, under the board's reservation, and lands it as this visit's read", async () => {
    const x = await runVisit({ board: GH, failReason: "oversize 6.1MB", reread: lightReads(246), base: true, baseAttempted: 5, inFlightReserve: 7, reserve: 40 });
    expect(x.enrolCalls, "enrolled through the existing writer").toBe(1);
    expect(x.light).toBe(true);
    expect(x.fetchCalls, "exactly one further read, of the light list, from the top").toEqual([{ light: true, startOffset: 0, reserveDuring: 47 }]);
    expect(x.inFlightReserve, "and its reservation is released").toBe(7);
    expect(x.gateAsked, "behind the start gate, without the board count").toEqual([false]);
    expect(x.r?.jobs.length).toBe(246);
    expect(x.fetchedInSlice, "the landed count includes it").toBe(246);
    expect(x.boardsDone, "one board, counted once").toBe(1);
    expect(x.deferred, "not deferred").toEqual([]);
    expect(x.oversized).toEqual([]);
    expect(x.failed).toEqual([]);
    expect([...x.registry.keys()], "a board that read is not registered oversize").toEqual([]);
    expect(x.stats).toEqual({ enrolled: 1, reread: 1, ok: 1, deferred: 0 });
  });

  it("the cold cursor then advances by every base board started, the enrolled one included", async () => {
    // Five base boards started in this slice; the enrolled board is one of them and it was read.
    const x = await runVisit({ board: GH, failReason: "oversize 6.1MB", reread: lightReads(246), base: true, baseAttempted: 5 });
    expect(x.baseAttempted, "nothing takes the board back off the started count").toBe(5);
    const prev = { hot: 120, cold: 8_701, coldDone: 79, failedAcc: [], failedTotal: 0 };
    const { next } = advanceProgress({ prev, inHotPhase: false, hotSlice: 0, baseSliceLen: x.baseAttempted, coldListLen: 44_399 });
    expect(next.cold, "next cold = cold + started").toBe(8_701 + 5);
  });

  it("a board the gate refuses is enrolled and deferred: no re-read, and the cursor still counts it as started", async () => {
    for (const gate of ["landed", "wall", "heap", "reserve"]) {
      const x = await runVisit({ board: GH, failReason: "oversize 6.1MB", reread: lightReads(246), gate, base: true, baseAttempted: 5 });
      expect(x.light, `${gate}: the enrolment stands, so the next visit reads light`).toBe(true);
      expect(x.fetchCalls, `${gate}: no re-read past a refusing gate`).toEqual([]);
      expect(x.deferred).toEqual([GH.token]);
      expect(x.failed).toEqual([]);
      expect([...x.registry.keys()]).toEqual([GH.token]);
      expect(x.baseAttempted).toBe(5);
      expect(x.stats).toEqual({ enrolled: 1, reread: 0, ok: 0, deferred: 1 });
    }
  });

  it("a light list that is itself over the bound is deferred once, never looped", async () => {
    const x = await runVisit({ board: { source: "greenhouse", token: "liquidpersonnel" }, failReason: "oversize 31.0MB", reread: () => ({ read: null, reason: "oversize 13.9MB" }) });
    expect(x.fetchCalls.length, "one light read, no second").toBe(1);
    expect(x.r).toBeNull();
    expect(x.deferred).toEqual(["liquidpersonnel"]);
    expect(x.failed, "a deferral, never a vendor failure").toEqual([]);
    expect(x.registry.get("liquidpersonnel")?.mb, "registered at the size the next (light) visit will meet").toBe(13.9);
    expect(x.stats).toEqual({ enrolled: 1, reread: 1, ok: 0, deferred: 0 });
  });

  it("a light read that fails for another reason is still a deferral, at the first read's size", async () => {
    const x = await runVisit({ board: GH, failReason: "oversize 6.1MB", reread: () => ({ read: null, reason: "HTTP 503" }) });
    expect(x.fetchCalls.length).toBe(1);
    expect(x.failReason).toBe("oversize 6.1MB");
    expect(x.deferred).toEqual([GH.token]);
    expect(x.failed, "the re-read must never put the board into failed[]").toEqual([]);
    expect(x.registry.get(GH.token)?.mb).toBe(6.1);
  });

  it("re-reads only where the next read would differ: refused, not light-capable, already light, not a size verdict, or landed are left alone", async () => {
    // The positive control first: without it, code that never re-reads passes every "no re-read" below.
    const control = await runVisit({ board: GH, failReason: "oversize 6.1MB", reread: lightReads(246) });
    expect(control.fetchCalls.length, "positive control: the enrolled greenhouse board IS re-read").toBe(1);

    const refused = await runVisit({ board: GH, failReason: "oversize 6.1MB", reread: lightReads(246), refuse: true });
    expect(refused.enrolCalls).toBe(1);
    expect(refused.fetchCalls, "a refused board would re-fetch byte for byte").toEqual([]);
    expect(refused.stats).toEqual({ enrolled: 0, reread: 0, ok: 0, deferred: 0 });
    const workable = await runVisit({ board: { source: "workable", token: "afg" }, failReason: "oversize 4.4MB", reread: lightReads(10) });
    expect(workable.enrolCalls, "no enrolment for a vendor that is not light-capable").toBe(0);
    expect(workable.fetchCalls).toEqual([]);
    const already = await runVisit({ board: { source: "greenhouse", token: "pulse" }, failReason: "oversize 20.6MB", reread: lightReads(76), lightAtStart: true });
    expect(already.enrolCalls, "already light: no enrolment").toBe(0);
    expect(already.fetchCalls, "the read that failed WAS the light list").toEqual([]);
    for (const x of [refused, workable, already]) {
      expect(x.r).toBeNull();
      expect(x.deferred.length, "each is deferred").toBe(1);
      expect(x.failed).toEqual([]);
      expect(x.registry.size, "and registered oversize").toBe(1);
    }

    const http = await runVisit({ board: GH, failReason: "HTTP 500", reread: lightReads(246) });
    expect(http.enrolCalls, "a failure that is not about size is not enrolled").toBe(0);
    expect(http.fetchCalls, "nor re-read").toEqual([]);
    expect(http.failed.length, "it fails as it always did").toBe(1);
    expect(http.deferred).toEqual([]);

    const first = rows(12);
    const landed = await runVisit({ board: GH, failReason: "", firstRead: first, reread: lightReads(246) });
    expect(landed.r, "a first read that landed is the visit's read").toBe(first);
    expect(landed.enrolCalls).toBe(0);
    expect(landed.fetchCalls).toEqual([]);
    expect(landed.fetchedInSlice).toBe(12);
  });
});

describe("lightReread: the decision, case by case", () => {
  type Rows = ReturnType<typeof rows>;
  const base = (o: Partial<LightRereadInput<Rows>> = {}) => {
    const calls = { enrol: 0, gate: 0, read: 0 };
    const stats = lightRereadStats();
    const input: LightRereadInput<Rows> = {
      board: GH, failReason: "oversize 6.1MB", lightCapable: true, light: false,
      enrol: async () => { calls.enrol++; return true; },
      canStart: () => { calls.gate++; return true; },
      read: async () => { calls.read++; return { r: rows(3), failReason: "" }; },
      done: new Set<string>(), stats,
      ...o,
    };
    return { input, calls, stats };
  };

  it("enrolled greenhouse board: one read, the read returned", async () => {
    const { input, calls, stats } = base();
    const out = await lightReread(input);
    expect(out.r?.jobs.length).toBe(3);
    expect(calls).toEqual({ enrol: 1, gate: 1, read: 1 });
    expect(stats).toEqual({ enrolled: 1, reread: 1, ok: 1, deferred: 0 });
  });

  it("at most once per board per slice", async () => {
    const done = new Set<string>();
    const stats = lightRereadStats();
    await lightReread(base({ done, stats }).input);
    const again = base({ done, stats });
    expect((await lightReread(again.input)).r).toBeNull();
    expect(again.calls.read).toBe(0);
    expect(stats).toEqual({ enrolled: 2, reread: 1, ok: 1, deferred: 1 });
  });

  it("set refuses, vendor not light-capable, already light, not a size verdict: nothing read", async () => {
    for (const [why, o] of [
      ["set refuses", { enrol: async () => false }],
      ["not light-capable", { lightCapable: false }],
      ["already light", { light: true }],
      ["not a size verdict", { failReason: "timeout" }],
    ] as const) {
      const { input, calls, stats } = base(o as never);
      const out = await lightReread(input);
      expect(out, why).toEqual({ r: null, failReason: input.failReason, lightOversize: why === "already light" });
      expect(calls.read, why).toBe(0);
      expect(stats.reread, why).toBe(0);
    }
  });

  it("enrolled but not greenhouse: deferred, since only greenhouse's re-read differs", async () => {
    const { input, calls, stats } = base({ board: { source: "workable", token: "x" } });
    expect((await lightReread(input)).r).toBeNull();
    expect(calls.read).toBe(0);
    expect(stats).toEqual({ enrolled: 1, reread: 0, ok: 0, deferred: 1 });
  });

  it("gate refuses: deferred with the first verdict", async () => {
    const { input, calls, stats } = base({ canStart: () => false });
    expect(await lightReread(input), "the content list was refused, not the light list").toEqual({ r: null, failReason: "oversize 6.1MB", lightOversize: false });
    expect(calls.read).toBe(0);
    expect(stats).toEqual({ enrolled: 1, reread: 0, ok: 0, deferred: 1 });
  });

  it("light read also oversize: its own verdict, one read; another failure or a throw: the first verdict", async () => {
    const over = base({ read: async () => ({ r: null, failReason: "oversize 13.9MB" }) });
    expect(await lightReread(over.input), "the light list itself was refused by the bound").toEqual({ r: null, failReason: "oversize 13.9MB", lightOversize: true });
    const other = base({ read: async () => ({ r: null, failReason: "HTTP 503" }) });
    expect(await lightReread(other.input), "the light list failed for another reason: nothing showed it over the bound").toEqual({ r: null, failReason: "oversize 6.1MB", lightOversize: false });
    const thrown = base({ read: async () => { throw new Error("boom"); } });
    expect(await lightReread(thrown.input)).toEqual({ r: null, failReason: "oversize 6.1MB", lightOversize: false });
    for (const x of [over, other, thrown]) expect(x.stats).toEqual({ enrolled: 1, reread: 1, ok: 0, deferred: 0 });
  });

  it("slice_stats keeps running totals from the first slice that wrote them", () => {
    const a = addLightReread(undefined, { enrolled: 1, reread: 1, ok: 1, deferred: 0 }, "2026-10-07T00:00:00Z");
    expect(a).toEqual({ enrolled: 1, reread: 1, ok: 1, deferred: 0, since: "2026-10-07T00:00:00Z" });
    const b = addLightReread(a, { enrolled: 2, reread: 1, ok: 0, deferred: 1 }, "2026-10-07T01:00:00Z");
    expect(b).toEqual({ enrolled: 3, reread: 2, ok: 1, deferred: 1, since: "2026-10-07T00:00:00Z" });
    expect(addLightReread({ enrolled: "x", ok: -4 }, lightRereadStats(), "t")).toEqual({ enrolled: 0, reread: 0, ok: 0, deferred: 0, since: "t" });
  });
});

describe("startGate: one gate, the order the loop has always checked", () => {
  const g = (o: Partial<StartState> = {}): StartState => ({
    fetched: 0, inFlight: 0, postingBudget: 1_500, elapsedMs: 1_000, wallBudgetMs: 90_000, heapMb: 40, heapLimitMb: 150, ...o,
  });

  it("passes a board when nothing refuses, and an unmeasurable heap never refuses", () => {
    expect(startGate(g())).toBe("ok");
    expect(startGate(g({ heapMb: undefined }))).toBe("ok");
  });

  it("names the gate that refused", () => {
    expect(startGate(g({ fetched: 1_500 }))).toBe("landed");
    expect(startGate(g({ boards: { done: 8, budget: 8 } }))).toBe("boards");
    expect(startGate(g({ elapsedMs: 90_000 }))).toBe("wall");
    expect(startGate(g({ heapMb: 150 }))).toBe("heap");
    expect(startGate(g({ fetched: 1_000, inFlight: 500 }))).toBe("reserve");
    expect(startGate(g({ fetched: 1_000, inFlight: 499 }))).toBe("ok");
  });

  it("checks landed, boards, wall, heap, then the reservation", () => {
    const all = { fetched: 1_500, inFlight: 9_999, boards: { done: 9, budget: 8 }, elapsedMs: 99_000, heapMb: 999 };
    expect(startGate(g(all))).toBe("landed");
    expect(startGate(g({ ...all, fetched: 0 }))).toBe("boards");
    expect(startGate(g({ ...all, fetched: 0, boards: undefined }))).toBe("wall");
    expect(startGate(g({ ...all, fetched: 0, boards: undefined, elapsedMs: 0 }))).toBe("heap");
    expect(startGate(g({ ...all, fetched: 0, boards: undefined, elapsedMs: 0, heapMb: 1 }))).toBe("reserve");
  });

  it("a re-read passes no board count: the board is already started", () => {
    expect(startGate(g({ boards: { done: 80, budget: 80 } }))).toBe("boards");
    expect(startGate(g())).toBe("ok");
  });
});
