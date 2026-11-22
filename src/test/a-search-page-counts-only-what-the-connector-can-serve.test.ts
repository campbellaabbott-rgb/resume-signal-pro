// @vitest-environment node
/**
 * A PAGE OF TEN HOLDS TEN POSTINGS THE CONNECTOR MAY HAND ON WHEN THE BOARD
 * HAS THEM WITHIN TWO MORE READS, PAGE TWO NEITHER REPEATS NOR SKIPS, A SHORT
 * PAGE SAYS WHY, AND TOTAL SUBTRACTS WITHHELD ROWS ONLY WHEN THE COUNT IS
 * PROVABLY THE SAME SEARCH (lane fix/1121-connector-errors, item 1).
 *
 * Live 2026-11-21: 17 of 150 benchmark slots came back empty on 10 of 15
 * inputs. The board was asked for exactly `limit` rows, the withheld rows
 * were dropped on the way out, and nothing took their place: Manager in
 * Italy answered 6 rows for 10 asked, withheld 4, hasMore true. The benchmark
 * scores an empty slot as a wrong answer.
 *
 * Two layers: the shipped agent-mcp handler on a keyless call (only its
 * network faked), and the pure filler with its clock and timers faked for the
 * bounds (no refill read after 3 s, none waited for past 6 s, never a third).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";
import { ALLOWED, RecordingDb, callApi, loadPublicApi, useDb, type Fetched } from "./helpers/public-api-harness";
import type { EdgeHandler } from "./helpers/edge-harness";
import {
  fillPage, countReadAllowed, totalWithoutWithheld,
  type BoardAnswer, type PageGate, type Row,
} from "../../supabase/functions/agent-mcp/board-page-fill.ts";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

/** 30 ranked rows; the positions given (0-based) are SmartRecruiters rows. */
function pool(withheldAt: number[], usajobsAt: number[] = []): Row[] {
  return Array.from({ length: 30 }, (_, i) => {
    const source = withheldAt.includes(i) ? "smartrecruiters" : usajobsAt.includes(i) ? "usajobs" : "greenhouse";
    return { id: `${source}:acme:${i}`, source, token: "acme", company: "Acme", title: `Manager ${i}`, country: "IT" };
  });
}

/** A board that answers offset and limit exactly, as the live one measured (probe-offset-reads.json). */
function exactBoard(rows: Row[], extra: (body: Record<string, unknown>) => Record<string, unknown> = () => ({})) {
  return (body: Record<string, unknown>): BoardAnswer => {
    if (body.countOnly) return { total: rows.filter((r) => r.source === body.vendor).length, ...extra(body) };
    const offset = Number(body.offset ?? 0);
    const limit = Number(body.limit ?? 20);
    const page = rows.slice(offset, offset + limit);
    return { jobs: page, total: rows.length, hasMore: offset + limit < rows.length, nextOffset: offset + limit, ...extra(body) };
  };
}

