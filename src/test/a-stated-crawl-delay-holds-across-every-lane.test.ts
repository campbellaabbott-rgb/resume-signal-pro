// @vitest-environment node
/**
 * ITEM 18 (board .103): A HOST'S STATED CRAWL-DELAY HOLDS ACROSS EVERY LANE.
 *
 * api.lever.co and api.eu.lever.co state `Crawl-delay: 1`; careers.84lumber.com,
 * careers.petsmart.com and careers.aarp.org state 5 (robots read 2026-11-15/16).
 * Through .102 nothing in code paced them, and an iCIMS visit asked up to five
 * pages of one tenant at once. Now every request job-board sends goes through
 * one gate (_shared/host-gate.ts) whose slot for a paced host is a
 * job_board_meta row every isolate shares, an iCIMS tenant no robots ledger has
 * read is paced at 5 s, and an iCIMS visit asks one page at a time.
 *
 * The gate runs here under a virtual clock with two isolates (separate local
 * queues, one shared row store with the row's compare-and-set), and the
 * shipped fetchWithTimeout and fetchIcims are lifted and run.
 */
import { describe, expect, it } from "vitest";
import { compile, constSource, fnSource, op, eqOf, stubClient, type Call } from "./helpers/lift-index";
import { emptyFirstPage } from "../../supabase/functions/job-board/read-window";
import { icimsOrgRefusal, icimsOrgScope } from "../../supabase/functions/job-board/normalize";

const GATE = "../../supabase/functions/_shared/host-gate";
const gate = () => import(GATE);

/** The delays the robots files state, as read (legal-max carried/raw, 2026-11-15/16). */
const STATED: Record<string, number> = {
  "api.lever.co": 1_000, "api.eu.lever.co": 1_000,
  "careers.84lumber.com": 5_000, "careers.petsmart.com": 5_000, "careers.aarp.org": 5_000,
};

/** A virtual clock: sleeps resolve in time order as the driver advances it. */
function vclock() {
  let now = 0;
  const timers: Array<{ at: number; r: () => void }> = [];
  const settle = () => new Promise<void>((r) => setTimeout(r, 0));
  return {
    now: () => now,
    sleep: (ms: number) => new Promise<void>((r) => { timers.push({ at: now + ms, r }); }),
    async drive(done: () => boolean) {
      for (let i = 0; i < 20_000; i++) {
        await settle();
        if (done()) return;
        timers.sort((a, b) => a.at - b.at);
        const t = timers.shift();
        if (!t) continue;
        now = Math.max(now, t.at);
        t.r();
      }
      throw new Error("the virtual clock never finished");
    },
  };
}

/** One row store both isolates share, with the row's compare-and-set; every call yields first, so isolates interleave. */
function sharedStore(fail = false) {
  const rows = new Map<string, { stamp: string; v: Record<string, unknown> }>();
  let n = 0;
  const y = () => Promise.resolve().then(() => {});
  return {
    rows,
    store: {
      async read(h: string) { await y(); if (fail) throw new Error("unreadable"); const r = rows.get(h); return r ? { stamp: r.stamp, v: { ...r.v } } : null; },
      async create(h: string, v: Record<string, unknown>) { await y(); if (rows.has(h)) return false; rows.set(h, { stamp: String(++n), v }); return true; },
      async take(h: string, stamp: string, v: Record<string, unknown>) { await y(); const r = rows.get(h); if (!r || r.stamp !== stamp) return false; rows.set(h, { stamp: String(++n), v }); return true; },
    },
  };
}

describe("the delay table", () => {
  it("holds exactly the delays the robots files state", async () => {
    const { HOST_DELAY_MS, ICIMS_DEFAULT_DELAY_MS } = await gate();
    expect(HOST_DELAY_MS).toEqual(STATED);
    expect(ICIMS_DEFAULT_DELAY_MS).toBe(5_000);
  });

  it("an unlisted host is not paced unless the caller names it", async () => {
    const { hostDelayOf } = await gate();
    expect(hostDelayOf("https://API.lever.co/v0/postings/x?mode=json")).toEqual({ host: "api.lever.co", ms: 1_000 });
    expect(hostDelayOf("https://boards-api.greenhouse.io/v1/boards/x/jobs")).toBeNull();
    expect(hostDelayOf("https://careers.example.com/api/jobs?page=1", (h: string) => (h === "careers.example.com" ? 5_000 : undefined))).toEqual({ host: "careers.example.com", ms: 5_000 });
    expect(hostDelayOf("not a url")).toBeNull();
  });
});

