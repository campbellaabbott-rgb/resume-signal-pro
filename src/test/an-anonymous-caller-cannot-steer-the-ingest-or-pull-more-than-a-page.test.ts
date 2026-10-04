// @vitest-environment node
//
// Node, not jsdom: the handler half bundles job-board with esbuild, which
// refuses jsdom's TextEncoder (see helpers/edge-harness.ts).
/**
 * AN ANONYMOUS CALLER CANNOT STEER THE INGEST, FORGE ITS RECORDS, OR PULL MORE
 * THAN A PAGE (job-board .88; defect-sweep 2026-10-02 items 2.12 and 2.24).
 *
 * WHAT WAS WRONG.
 *   2.12  `verify` queued the board of every id it was handed -- before
 *         probing, for ids that were never postings -- and the refresh put up
 *         to five queued boards at the head of EVERY cold slice for twenty
 *         minutes and never removed one. One anonymous request every twenty
 *         minutes could spend most of each slice's 1,500-posting budget on
 *         boards it chose, cutting the cold rotation by ~80% or more.
 *   2.24  a company token with a literal quote reached the list through
 *         supabase-js's .in() as a different token than the count's text[],
 *         so the page served one employer's rows under total 0, the
 *         filter-integrity sensor fired, and ONE overwritable meta row -- the
 *         board's only record of its last real incident -- was replaced with
 *         the caller's own filters. Live, a real workMode incident was lost.
 *   AND   every caller could ask list for 200 rows a call; audit and
 *         vendor-health took `force` from anyone (100 live probes / 35 vendor
 *         fetches a request); verify fanned out to 12 vendors a call;
 *         fit-batch's allowance keyed on the first forwarded hop, which the
 *         caller writes.
 *
 * WHAT THIS HOLDS, by running the shipped handler with only its network
 * faked (helpers/edge-harness.ts, helpers/proxy-db.ts) and by exercising the
 * pure rules in abuse-guards.ts.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { ProxyDb, argOf, eqs, type Answer, type Query } from "./helpers/proxy-db";
import { codeOf } from "./helpers/strip-comments";
import { CATALOG } from "./helpers/catalog";
import {
  addressAllowance, admitDemand, demandLaneStatus, DEMAND_COOLDOWN_MS, DEMAND_PER_HOUR, DEMAND_PER_SLICE, DEMAND_QUEUE_MAX, DEMAND_TTL_MS,
  incidentRows, summariseIncidents, takeDemand, type DemandRow,
} from "../../supabase/functions/job-board/abuse-guards";
import { BROWSER_PAGE_ROWS, pageCeiling, TOOLING_PAGE_ROWS } from "../../supabase/functions/job-board/anon-budget";
import { COMPANY_TOKEN_SHAPE, normalizeFilters } from "../../supabase/functions/job-board/filters";
import { boardReaderHeader } from "../../supabase/functions/_shared/board-reader-key";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const ROOT = resolve(__dirname, "../..");
const INDEX = codeOf(readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8"));
const H = (o: Record<string, string>) => new Headers(o);
const MIN = 60_000;

// ── 2.12: the demand lane, as rules ─────────────────────────────────────────

describe("2.12 the demand lane: one board a slice, a capped number an hour, each once a cooldown", () => {
  const T0 = Date.UTC(2026, 9, 4, 12, 0, 0);

  it("verify queues new boards, keeps a queued board's place, and refuses one still cooling", () => {
    const first = admitDemand(null, ["a", "b", "a"], T0)!;
    expect(first.tokens).toEqual([{ t: "a", at: T0 }, { t: "b", at: T0 }]);
    expect(admitDemand(first, ["a"], T0 + MIN), "a repeat cannot keep a board fresh forever").toBeNull();
    const cooled: DemandRow = { tokens: [], served: [{ t: "a", at: T0 }] };
    expect(admitDemand(cooled, ["a"], T0 + DEMAND_COOLDOWN_MS - MIN), "served inside the cooldown").toBeNull();
    expect(admitDemand(cooled, ["a"], T0 + DEMAND_COOLDOWN_MS + MIN)?.tokens?.map((e) => e.t), "and askable again after it").toEqual(["a"]);
    const stale = admitDemand({ tokens: [{ t: "old", at: T0 - DEMAND_TTL_MS - 1 }] }, ["n"], T0)!;
    expect(stale.tokens!.map((e) => e.t), "an expired request is dropped").toEqual(["n"]);
    const many = admitDemand(null, Array.from({ length: 100 }, (_, i) => `t${i}`), T0)!;
    expect(many.tokens).toHaveLength(DEMAND_QUEUE_MAX);
    expect(admitDemand({ tokens: "junk" } as unknown as DemandRow, ["x"], T0)?.tokens, "an unreadable row is an empty queue").toEqual([{ t: "x", at: T0 }]);
  });

  it("a cold slice takes at most one, only what it may take, and the taken board leaves the queue and starts cooling", () => {
    const row: DemandRow = { tokens: ["hot", "b", "c"].map((t) => ({ t, at: T0 })) };
    const pick = takeDemand(row, T0 + MIN, (t) => t !== "hot");
    expect(DEMAND_PER_SLICE).toBe(1);
    expect(pick.take).toEqual(["b"]);
    expect(pick.next!.tokens!.map((e) => e.t), "the hot board stays queued, unserved").toEqual(["hot", "c"]);
    expect(pick.next!.served).toEqual([{ t: "b", at: T0 + MIN }]);
    expect(takeDemand(pick.next, T0 + 2 * MIN, () => true).take, "the next slice takes the next board, never b again").toEqual(["hot"]);
    expect(takeDemand(row, T0 + MIN, () => false), "nothing eligible: nothing taken, nothing written").toEqual({ take: [], next: null });
  });

  it("THE REGISTER'S ATTACK: five large boards re-asked every minute for an hour of ~300 slices gets at most DEMAND_PER_HOUR boards, not five a slice", () => {
    let row: DemandRow | null = null;
    let injected = 0;
    let slicesWithDemand = 0;
    for (let s = 0; s < 300; s++) {
      const now = T0 + s * 12_000;
      // Every minute the attacker re-sends five boards, rotating names so the cooldown cannot help.
      if (s % 5 === 0) row = admitDemand(row, [0, 1, 2, 3, 4].map((i) => `big${(s / 5) * 5 + i}`), now) ?? row;
      const pick = takeDemand(row, now, () => true);
      expect(pick.take.length).toBeLessThanOrEqual(1);
      injected += pick.take.length;
      if (pick.take.length) slicesWithDemand++;
      if (pick.next) row = pick.next;
    }
    expect(DEMAND_PER_HOUR).toBe(12);
    expect(injected, "the lane's whole hour").toBe(DEMAND_PER_HOUR);
    // Before .88: five boards at the head of all 300 slices.
    expect(slicesWithDemand / 300).toBeLessThanOrEqual(0.04);
  });

  it("status reports the lane as counts and its rules, never a board token", () => {
    const s = demandLaneStatus({ tokens: [{ t: "secret-board", at: T0 }], served: [{ t: "x", at: T0 - 30 * MIN }, { t: "y", at: T0 - 2 * 3_600_000 }] }, T0);
    expect(s).toEqual({ queued: 1, servedLastHour: 1, cooling: 2, perSlice: 1, perHour: 12, cooldownMin: 180 });
    expect(JSON.stringify(s)).not.toMatch(/secret-board/);
    expect(INDEX).toMatch(/demandLane: demandLaneStatus\(/);
  });

  it("the same five boards, re-asked forever, are each served once per cooldown", () => {
    let row: DemandRow | null = null;
    const served: string[] = [];
    for (let s = 0; s < 900; s++) {
      const now = T0 + s * 12_000; // three hours
      row = admitDemand(row, ["w1", "w2", "w3", "w4", "w5"], now) ?? row;
      const pick = takeDemand(row, now, () => true);
      served.push(...pick.take);
      if (pick.next) row = pick.next;
    }
    expect(served.sort()).toEqual(["w1", "w2", "w3", "w4", "w5"]);
  });
});

// ── 2.24: the company token and the incident record, as rules ───────────────

describe("2.24 a company token is the catalogue's spelling, and the incident record holds nothing the caller wrote", () => {
  it("a token with a quote, a backslash, a comma or a bracket is refused and named, never bound", () => {
    for (const bad of ['"dominos"', 'x","dominos', "a,b", "a(b)", "a)", "a\\b", "", "has space", "x".repeat(129)]) {
      const n = normalizeFilters({ companies: [bad] }, 50_000);
      expect(n.applied.companies, JSON.stringify(bad)).toEqual([]);
      expect(n.ignored, JSON.stringify(bad)).toContain("companies");
    }
    const mixed = normalizeFilters({ companies: ['"dominos"', "acme"] }, 50_000);
    expect(mixed.applied.companies).toEqual(["acme"]);
    expect(mixed.ignored).toContain("companies");
    expect(normalizeFilters({ companies: ["no-such-company"] }, 50_000).ignored, "an unknown but well-formed token is a real question").not.toContain("companies");
  });

  it("every catalogued token passes the shape (so no real employer filter is refused)", () => {
    expect(CATALOG.length).toBeGreaterThan(40_000);
    const refused = CATALOG.filter((e) => !COMPANY_TOKEN_SHAPE.test(e.token)).map((e) => e.token);
    expect(refused).toEqual([]);
    for (const t of ["edel~us2~CX_1", "eu~acme", "binance.us", "Preference-Model"]) expect(COMPANY_TOKEN_SHAPE.test(t), t).toBe(true);
  });

  it("an incident is one row per field, keyed by the field, carrying only the served rows' own values", () => {
    const stamp = "2026-10-04T12:00:00.000Z";
    const rows = incidentRows([
      { field: "workMode", want: "remote", got: "onsite" },
      { field: "workMode", want: "remote", got: "hybrid" },
      { field: "department", want: "CALLER TEXT", got: "Sales" },
      { field: "bad field!", want: "x", got: "y" },
    ] as Array<{ field: string; want: string; got: string }>, 25, stamp);
    expect(rows.map((r) => r.k).sort()).toEqual(["filter_integrity_incident.department", "filter_integrity_incident.workMode"]);
    const wm = rows.find((r) => r.k.endsWith("workMode"))!;
    expect(wm).toEqual({ k: "filter_integrity_incident.workMode", v: { at: stamp, field: "workMode", violations: 2, rows: 25, sample: ["onsite", "hybrid"] }, updated_at: stamp });
    expect(JSON.stringify(rows), "the caller's text is not stored").not.toMatch(/CALLER TEXT|want|filters/);
  });

  it("status reads the newest stamp across fields; a page tripping one field cannot erase another's record", () => {
    const now = Date.parse("2026-10-04T13:00:00.000Z");
    const s = summariseIncidents([
      { k: "filter_integrity_incident.workMode", v: { at: "2026-10-04T10:00:00.000Z", violations: 7, rows: 60 } },
      { k: "filter_integrity_incident.companies", v: { at: "2026-10-04T12:00:00.000Z", violations: 3, rows: 3 } },
      { k: "filter_integrity_incident.country", v: { at: "2026-10-04T12:00:00.000Z", violations: 1, rows: 3 } },
      { k: "filter_integrity_incident", v: { at: "2026-10-04T12:30:00.000Z", fields: ["companies"] } },
    ], now);
    expect(s.lastIncidentAt).toBe("2026-10-04T12:00:00.000Z");
    expect(s.lastIncidentFields, "the fields one page wrote share its stamp").toEqual(["companies", "country"]);
    expect(s.lastIncidentViolations).toBe(4);
    expect(s.lastIncidentAgeMin).toBe(60);
    expect(s.incidents.workMode, "the older real incident is still there").toEqual({ at: "2026-10-04T10:00:00.000Z", ageMin: 180, violations: 7, rows: 60 });
    expect(Object.keys(s.incidents), "the legacy single row is not read").not.toContain("");
    expect(summariseIncidents(null, now)).toMatchObject({ lastIncidentAt: null, lastIncidentFields: null, incidents: {} });
  });

  it("the handler writes incidents through the per-field rows, and status reads them by prefix", () => {
    const honesty = INDEX.slice(INDEX.indexOf("const honesty = (jobs"), INDEX.indexOf("const unfiltered = isUnfiltered(applied);"));
    expect(honesty).toMatch(/incidentRows\(v, jobs\.length, stamp\)/);
    expect(honesty, "the caller's filters never reach the record").not.toMatch(/filters: applied/);
    expect(honesty).not.toMatch(/k: v\.length \? "filter_integrity_incident"/);
    expect(INDEX).toMatch(/\.like\("k", "filter_integrity_incident\.%"\)/);
    expect(INDEX).toMatch(/summariseIncidents\(Array\.isArray\(fiBad\.data\) \? fiBad\.data : null, Date\.now\(\)\)/);
  });
});

// ── the page ceiling and the per-address allowance, as rules ────────────────

describe("no call carries more rows than the caller's page, and allowances key on the platform's address", () => {
  it("a browser's ceiling is the page's 60; our tooling and our servers keep 200", async () => {
    expect(BROWSER_PAGE_ROWS).toBe(60);
    expect(await pageCeiling(H({}), "svc")).toBe(60);
    expect(await pageCeiling(H({ "x-rsp-caller": "mcp" }), "svc"), "a declaration is not a proof").toBe(60);
    expect(await pageCeiling(H({ "x-rb-budget": "build" }), "svc")).toBe(TOOLING_PAGE_ROWS);
    expect(await pageCeiling(H({ "x-rb-budget": "probe" }), "svc")).toBe(200);
    expect(await pageCeiling(H({ authorization: "Bearer svc" }), "svc")).toBe(200);
    expect(await pageCeiling(H({ ...(await boardReaderHeader("svc")) }), "svc")).toBe(200);
    expect(await pageCeiling(H({ authorization: "Bearer " }), ""), "an empty key matches nothing").toBe(60);
  });

  it("the allowance keys on the last hop's normalised address, exempts our servers, and never refuses on an error", async () => {
    const calls: Record<string, unknown>[] = [];
    const rpc = (verdict: unknown) => async (_n: string, a: Record<string, unknown>) => { calls.push(a); return { data: verdict, error: null }; };
    expect(await addressAllowance(rpc(false), H({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }), "svc", "job-board-verify", 400)).toBe(false);
    expect(calls[0]).toEqual({ p_function: "job-board-verify", p_ip: "203.0.113.9", p_max_requests: 400, p_window_minutes: 1440 });
    await addressAllowance(rpc(true), H({ "cf-connecting-ip": "2001:db8:1:2::77" }), "svc", "f", 1);
    expect(calls[1].p_ip, "an IPv6 host is its /64").toBe("2001:db8:1:2::/64");
    calls.length = 0;
    expect(await addressAllowance(rpc(false), H({ authorization: "Bearer svc", "cf-connecting-ip": "203.0.113.9" }), "svc", "f", 1)).toBe(true);
    expect(await addressAllowance(rpc(false), H({ ...(await boardReaderHeader("svc")), "cf-connecting-ip": "203.0.113.9" }), "svc", "f", 1)).toBe(true);
    expect(await addressAllowance(rpc(false), H({ "x-forwarded-for": "10.0.0.7" }), "svc", "f", 1), "a gateway hop is no shared wall").toBe(true);
    expect(await addressAllowance(rpc(false), H({}), "svc", "f", 1)).toBe(true);
    expect(calls, "none of those asked the limiter").toEqual([]);
    expect(await addressAllowance(async () => ({ data: null, error: { message: "boom" } }), H({ "cf-connecting-ip": "203.0.113.9" }), "svc", "f", 1)).toBe(true);
    expect(await addressAllowance(async () => { throw new Error("socket"); }, H({ "cf-connecting-ip": "203.0.113.9" }), "svc", "f", 1)).toBe(true);
  });
});

// ── the handler ─────────────────────────────────────────────────────────────

const SVC = "svc_harness_key";
const GH = CATALOG.find((e) => e.source === "greenhouse" && /^[a-z0-9]+$/.test(e.token))!;
const GH2 = CATALOG.filter((e) => e.source === "greenhouse" && /^[a-z0-9]+$/.test(e.token))[1]!;

describe("the handler, run with only its network faked", () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://h.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SVC };
  let handler: EdgeHandler;
  let db: ProxyDb;
  let answers: Array<(q: Query) => Answer | undefined>;
  let pending: Promise<unknown>[];
  const fetched: string[] = [];
  beforeAll(async () => {
    g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
    g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { pending.push(p); } };
    globalThis.fetch = (async (u: unknown) => { fetched.push(String(u)); return new Response("no network in tests", { status: 503 }); }) as typeof fetch;
    handler = await loadEdgeHandler("job-board", {
      "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return globalThis.__jbDb; }",
    });
  });
  beforeEach(() => {
    db = new ProxyDb();
    answers = [];
    pending = [];
    fetched.length = 0;
    db.answer = (q) => {
      for (const a of answers) { const r = a(q); if (r) return r; }
      if (q.table === "job_board_meta" && eqs(q, "k", "refresh_head")) {
        return { data: { v: { companiesCount: 10, total: 1000, coverage: { open: 1000 } }, updated_at: new Date().toISOString() }, error: null };
      }
      return undefined;
    };
    g.__jbDb = db;
  });
  const post = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
    handler(new Request("https://h.supabase.co/functions/v1/job-board", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9", origin: "https://resumebooster.work", ...headers },
      body: JSON.stringify(body),
    }));
  const limiterSays = (fn: string, verdict: boolean) => answers.push((q) => (q.rpc === "check_rate_limit" && (q.calls[0][1][0] as Record<string, unknown>).p_function === fn ? { data: verdict, error: null } : undefined));
  /** The distinct last row index every posting read asked for (one read unfiltered, two with a count). */
  const listRange = () => [...new Set(db.on("job_board_postings", "range").map((q) => argOf(q, "range", 1) as number))];

  it("the preflight names the deployed build", async () => {
    const res = await handler(new Request("https://h.supabase.co/functions/v1/job-board", { method: "OPTIONS" }));
    expect(res.headers.get("x-fn-build")).toBe("job-board.2026-09-09.88");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("a browser asking list for 1000 rows reads one page of 60; our tooling and servers keep 200", async () => {
    const page = { action: "list", limit: 1000, groupSimilar: false };
    expect((await post(page)).status).toBe(200);
    expect(listRange(), "rows 0..59").toEqual([59]);
    db.queries = [];
    await post({ ...page, limit: 60 });
    expect(listRange(), "the page's own ask is unchanged").toEqual([59]);
    db.queries = [];
    await post({ ...page, limit: 20 });
    expect(listRange(), "a smaller ask is honoured").toEqual([19]);
    for (const h of [{ "x-rb-budget": "probe" }, { "x-rb-budget": "build" }, { authorization: `Bearer ${SVC}` }, await boardReaderHeader(SVC)]) {
      db.queries = [];
      await post(page, h);
      expect(listRange(), JSON.stringify(Object.keys(h))).toEqual([199]);
    }
    db.queries = [];
    await post({ action: "list", limit: 1000 });
    expect(listRange(), "grouped: three rows read per row shown, still one page's worth").toEqual([179]);
  });

  it("a quoted company token is refused and named; it never reaches .in() as another employer", async () => {
    const res = await post({ action: "list", companies: ['"dominos"', 'x","dominos'], groupSimilar: false });
    const body = await res.json();
    expect(body.ignoredFilters).toContain("companies");
    const bound = db.on("job_board_postings", "in").map((q) => argOf(q, "in", 1));
    expect(JSON.stringify(bound)).not.toMatch(/dominos/);
    expect(JSON.stringify(db.rpcArgs("count_jobs_capped"))).not.toMatch(/dominos/);
  });

  it("verify probes five ids at most, and queues a board only for a posting the board holds", async () => {
    const held = `greenhouse:${GH.token}:111`;
    answers.push((q) => (q.table === "job_board_postings" && q.calls.some(([m]) => m === "in") && argOf(q, "select") === "id, apply_url"
      ? { data: [{ id: held, apply_url: null }], error: null } : undefined));
    const ids = [held, ...Array.from({ length: 11 }, (_, i) => `greenhouse:${GH2.token}:${900 + i}`)];
    const res = await post({ action: "verify", ids });
    expect(res.status).toBe(200);
    const live = (await res.json()).live as Record<string, unknown>;
    expect(Object.keys(live)).toHaveLength(5);
    expect(fetched.filter((u) => u.includes("greenhouse")).length, "one vendor probe per id, five ids").toBe(5);
    const demand = db.on("job_board_meta", "upsert").map((q) => argOf(q, "upsert") as { k: string; v: DemandRow }).filter((u) => u.k === "demand");
    expect(demand).toHaveLength(1);
    expect(demand[0].v.tokens!.map((e) => e.t), "the held posting's board, and not the board of ids it never stored").toEqual([GH.token]);
  });

  it("verify of ids the board never stored queues nothing", async () => {
    await post({ action: "verify", ids: [`greenhouse:${GH.token}:404404`] });
    expect(db.on("job_board_meta", "upsert").map((q) => (argOf(q, "upsert") as { k: string }).k)).not.toContain("demand");
  });

  it("verify past its per-address allowance is a 429 the page does not mistake for the board budget, and probes nothing", async () => {
    limiterSays("job-board-verify", false);
    const res = await post({ action: "verify", ids: [`greenhouse:${GH.token}:1`] }, { "x-forwarded-for": "6.6.6.6, 198.51.100.4", "cf-connecting-ip": "" });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toMatchObject({ rateLimited: true });
    expect(body.error, "board_budget latches a standing refusal of the whole board in the page").not.toBe("board_budget");
    expect(db.rpcArgs("check_rate_limit")[0]).toMatchObject({ p_function: "job-board-verify", p_ip: "198.51.100.4", p_max_requests: 400, p_window_minutes: 1440 });
    expect(fetched).toEqual([]);
    expect(db.on("job_board_postings")).toEqual([]);
  });

  it("the service key never meets the verify allowance", async () => {
    limiterSays("job-board-verify", false);
    const res = await post({ action: "verify", ids: [`greenhouse:${GH.token}:1`] }, { authorization: `Bearer ${SVC}` });
    expect(res.status).toBe(200);
    expect(db.rpcArgs("check_rate_limit")).toEqual([]);
  });

  it("report past its allowance records nothing; click past its allowance answers and records nothing", async () => {
    limiterSays("job-board-report", false);
    limiterSays("job-board-click", false);
    const rep = await post({ action: "report", id: `greenhouse:${GH.token}:1`, reason: "gone" });
    expect(rep.status).toBe(429);
    expect((await rep.json()).error).not.toBe("board_budget");
    expect(db.on("job_board_posting_reports")).toEqual([]);
    const click = await post({ action: "click", postingId: `greenhouse:${GH.token}:1` });
    expect(click.status).toBe(200);
    await Promise.all(pending);
    expect(db.on("job_board_search_clicks")).toEqual([]);
    expect(db.rpcArgs("check_rate_limit").map((a) => [a.p_function, a.p_max_requests])).toEqual([["job-board-report", 30], ["job-board-click", 1000]]);
  });

  it("within the allowance a report and a click are recorded as before", async () => {
    const rep = await post({ action: "report", id: `greenhouse:${GH.token}:1`, reason: "other" });
    expect(rep.status).toBe(200);
    expect(db.on("job_board_posting_reports", "insert")).toHaveLength(1);
    await post({ action: "click", postingId: `greenhouse:${GH.token}:1` });
    await Promise.all(pending);
    expect(db.on("job_board_search_clicks", "insert")).toHaveLength(1);
  });

  it("fit-batch's allowance keys on the platform's address, never the first forwarded hop", async () => {
    await post({ action: "fit-batch", resumeText: "x ".repeat(80), ids: ["greenhouse:a:1"] }, { "cf-connecting-ip": "", "x-forwarded-for": "6.6.6.6, 203.0.113.50" });
    expect(db.rpcArgs("check_rate_limit")).toEqual([{ p_function: "job-board-fit", p_ip: "203.0.113.50", p_max_requests: 120, p_window_minutes: 1440 }]);
  });

  it("audit and vendor-health take force only from maintenance, and an expired cache starts one run", async () => {
    const fresh = new Date().toISOString();
    answers.push((q) => (q.table === "job_board_meta" && (eqs(q, "k", "audit") || eqs(q, "k", "vendor_health")) && q.mode === "maybe"
      ? { data: { v: { at: fresh, note: "cached" }, updated_at: fresh }, error: null } : undefined));
    for (const action of ["audit", "vendor-health"]) {
      const res = await post({ action, force: true });
      expect(await res.json(), action).toMatchObject({ cached: true });
    }
    expect(fetched, "no vendor was probed").toEqual([]);
    expect(db.on("job_board_postings"), "no audit sample was drawn").toEqual([]);
  });

  it("with the cache expired and a run already claimed, a caller gets the old result, not a second run", async () => {
    const old = new Date(Date.now() - 48 * 3_600_000).toISOString();
    answers.push((q) => (q.table === "job_board_meta" && (eqs(q, "k", "audit") || eqs(q, "k", "vendor_health")) && q.mode === "maybe"
      ? { data: { v: { at: old }, updated_at: old }, error: null } : undefined));
    // The claim: the conditional update matches no row, and the insert meets the row another caller holds.
    answers.push((q) => (q.table === "job_board_meta" && q.calls.some(([m]) => m === "lt") ? { data: [], error: null } : undefined));
    answers.push((q) => (q.table === "job_board_meta" && q.calls.some(([m]) => m === "insert") ? { data: null, error: { code: "23505", message: "duplicate key" } } : undefined));
    for (const action of ["audit", "vendor-health"]) {
      const res = await post({ action });
      expect(await res.json(), action).toMatchObject({ cached: true, running: true });
    }
    expect(fetched).toEqual([]);
    expect(db.on("job_board_postings")).toEqual([]);
  });
});