describe("through the connector: the page is filled past the withheld rows", () => {
  let m: KeylessMcp;
  beforeEach(async () => {
    m = await bootKeylessMcp();
  }, 120_000);

  const answer = async (args: Record<string, unknown>) => {
    const r = await m.call(args);
    return { ...r, body: JSON.parse(r.text) as Record<string, unknown> };
  };
  const pages = () => m.boardCalls.filter((b) => !b.countOnly && !b.explain);

  it("a page of ten holds ten servable rows, read as 10, then 4 at offset 10, then 1 at offset 14, each refill with noLog and the same search", async () => {
    const rows = pool([3, 5, 8, 9, 12]);
    const board = exactBoard(rows);
    m.board = (b) => new Response(JSON.stringify(board(b)), { status: 200 });
    const r = await answer({ query: "Manager", country: "IT", companies: "acme", limit: 10 });
    expect(r.isError).toBe(false);
    const jobs = r.body.jobs as Array<{ id: string }>;
    expect(jobs).toHaveLength(10);
    expect(jobs.some((j) => j.id.startsWith("smartrecruiters:"))).toBe(false);
    expect(r.body.withheld).toBe(5);
    expect(r.body.nextOffset).toBe(15);
    expect(r.body.refillReads).toBe(2);
    expect(r.body.pageShortBecause).toBeUndefined();
    const list = pages();
    expect(list.map((b) => [b.offset ?? 0, b.limit])).toEqual([[0, 10], [10, 4], [14, 1]]);
    for (const b of list.slice(1)) {
      expect(b.noLog).toBe(true);
      expect(b).toMatchObject({ q: "Manager", country: "IT", companies: ["acme"] });
    }
    // Page two (offset 15) answers the next rows: no id seen twice, none missing.
    m.boardCalls.length = 0;
    const two = await answer({ query: "Manager", country: "IT", companies: "acme", limit: 10, offset: 15 });
    const all = [...jobs, ...(two.body.jobs as Array<{ id: string }>)].map((j) => j.id);
    expect(new Set(all).size).toBe(all.length);
    const servable = rows.filter((x) => x.source !== "smartrecruiters").map((x) => String(x.id));
    expect(all).toEqual(servable.slice(0, all.length));
  });

  it("a withheld row at the last slot leaves 9, and the page says the two refills ran out", async () => {
    const board = exactBoard(pool([3, 5, 8, 9, 12, 14]));
    m.board = (b) => new Response(JSON.stringify(board(b)), { status: 200 });
    const r = await answer({ query: "Manager", country: "IT", limit: 10 });
    expect((r.body.jobs as unknown[]).length).toBe(9);
    expect(r.body.hasMore).toBe(true);
    expect(r.body.pageShortBecause).toBe("refill_limit");
    expect(r.body.refillReads).toBe(2);
  });

  it("a page whose only dropped row is an unlabelled federal one is refilled though the board echoes its SmartRecruiters fence, and makes no count read", async () => {
    const board = exactBoard(pool([], [4]), () => ({ excludedSources: ["smartrecruiters"] }));
    m.board = (b) => new Response(JSON.stringify(board(b)), { status: 200 });
    const r = await answer({ query: "Manager", country: "IT", limit: 10 });
    expect((r.body.jobs as Array<{ id: string }>).map((j) => j.id).some((id) => id.startsWith("usajobs:"))).toBe(false);
    expect((r.body.jobs as unknown[]).length).toBe(10);
    expect(r.body.refillReads).toBe(1);
    expect(m.boardCalls.some((b) => b.countOnly)).toBe(false);
    expect(r.body.withheldNote).toMatch(/USAJOBS announcements whose statement of who may apply is not stored yet/);
  });

  it("a page with nothing dropped makes exactly one board call", async () => {
    const board = exactBoard(pool([]));
    m.board = (b) => new Response(JSON.stringify(board(b)), { status: 200 });
    const r = await answer({ query: "Manager", country: "IT", limit: 10 });
    expect((r.body.jobs as unknown[]).length).toBe(10);
    expect(pages()).toHaveLength(1);
    expect(r.body.refillReads).toBeUndefined();
    expect(r.body.withheld).toBeUndefined();
  });

  it("one SmartRecruiters and one unlabelled federal row give today's two-reason note word for word", async () => {
    const rows = pool([2], [6]);
    m.board = (b) => {
      const offset = Number(b.offset ?? 0);
      if (b.countOnly) return new Response(JSON.stringify({ total: 1 }), { status: 200 });
      // No more to read: the reasons are judged on the one page.
      return new Response(JSON.stringify({ jobs: rows.slice(offset, offset + Number(b.limit)), total: 10, hasMore: false }), { status: 200 });
    };
    const r = await answer({ query: "Manager", country: "IT", limit: 10 });
    expect(r.body.withheld).toBe(2);
    expect(String(r.body.withheldNote)).toMatch(/^2 more postings are on this page only on resumebooster\.work \(SmartRecruiters[^;]*; USAJOBS announcements whose statement of who may apply is not stored yet, which this server does not hand on yet\): https:\/\/resumebooster\.work\//);
  });

  it("the count read is made beside the first refill and gives total 25 and withheldTotal 5 when it is provably the same search", async () => {
    const board = exactBoard(pool([3, 5, 8, 9, 12]));
    m.board = (b) => new Response(JSON.stringify(board(b)), { status: 200 });
    const r = await answer({ query: "Manager", country: "IT", limit: 10 });
    const count = m.boardCalls.find((b) => b.countOnly);
    expect(count).toMatchObject({ countOnly: true, vendor: "smartrecruiters", noLog: true, q: "Manager", country: "IT" });
    expect(count).not.toHaveProperty("limit");
    expect(count).not.toHaveProperty("offset");
    expect(r.body.total).toBe(25);
    expect(r.body.withheldTotal).toBe(5);
    expect(r.body.totalIncludesWithheld).toBeUndefined();
  });

  it("a routed search makes no count read, and its total says it still counts the withheld rows", async () => {
    const board = exactBoard(pool([3, 5, 8, 9, 12]), (b) => (b.countOnly ? {} : { searchRoute: "SIMPLE" }));
    m.board = (b) => new Response(JSON.stringify(board(b)), { status: 200 });
    const r = await answer({ query: "Manager", country: "IT", limit: 10 });
    expect(m.boardCalls.some((b) => b.countOnly)).toBe(false);
    expect(r.body.total).toBe(30);
    expect(r.body.totalIncludesWithheld).toBe(true);
  });

  it.each([
    ["carries a jobs array", (rows: Row[]) => ({ jobs: rows.slice(0, 1), total: 5 })],
    ["counts more than the page's total", () => ({ total: 31 })],
    ["names other ignoredFilters", () => ({ total: 5, ignoredFilters: ["country"] })],
  ])("a count answer that %s is not used, and total says it includes the withheld rows", async (_what, countAnswer) => {
    const rows = pool([3, 5, 8, 9, 12]);
    const board = exactBoard(rows);
    m.board = (b) => new Response(JSON.stringify(b.countOnly ? countAnswer(rows) : board(b)), { status: 200 });
    const r = await answer({ query: "Manager", country: "IT", limit: 10 });
    expect(r.body.total).toBe(30);
    expect(r.body.withheldTotal).toBeUndefined();
    expect(r.body.totalIncludesWithheld).toBe(true);
  });
});

describe("the filler's bounds, with its clock faked", () => {
  const gate: PageGate = async (rows) => {
    const kept = rows.filter((r) => r.source !== "smartrecruiters");
    return { kept, dropped: { bySource: rows.length - kept.length ? { smartrecruiters: rows.length - kept.length } : {}, federalUnlabelled: 0 } };
  };
  const body = { action: "list", q: "Manager", country: "IT", limit: 10 };
  afterEach(() => { vi.useRealTimers(); });

  it("a refill read that repeats an id already answered is discarded whole: hasMore and nextOffset stay the first read's", async () => {
    const rows = pool([3, 5, 8, 9]);
    const first = exactBoard(rows)(body);
    const r = await fillPage({
      read: async (b) => ({ jobs: rows.slice(9, 9 + Number(b.limit)), total: 30, hasMore: true, nextOffset: 99 }),
      gate, body, first, limit: 10, offset: 0, deepestOffset: 200,
    });
    expect(r.rows).toHaveLength(6);
    expect(r.last).toBe(first);
    expect(r.pageShortBecause).toBe("board_moved");
    expect(r.refillReads).toBe(1);
  });

  it("a refill read that never answers is abandoned at 6 s and the page is answered", async () => {
    vi.useFakeTimers();
    const rows = pool([3, 5, 8, 9]);
    const first = exactBoard(rows)(body);
    const p = fillPage({
      read: (_b, signal) => new Promise((_ok, no) => signal?.addEventListener("abort", () => no(Object.assign(new Error("aborted"), { name: "AbortError" })))),
      gate, body, first, limit: 10, offset: 0, deepestOffset: 200,
    });
    await vi.advanceTimersByTimeAsync(5_999);
    let done = false;
    void p.then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    const r = await p;
    expect(r.rows).toHaveLength(6);
    expect(r.pageShortBecause).toBe("time_budget");
  });

  it("a first read that took 3.1 s gets no refill", async () => {
    let t = 0;
    const rows = pool([3, 5, 8, 9]);
    const reads: unknown[] = [];
    const r = await fillPage({
      read: async (b) => { reads.push(b); return exactBoard(rows)(b); },
      gate, body, first: exactBoard(rows)(body), startedAt: 0, now: () => (t += 3_100), limit: 10, offset: 0, deepestOffset: 200,
    });
    expect(reads).toHaveLength(0);
    expect(r.pageShortBecause).toBe("time_budget");
  });

  it("a keyless page whose next offset is past 200 is not refilled", async () => {
    const rows = pool([3, 5, 8, 9]);
    const reads: unknown[] = [];
    const first = { ...exactBoard(rows)(body), nextOffset: 205 };
    const r = await fillPage({ read: async (b) => { reads.push(b); return {}; }, gate, body, first, limit: 10, offset: 195, deepestOffset: 200 });
    expect(reads).toHaveLength(0);
    expect(r.pageShortBecause).toBe("deepest_offset");
  });

  it("a third refill read is never made", async () => {
    const reads: Array<Record<string, unknown>> = [];
    // Every read is all withheld but one: the page never fills.
    const allHeld = pool(Array.from({ length: 30 }, (_, i) => i).filter((i) => i % 10 !== 0));
    const board = exactBoard(allHeld);
    const r = await fillPage({ read: async (b) => { reads.push(b); return board(b); }, gate, body, first: board(body), limit: 10, offset: 0, deepestOffset: 200 });
    expect(reads).toHaveLength(2);
    expect(r.refillReads).toBe(2);
    expect(r.pageShortBecause).toBe("refill_limit");
  });

  it("a count read that arrives after the refill phase plus 250 ms is not used", async () => {
    vi.useFakeTimers();
    const rows = pool([3, 5, 8, 9]);
    const board = exactBoard(rows);
    const p = fillPage({
      read: (b) => (b.countOnly ? new Promise((ok) => setTimeout(() => ok({ total: 4 }), 1_000)) : Promise.resolve(board(b))),
      gate, body, first: board(body), limit: 10, offset: 0, deepestOffset: 200, countRead: true,
    });
    await vi.advanceTimersByTimeAsync(300);
    const r = await p;
    expect(r.count.state).toBe("late");
  });

  it("the count read is allowed only beside a SmartRecruiters drop on an unrouted query, and relatedTotal moves only when both answers carry it", () => {
    const dropped = { bySource: { smartrecruiters: 1 }, federalUnlabelled: 0 };
    expect(countReadAllowed(body, { total: 9 }, dropped)).toBe(true);
    expect(countReadAllowed(body, { total: 9, searchRoute: "SIMPLE" }, dropped)).toBe(false);
    expect(countReadAllowed({ ...body, q: undefined }, { total: 9 }, dropped)).toBe(false);
    expect(countReadAllowed(body, { total: 9 }, { bySource: {}, federalUnlabelled: 1 })).toBe(false);
    expect(totalWithoutWithheld({ total: 30, relatedTotal: 50 }, { total: 5, relatedTotal: 8 })).toEqual({ total: 25, withheldTotal: 5, relatedTotal: 42 });
    expect(totalWithoutWithheld({ total: 30 }, { total: 5, relatedTotal: 8 })).toEqual({ total: 25, withheldTotal: 5 });
    expect(totalWithoutWithheld({ total: 30, relatedTotal: 50, relatedCapped: true }, { total: 5, relatedTotal: 8 })).toEqual({ total: 25, withheldTotal: 5 });
  });
});

// ---------------------------------------------------------------------------
// /v1: engine=ranked and POST /v1/fit refill the same way and make no count
// read; the default engine and /v1/changes count only the rows they served.
// ---------------------------------------------------------------------------

describe("/v1 fills its proxied pages and counts only what it served", () => {
  let handler: EdgeHandler;
  let fetched: Fetched[];
  let apiGlobals: { Deno: unknown; fetch: unknown };
  let answer: (body: Record<string, unknown>) => BoardAnswer;
  beforeAll(async () => {
    ({ handler, fetched } = await loadPublicApi((f) => {
      if (f.url.endsWith("/functions/v1/job-board")) return new Response(JSON.stringify(answer(f.body as Record<string, unknown>)), { status: 200 });
      if (f.url.endsWith("/functions/v1/job-fit")) {
        const ids = ((f.body as { ids?: string[] }).ids ?? []);
        return new Response(JSON.stringify({ fits: Object.fromEntries(ids.map((id) => [id, 50])), matched: {}, missing: {} }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }));
    const g = globalThis as Record<string, unknown>;
    apiGlobals = { Deno: g.Deno, fetch: g.fetch };
  }, 120_000);
  let db: RecordingDb;
  beforeEach(() => {
    // The connector's harness above installs its own globals; this block's handler reads the API's.
    Object.assign(globalThis as Record<string, unknown>, apiGlobals);
    fetched.length = 0;
    db = new RecordingDb();
    db.rpcs.api_key_check = () => ({ data: { ...ALLOWED, key_tier: "builder" }, error: null });
    db.rpcs.v1_withheld_company_tokens = () => ({ data: [], error: null });
    db.rpcs.api_key_fit_allowance = () => ({ data: [{ fa_user_id: null, fa_confirmed: true, fa_proven: false, fa_used: 3 }], error: null });
    db.rpcs.api_key_fit_unscored = () => ({ data: true, error: null });
    useDb(db);
  });
  const boardBodies = () => fetched.filter((f) => f.url.endsWith("/functions/v1/job-board")).map((f) => f.body as Record<string, unknown>);

  it("engine=ranked, limit 10, SmartRecruiters at 3, 5, 8, 9 and 12: ten rows, returned 10, nextOffset 15, two refill reads", async () => {
    answer = exactBoard(pool([2, 4, 7, 8, 11]));
    const r = await callApi(handler, "/v1/jobs?engine=ranked&q=manager&country=IT&limit=10");
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    const data = r.body.data as Array<Record<string, unknown>>;
    expect(data).toHaveLength(10);
    expect(data.some((x) => x.source === "smartrecruiters")).toBe(false);
    expect(r.body.page).toMatchObject({ returned: 10, nextOffset: 15, refillReads: 2, maxLimit: 100 });
    const bodies = boardBodies();
    expect(bodies.map((b) => [b.offset, b.limit])).toEqual([[0, 10], [10, 4], [14, 1]]);
    for (const b of bodies.slice(1)) expect(b).toMatchObject({ q: "manager", country: "IT", noLog: true });
    expect(bodies.some((b) => b.countOnly)).toBe(false);
  });

  it("engine=ranked: unlabelled federal rows dropped across the reads are summed in federalWithheld", async () => {
    answer = exactBoard(pool([4], [1, 11]));
    const r = await callApi(handler, "/v1/jobs?engine=ranked&q=manager&limit=10");
    expect(r.status).toBe(200);
    expect(r.body.data as unknown[]).toHaveLength(10);
    expect((r.body.disclosures as { federalWithheld?: { count: number } }).federalWithheld?.count).toBe(2);
    expect((r.body.page as { returned: number }).returned).toBe(10);
  });

  it("POST /v1/fit scores ten servable rows when the board has them", async () => {
    answer = exactBoard(pool([2, 4, 7, 8, 11]));
    const resumeText = "Operations manager with ten years running warehouses, budgets, hiring and teams across Italy. ".repeat(2);
    const r = await callApi(handler, "/v1/fit", { method: "POST", body: { resumeText, q: "manager", limit: 10 } });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    const scored = fetched.filter((f) => f.url.endsWith("/functions/v1/job-fit")).flatMap((f) => (f.body as { ids: string[] }).ids);
    expect(scored).toHaveLength(10);
    expect(scored.some((id) => id.startsWith("smartrecruiters:"))).toBe(false);
  });

  it("/v1/jobs (default engine): a federal row whose who_may_apply is blank is left out, and returned counts the rows served; the cursor stays on the rows read", async () => {
    const at = new Date(Date.now() - 3_600_000).toISOString();
    db.tables.job_board_postings = [
      { id: "greenhouse:acme:1", source: "greenhouse", company_token: "acme", company: "Acme", title: "Nurse", apply_url: "https://x/1", first_seen: at, effective_posted: at, missing_since: null },
      { id: "usajobs:usajobs:2", source: "usajobs", company_token: "usajobs", company: "VA", title: "Nurse", apply_url: "https://x/2", first_seen: at, effective_posted: at, missing_since: null, who_may_apply: "  " },
    ];
    const r = await callApi(handler, "/v1/jobs?q=nurse&limit=2");
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    expect((r.body.data as Array<{ id: string }>).map((x) => x.id)).toEqual(["greenhouse:acme:1"]);
    const page = r.body.page as { returned: number; nextCursor: string | null };
    expect(page.returned).toBe(1);
    expect(page.nextCursor).not.toBeNull();
    const cur = JSON.parse(Buffer.from(String(page.nextCursor).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as { id: string };
    expect(cur.id).toBe("usajobs:usajobs:2");
  });

  it("/v1/changes: opened leaves the blank federal row out, and openedReturned counts the rows served", async () => {
    const at = new Date(Date.now() - 3_600_000).toISOString();
    db.tables.job_board_postings = [
      { id: "greenhouse:acme:1", source: "greenhouse", company_token: "acme", company: "Acme", title: "Nurse", apply_url: "https://x/1", first_seen: at, effective_posted: at, missing_since: null },
      { id: "usajobs:usajobs:2", source: "usajobs", company_token: "usajobs", company: "VA", title: "Nurse", apply_url: "https://x/2", first_seen: at, effective_posted: at, missing_since: null, who_may_apply: "  " },
    ];
    db.tables.job_board_closures = [];
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const r = await callApi(handler, `/v1/changes?since=${encodeURIComponent(since)}`);
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    expect((r.body.opened as Array<{ id: string }>).map((x) => x.id)).toEqual(["greenhouse:acme:1"]);
    expect((r.body.page as { openedReturned: number }).openedReturned).toBe(1);
  });
});