describe("two isolates share each paced host's slot", () => {
  it("Lever starts at least 1,000 ms apart and iCIMS 5,000, across both isolates; an unpaced host never waits", async () => {
    const { awaitHostSlot, GATE_PAD_MS } = await gate();
    const clock = vclock();
    const { store } = sharedStore();
    const isolate = () => ({ store, now: clock.now, sleep: clock.sleep, local: new Map(), queue: new Map(), maxWaitMs: 120_000 });
    const A = isolate(), B = isolate();
    const starts: Record<string, number[]> = {};
    const urls = [
      ...Array(4).fill("https://api.lever.co/v0/postings/a?mode=json"), ...Array(3).fill("https://api.eu.lever.co/v0/postings/b?mode=json"),
      ...Array(2).fill("https://careers.petsmart.com/api/jobs?page=1"), ...Array(3).fill("https://boards-api.greenhouse.io/v1/boards/c/jobs"),
    ];
    let pending = 0;
    const results: boolean[] = [];
    for (const deps of [A, B]) {
      for (const u of urls) {
        pending++;
        void awaitHostSlot(u, deps).then((ok: boolean) => {
          results.push(ok);
          if (ok) (starts[new URL(u).host] ??= []).push(clock.now());
          pending--;
        });
      }
    }
    await clock.drive(() => pending === 0);
    expect(results.every(Boolean)).toBe(true);
    const gaps = (h: string) => starts[h].slice(1).map((t, i) => t - starts[h][i]);
    expect(starts["api.lever.co"]).toHaveLength(8);
    expect(Math.min(...gaps("api.lever.co"))).toBeGreaterThanOrEqual(1_000 + GATE_PAD_MS);
    expect(Math.min(...gaps("api.eu.lever.co"))).toBeGreaterThanOrEqual(1_000 + GATE_PAD_MS);
    expect(Math.min(...gaps("careers.petsmart.com"))).toBeGreaterThanOrEqual(5_000 + GATE_PAD_MS);
    expect(starts["boards-api.greenhouse.io"]).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("a request its slot does not reach inside the wait is refused, counting the time it queued", async () => {
    const { awaitHostSlot } = await gate();
    const clock = vclock();
    const { store } = sharedStore();
    const deps = { store, now: clock.now, sleep: clock.sleep, local: new Map(), queue: new Map(), maxWaitMs: 2_500 };
    const out: boolean[] = [];
    let pending = 5;
    for (let i = 0; i < 5; i++) void awaitHostSlot("https://api.lever.co/v0/postings/a", deps).then((ok: boolean) => { out[i] = ok; pending--; });
    await clock.drive(() => pending === 0);
    expect(out).toEqual([true, true, true, false, false]);
  });

  it("a store that cannot be read still leaves this isolate's own clock pacing", async () => {
    const { awaitHostSlot } = await gate();
    const clock = vclock();
    const { store } = sharedStore(true);
    const deps = { store, now: clock.now, sleep: clock.sleep, local: new Map(), queue: new Map(), maxWaitMs: 60_000 };
    const starts: number[] = [];
    let pending = 3;
    for (let i = 0; i < 3; i++) void awaitHostSlot("https://careers.aarp.org/api/jobs?page=1", deps).then(() => { starts.push(clock.now()); pending--; });
    await clock.drive(() => pending === 0);
    expect(starts).toEqual([0, 5_050, 10_100]);
  });

  it("the row keeps what status shows: reads, the smallest gap and since", async () => {
    const { awaitHostSlot, pacingOf } = await gate();
    const clock = vclock();
    const { store, rows } = sharedStore();
    const deps = { store, now: clock.now, sleep: clock.sleep, local: new Map(), queue: new Map(), maxWaitMs: 60_000 };
    let pending = 3;
    for (let i = 0; i < 3; i++) void awaitHostSlot("https://api.lever.co/x", deps).then(() => { pending--; });
    await clock.drive(() => pending === 0);
    expect(pacingOf([...rows].map(([h, r]) => ({ k: `host_gate:${h}`, v: r.v })))).toEqual({ "api.lever.co": { reads: 3, minGapMs: 1_050, since: new Date(0).toISOString() } });
  });
});

describe("the job_board_meta store", () => {
  it("reads the row, creates it by insert (a conflict is a lost race), and takes it only while updated_at stands", async () => {
    const { metaGateStore } = await gate();
    let insertErr: unknown = null;
    let updated: unknown[] = [{ k: "host_gate:api.lever.co" }];
    const calls: Call[] = [];
    const client = stubClient((c) => {
      if (op(c, "insert")) return { error: insertErr };
      if (op(c, "update")) return { data: updated, error: null };
      return { data: { v: { next_at: "2026-11-17T00:00:01.000Z" }, updated_at: "2026-11-17T00:00:00+00:00" }, error: null };
    }, calls);
    const s = metaGateStore(client);
    expect(await s.read("api.lever.co")).toEqual({ stamp: "2026-11-17T00:00:00+00:00", v: { next_at: "2026-11-17T00:00:01.000Z" } });
    expect(eqOf(calls[0], "k")).toBe("host_gate:api.lever.co");
    expect(await s.create("api.lever.co", {})).toBe(true);
    insertErr = { code: "23505", message: "duplicate key" };
    expect(await s.create("api.lever.co", {})).toBe(false);
    expect(await s.take("api.lever.co", "STAMP", { reads: 1 })).toBe(true);
    const take = calls.at(-1)!;
    expect([eqOf(take, "k"), eqOf(take, "updated_at")]).toEqual(["host_gate:api.lever.co", "STAMP"]);
    updated = [];
    expect(await s.take("api.lever.co", "STAMP", { reads: 1 })).toBe(false);
  });
});

describe("job-board sends every request through the gate", () => {
  const fetchWithTimeout = (hostSlot: (u: string) => Promise<boolean>, asked: string[], slept: number[]) =>
    compile(fnSource("fetchWithTimeout"), "return fetchWithTimeout;")({
      hostSlot,
      fetch: async (u: string) => { asked.push(u); return new Response("[]", { status: 200 }); },
      withWorkdayLanguage: (_u: string, _h: unknown, send: (l: Record<string, string>) => Promise<Response>) => send({}),
      bodyDeadline: (r: Response) => r, boundBody: (r: Response) => r, discardBody: () => {},
      setTimeout: (f: () => void, ms: number) => { slept.push(ms); f(); return 0; }, clearTimeout: () => {},
      MAX_RESPONSE_BYTES: 4_000_000, FETCH_TIMEOUT_MS: 20_000,
    }) as Promise<(u: string) => Promise<Response>>;

  it("a request the gate refuses never reaches the vendor and comes back a 429 deferral, with no retry wait", async () => {
    const asked: string[] = [], slept: number[] = [];
    const f = await fetchWithTimeout(async () => false, asked, slept);
    const r = await f("https://api.lever.co/v0/postings/a?mode=json");
    expect([r.status, r.headers.get("x-rb-gate"), asked, slept.filter((ms) => ms !== 20_000)]).toEqual([429, "deferred", [], []]);
  });

  it("a request the gate admits is sent", async () => {
    const asked: string[] = [], slept: number[] = [];
    const slots: string[] = [];
    const f = await fetchWithTimeout(async (u) => { slots.push(u); return true; }, asked, slept);
    expect((await f("https://api.lever.co/v0/postings/a?mode=json")).status).toBe(200);
    expect([slots, asked]).toEqual([["https://api.lever.co/v0/postings/a?mode=json"], ["https://api.lever.co/v0/postings/a?mode=json"]]);
  });

  it("an iCIMS tenant the catalogue carries is paced at the default; any other unlisted host is not", async () => {
    const scope: Record<string, unknown> = {
      icimsHosts: null, ICIMS_DEFAULT_DELAY_MS: 5_000,
      JOB_SOURCES: [{ source: "icims", token: "Careers.Example.com" }, { source: "lever", token: "acme" }],
    };
    const icimsDelay = await compile(constSource("icimsDelay"), "return icimsDelay;")(scope) as (h: string) => number | undefined;
    expect([icimsDelay("careers.example.com"), icimsDelay("acme"), icimsDelay("api.lever.co")]).toEqual([5_000, undefined, undefined]);
    expect(fnSource("hostSlot")).toMatch(/hostDelayOf\(url, icimsDelay\)[\s\S]*awaitHostSlot\(url, gateDeps\)/);
  });
});

describe("an iCIMS visit asks one page at a time", () => {
  async function visit(size: number) {
    let inFlight = 0, maxInFlight = 0;
    const asked: number[] = [];
    const scope: Record<string, unknown> = {
      fetchWithTimeout: async (url: string) => {
        const u = new URL(url);
        const page = Number(u.searchParams.get("page")), limit = Number(u.searchParams.get("limit"));
        asked.push(page);
        inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
        const start = (page - 1) * limit, n = Math.max(0, Math.min(limit, size - start));
        return new Response(JSON.stringify({ totalCount: size, jobs: Array.from({ length: n }, (_, k) => ({ id: start + k })) }), { status: 200 });
      },
      discardBody: () => {}, discardRest: () => {},
      isOversize: () => false,
      readChunkPage: async (res: Response) => ({ body: await res.json(), over: false }),
      OVERSIZE_MARKER: "OVERSIZE_BODY", MAX_RESPONSE_BYTES: 4_000_000, MAX_POSTINGS_PER_VISIT: 250,
      emptyFirstPage, icimsOrgScope, icimsOrgRefusal,
    };
    const v = await compile(`${fnSource("chunkPageRefusal")}\n${fnSource("fetchIcims")}`, `return fetchIcims({ token: "careers.example.com" }, 0, 100);`)(scope) as { items: unknown[] };
    return { asked, maxInFlight, items: v.items.length };
  }

  it("never two pages in flight, and a short first page is the only page asked", async () => {
    expect(await visit(1_000)).toEqual({ asked: [1, 2, 3], maxInFlight: 1, items: 300 });
    expect(await visit(40)).toEqual({ asked: [1], maxInFlight: 1, items: 40 });
  });
});