// ── the refresh's half of the lane, in the code that ships ──────────────────

describe("the refresh takes from the lane through takeDemand and consumes only what an admitted slice took", () => {
  const RR = INDEX.slice(INDEX.indexOf("async function runRefresh("), INDEX.indexOf("const queue = [...slice];"));

  it("one cold board, catalogued, not hot, not already in the slice", () => {
    expect(RR).toMatch(/takeDemand\(demandMeta\?\.v as DemandRow \| null, Date\.now\(\), \(t\) => CATALOGUE_TOKENS\.has\(t\) && !sliceTokens\.has\(t\) && !hotTokens\.has\(t\)\)/);
    expect(RR, "the old five-a-slice take is gone").not.toMatch(/\.slice\(0, 5\)/);
    expect(RR).not.toMatch(/20 \* 60_000 && !sliceTokens\.has/);
  });

  it("the queue is written after the slice is admitted, so a declined slice spends nothing", () => {
    const admit = RR.indexOf("await admitSlice(client, next,");
    const write = RR.indexOf('upsert({ k: "demand", v: demandNext');
    expect(admit).toBeGreaterThan(0);
    expect(write).toBeGreaterThan(admit);
  });

  it("verify admits through admitDemand and the queue no longer refreshes a board's stamp on every ask", () => {
    const verify = INDEX.slice(INDEX.indexOf('if (action === "verify")'), INDEX.indexOf('if (action === "audit")'));
    expect(verify).toMatch(/admitDemand\(dm\?\.v as DemandRow \| null, \[\.\.\.demandTokens\], Date\.now\(\)\)/);
    expect(verify).toMatch(/if \(applyBy\.has\(id\)\) demandTokens\.add\(src\.token\);/);
    expect(verify).not.toMatch(/\.slice\(-60\)/);
  });
});
