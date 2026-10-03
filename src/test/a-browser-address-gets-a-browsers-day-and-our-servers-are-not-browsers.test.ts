// @vitest-environment node
//
// Node, not jsdom: the handler half bundles job-board with esbuild, which
// refuses jsdom's TextEncoder (see helpers/edge-harness.ts).
/**
 * A BROWSER ADDRESS GETS A BROWSER'S DAY, AND OUR SERVERS ARE NOT BROWSERS.
 *
 * WHAT WAS WRONG (measured 2026-10-01/02). job-board answered list, detail and
 * facets to any anonymous caller without limit. One JS-rendering client loaded
 * /jobs?job=<id> ~5,800 times a day, about 29,000 counted board calls, and
 * harvested the corpus through the publishable key around the metered /v1 API.
 * The fix counts the data-bearing actions per address (anon-budget.ts, migration
 * 20261002140000) and refuses past the cap with an honest 429.
 *
 * WHAT THIS HOLDS:
 *   PURE MODULE. The address is cf-connecting-ip, else the LAST
 *     x-forwarded-for hop -- never the first, which the client writes. IPv6 is
 *     one bucket per /64 and an IPv4-mapped address is its IPv4 self; an
 *     address that is not public (a gateway or internal hop) is 'unknown', the
 *     observe-only bucket, never a shared wall. ONE ADDRESS IS ONE BUCKET
 *     whatever it declares: our tooling's header (public, like this repo) only
 *     picks the cap, so it lifts an address to the largest cap at most and
 *     never adds a second day row beside the first.
 *   THE HANDLER, bundled and run with only its network faked:
 *     - the service key (bearer or apikey) and our servers' reader proof make
 *       ZERO counter calls; an empty service key never matches an empty bearer;
 *     - a declared mcp caller WITHOUT the proof is counted, as unproven_mcp;
 *     - x-rb-budget: build/probe count as their kind in the SAME bucket as
 *       that address's undeclared reads;
 *     - status, refresh, click, report and budget-echo never call the counter;
 *     - a refusal is a 429 with the JSON error body, a numeric Retry-After and
 *       no-store, and NOTHING else touched the database (the gate ran before
 *       dispatch); a country refusal says code 'country';
 *     - the counter is called with an abort signal, and an error, an unapplied
 *       migration (PGRST202) or a hang past the deadline serves the request.
 *   THE CODEBASE. The gate, the module and the migration never touch the
 *     request budget shared with upload and checkout, and the browser cannot
 *     send either new header (job-board's CORS allow-list names neither).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { codeOf } from "./helpers/strip-comments";
import { sqlCodeOf } from "./helpers/live-sql";
import {
  addressKey, anonBudgetStatus, BUDGETED_ACTIONS, bucketFor, budgetRefusal, callerAddress, classifyCaller, countryOf,
  ANON_BUDGET_DEADLINE_MS, ADDRESS_DAILY_CAP, BUILD_DAILY_CAP, PROBE_DAILY_CAP, type CountedCaller,
} from "../../supabase/functions/job-board/anon-budget";
import { boardReaderHeader, boardReaderKey } from "../../supabase/functions/_shared/board-reader-key";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const H = (o: Record<string, string>) => new Headers(o);

// ── the pure module ─────────────────────────────────────────────────────────

describe("the address is the platform's word, not the caller's", () => {
  it("the LAST x-forwarded-for hop, never the first; cf-connecting-ip wins; neither is 'none'", () => {
    expect(callerAddress(H({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }))).toEqual({ address: "203.0.113.9", source: "xff" });
    expect(callerAddress(H({ "x-forwarded-for": "6.6.6.6,203.0.113.9 , 198.51.100.7" })).address).toBe("198.51.100.7");
    expect(callerAddress(H({ "cf-connecting-ip": "198.51.100.1", "x-forwarded-for": "203.0.113.9" }))).toEqual({ address: "198.51.100.1", source: "cf" });
    expect(callerAddress(H({}))).toEqual({ address: "", source: "none" });
  });

  it("IPv6 is one bucket per /64, and an IPv4-mapped address is its IPv4 self", () => {
    const a = addressKey("2001:db8:1:2:aaaa::1"), b = addressKey("2001:0db8:0001:0002:ffff:ffff:ffff:ffff"), c = addressKey("2001:db8:1:3::1");
    expect(a).toBe("2001:db8:1:2::/64");
    expect(b, "a host rotating inside its /64 stays one bucket").toBe(a);
    expect(c, "the next /64 is another bucket").not.toBe(a);
    expect(addressKey("::ffff:1.2.3.4")).toBe("1.2.3.4");
    expect(addressKey("::ffff:0102:0304")).toBe("1.2.3.4");
    expect(addressKey("[2606:4700::1]:443")).toBe("2606:4700:0:0::/64");
    expect(addressKey("8.8.8.8")).toBe("8.8.8.8");
    expect(addressKey("8.8.8.8:5555")).toBe("8.8.8.8");
    for (const ok of ["172.32.0.1", "100.128.0.1", "172.15.255.255", "192.169.0.1"]) expect(addressKey(ok), ok).toBe(ok);
  });

  it("an address that is not public is no bucket at all", () => {
    for (const bad of [
      "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.1", "100.64.0.1", "100.127.255.255", "127.0.0.1",
      "169.254.1.1", "0.1.2.3", "224.0.0.1", "255.255.255.255", "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1",
      "ff02::1", "::ffff:10.0.0.1", "not-an-ip", "", "1.2.3", "1.2.3.256", "2001:db8::1::2", "12345::1",
    ]) expect(addressKey(bad), bad).toBeNull();
  });

  it("a gateway hop is counted as unknown_address, never as a shared bucket", async () => {
    const c = await classifyCaller(H({ "x-forwarded-for": "6.6.6.6, 10.0.0.7" }), "svc");
    expect(c).toMatchObject({ exempt: false, kind: "unknown_address", key: null });
    expect(await bucketFor(c as CountedCaller, "svc")).toBe("unknown");
    expect(await classifyCaller(H({}), "svc")).toMatchObject({ kind: "unknown_address", source: "none" });
  });

  it("the country is a real two-letter code or XX", () => {
    expect(countryOf(H({ "cf-ipcountry": "cn" }))).toBe("CN");
    expect(countryOf(H({ "cf-ipcountry": "T1" }))).toBe("XX");
    expect(countryOf(H({ "cf-ipcountry": "XX" }))).toBe("XX");
    expect(countryOf(H({}))).toBe("XX");
  });

  it("one address is one bucket whatever it declares: the public header picks a cap, never a second row", async () => {
    const at = async (ip: string, h: Record<string, string> = {}, svc = "svc") =>
      bucketFor(await classifyCaller(H({ "cf-connecting-ip": ip, ...h }), svc) as CountedCaller, svc);
    const plain = await at("203.0.113.9");
    expect(plain).toMatch(/^ip:[0-9a-f]{16}$/);
    for (const h of [{ "x-rb-budget": "build" }, { "x-rb-budget": "PROBE" }, { "x-rb-budget": "admin" }, { "x-rsp-caller": "mcp" }, { "x-rsp-caller": "api" }, { "x-rsp-caller": "digest" }]) {
      expect(await at("203.0.113.9", h), `${JSON.stringify(h)} must not open a second day row for the same address`).toBe(plain);
    }
    expect((await classifyCaller(H({ "cf-connecting-ip": "203.0.113.9", "x-rb-budget": "build" }), "svc")).kind, "the kind still names the cap").toBe("build");
    expect(await at("198.51.100.7", { "x-rb-budget": "build" }), "another address is another bucket").not.toBe(plain);
    expect(plain, "keyed: the same address under another service key is another bucket").not.toBe(await at("203.0.113.9", {}, "other"));
    expect(plain).not.toContain("203.0.113.9");
    expect(Math.max(ADDRESS_DAILY_CAP, BUILD_DAILY_CAP, PROBE_DAILY_CAP), "so the most the header can claim is the largest single cap").toBe(BUILD_DAILY_CAP);
  });

  it("the service key and the reader proof are exempt; an empty key matches nothing", async () => {
    expect(await classifyCaller(H({ authorization: "Bearer svc" }), "svc")).toEqual({ exempt: true, kind: "service" });
    expect(await classifyCaller(H({ apikey: "svc" }), "svc")).toEqual({ exempt: true, kind: "service" });
    expect(await classifyCaller(H({ ...(await boardReaderHeader("svc")) }), "svc")).toEqual({ exempt: true, kind: "reader" });
    expect(await boardReaderHeader(""), "an unset key sends nothing").toEqual({});
    expect(await boardReaderKey("")).toBe("");
    expect((await classifyCaller(H({ authorization: "Bearer ", apikey: "", "x-rb-reader": "", "cf-connecting-ip": "203.0.113.9" }), "")).exempt).toBe(false);
    expect((await classifyCaller(H({ "x-rb-reader": "0".repeat(32), "x-rsp-caller": "mcp", "cf-connecting-ip": "203.0.113.9" }), "svc")).kind).toBe("unproven_mcp");
    expect((await classifyCaller(H({ "x-rsp-caller": "constructor", "cf-connecting-ip": "203.0.113.9" }), "svc")).kind).toBe("address");
  });

  it("the refusal resets at the next 00:00 UTC, and the status block reports the row as stored", async () => {
    const now = Date.UTC(2026, 9, 2, 23, 59, 30);
    const r = budgetRefusal({ code: "address", limit: 10000, used: 10000 }, { "Access-Control-Allow-Origin": "*" }, now);
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).toBe("30");
    expect((await r.json()).resetAt).toBe("2026-10-03T00:00:00.000Z");
    expect(anonBudgetStatus(null)).toMatchObject({ settingPresent: false, enforce: true, countriesListed: 0, defaults: { address: 10000, build: 15000, probe: 10000 } });
    expect(anonBudgetStatus({ enforce: false })).toMatchObject({ settingPresent: true, enforce: false, countriesListed: 0 });
    expect(anonBudgetStatus({ countries: "CN" }).countriesListed, "a non-array list is reported as invalid, not as zero").toBe("invalid");
    expect(anonBudgetStatus({ countries: ["CN"], countryCap: 0, addressCap: 3000 })).toMatchObject({ countriesListed: 1, countryCap: 0, overrides: { addressCap: 3000 } });
  });
});

// ── the handler ─────────────────────────────────────────────────────────────

const SVC = "svc_harness_key";
type Check = { args: Record<string, unknown>; signal: AbortSignal | null };
type DbResult = { data: unknown; error: { code?: string; message: string } | null };
const ALLOW = (): DbResult => ({ data: [{ is_allowed: true, used_today: 1, over_today: 0, cap_today: 10000, country_rule: false, enforcing: true }], error: null });

class MeterDb extends FakeDb {
  checks: Check[] = [];
  tablesRead: string[] = [];
  otherRpcs: string[] = [];
  verdict: (signal: AbortSignal | null) => Promise<DbResult> = async () => ALLOW();
  from(table: string) { this.tablesRead.push(table); return super.from(table); }
  // deno-lint-ignore no-explicit-any
  rpc(name: string, args: Record<string, unknown> = {}): any {
    if (name !== "job_board_anon_check") { this.otherRpcs.push(name); return super.rpc(name, args); }
    const rec: Check = { args, signal: null };
    this.checks.push(rec);
    let started: Promise<DbResult> | null = null;
    const run = () => (started ??= this.verdict(rec.signal));
    return {
      abortSignal: (s: AbortSignal) => { rec.signal = s; return { then: (a: never, b: never) => run().then(a, b) }; },
      then: (a: never, b: never) => run().then(a, b),
    };
  }
}

describe("the handler: who is counted, and what a refusal is", () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://h.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SVC };
  let db: MeterDb;
  let handler: EdgeHandler;
  const realFetch = globalThis.fetch;
  const fetched: string[] = [];
  beforeAll(async () => {
    g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
    g.EdgeRuntime = { waitUntil: () => undefined };
    globalThis.fetch = (async (u: unknown) => { fetched.push(String(u)); return new Response("no network in tests", { status: 503 }); }) as typeof fetch;
    handler = await loadEdgeHandler("job-board", {
      "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return globalThis.__jbDb; }",
    });
  });
  afterAll(() => { globalThis.fetch = realFetch; });
  beforeEach(() => { db = new MeterDb(); g.__jbDb = db; env.SUPABASE_SERVICE_ROLE_KEY = SVC; });

  const post = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
    handler(new Request("https://h.supabase.co/functions/v1/job-board", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9", "cf-ipcountry": "CN", ...headers },
      body: JSON.stringify(body),
    }));

  it("every budgeted action is counted for a browser, once, with its address bucket and country", async () => {
    const res = await post({ action: "facets" }, { origin: "https://resumebooster.work" });
    expect(res.status).toBe(200);
    expect(db.checks).toHaveLength(1);
    expect(db.checks[0].args).toMatchObject({ p_kind: "address", p_country: "CN", p_address_cap: 10000, p_build_cap: 15000, p_probe_cap: 10000, p_bare: false });
    expect(String(db.checks[0].args.p_bucket)).toMatch(/^ip:[0-9a-f]{16}$/);
    expect(db.checks[0].signal, "the counter is cancelled at the deadline, not abandoned").toBeInstanceOf(AbortSignal);
    await post({});
    expect(db.checks).toHaveLength(2);
    expect(db.checks[1].args.p_bare, "no Origin and no Referer").toBe(true);
    expect([...BUDGETED_ACTIONS].sort()).toEqual(["application-questions", "company-suggest", "detail", "exists", "facets", "list", "semantic-search", "verify"]);
  });

  it("the service key makes no counter call, as a bearer or as an apikey", async () => {
    await post({ action: "facets" }, { authorization: `Bearer ${SVC}`, apikey: SVC });
    await post({ action: "detail", id: "greenhouse:acme:1" }, { apikey: SVC });
    await post({ action: "list", limit: 1 }, { authorization: `Bearer ${SVC}` });
    expect(db.checks).toEqual([]);
  });

  it("our servers' reader proof makes no counter call; a wrong one is counted as unproven", async () => {
    await post({ action: "facets" }, { ...(await boardReaderHeader(SVC)), "x-rsp-caller": "mcp" });
    expect(db.checks).toEqual([]);
    await post({ action: "facets" }, { "x-rb-reader": "f".repeat(32), "x-rsp-caller": "mcp" });
    expect(db.checks).toHaveLength(1);
    expect(db.checks[0].args.p_kind).toBe("unproven_mcp");
    expect(String(db.checks[0].args.p_bucket)).toMatch(/^ip:/);
  });

  it("an empty service key never matches an empty bearer", async () => {
    env.SUPABASE_SERVICE_ROLE_KEY = "";
    await post({ action: "facets" }, { authorization: "Bearer ", apikey: "" });
    expect(db.checks).toHaveLength(1);
  });

  it("x-rb-budget: build and probe are their kind in the SAME bucket as the address's undeclared reads", async () => {
    await post({ action: "facets" });
    await post({ action: "facets" }, { "x-rb-budget": "build" });
    await post({ action: "facets" }, { "x-rb-budget": "probe" });
    expect(db.checks.map((c) => c.args.p_kind)).toEqual(["address", "build", "probe"]);
    expect(new Set(db.checks.map((c) => c.args.p_bucket)).size, "one address, one day row: the kind only picks the cap").toBe(1);
    expect(String(db.checks[1].args.p_bucket)).toMatch(/^ip:[0-9a-f]{16}$/);
  });

  it("status, refresh, click, report and budget-echo never call the counter", async () => {
    for (const body of [{ action: "status" }, { action: "refresh", resetCatalogHighwater: true }, { action: "click" }, { action: "report" }]) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body)).toBeLessThan(500);
    }
    const echo = await post({ action: "budget-echo" }, { "x-rb-budget": "probe", "cf-ipcountry": "us" });
    expect(await echo.json()).toEqual({ address: "203.0.113.9", addressKey: "203.0.113.9", source: "cf", country: "US", kind: "probe", exempt: false });
    expect(db.checks).toEqual([]);
  });

  it("a refusal is a 429 with the error body, and nothing else touched the database", async () => {
    db.verdict = async () => ({ data: [{ is_allowed: false, used_today: 10000, over_today: 1, cap_today: 10000, country_rule: false, enforcing: true }], error: null });
    const res = await post({ action: "list", q: "nurse", limit: 20 });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toMatch(/^\d+$/);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const body = await res.json();
    expect(body).toMatchObject({ error: "board_budget", code: "address", limit: 10000, used: 10000 });
    expect(body.message).toMatch(/resumeboostersupp@gmail\.com/);
    expect(Date.parse(body.resetAt)).toBeGreaterThan(Date.now());
    expect(db.tablesRead, "the gate runs before dispatch: no read").toEqual([]);
    expect(db.otherRpcs, "and no search").toEqual([]);
    expect(db.writes, "and no search log").toEqual([]);
    db.verdict = async () => ({ data: [{ is_allowed: false, used_today: 0, over_today: 1, cap_today: 0, country_rule: true, enforcing: true }], error: null });
    expect((await (await post({ action: "detail", id: "greenhouse:acme:1" })).json()).code).toBe("country");
  });

  it("fails open: an error, an unapplied migration, a rejection, an unreadable row, or a hang past the deadline", async () => {
    for (const v of [
      async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function" } }),
      async () => ({ data: null, error: { code: "57014", message: "canceling statement" } }),
      async () => { throw new Error("socket hang up"); },
      async () => ({ data: [{ nonsense: true }], error: null }),
      async () => ({ data: null, error: null }),
    ] as Array<() => Promise<DbResult>>) {
      db.verdict = v;
      expect((await post({ action: "facets" })).status).toBe(200);
    }
    db.verdict = (signal) => new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new Error("AbortError"))));
    const t0 = Date.now();
    expect((await post({ action: "facets" })).status).toBe(200);
    expect(Date.now() - t0, "served once the deadline cancels the counter").toBeGreaterThanOrEqual(ANON_BUDGET_DEADLINE_MS - 50);
    expect(fetched, "nothing in these requests reached for the network").toEqual([]);
  });
});

// ── the codebase ────────────────────────────────────────────────────────────

describe("the meter shares nothing with the request budget, and a browser cannot send its headers", () => {
  const INDEX = codeOf(read("supabase/functions/job-board/index.ts"));
  const gateAt = INDEX.indexOf("if (BUDGETED_ACTIONS.has(action))");
  const GATE = INDEX.slice(gateAt, INDEX.indexOf("if (action ===", gateAt));
  const MODULE = codeOf(read("supabase/functions/job-board/anon-budget.ts"));
  const MIGRATION = sqlCodeOf(read("supabase/migrations/20261002140000_a_browser_address_gets_a_browsers_day_and_the_count_is_readable.sql"));

  it("the gate sits after the body parse and before the first action is dispatched", () => {
    expect(gateAt, "the gate is not in job-board").toBeGreaterThan(0);
    expect(GATE).toMatch(/anonBudgetGate\(req, action,/);
    expect(GATE).toMatch(/client\.rpc\("job_board_anon_check", args\)\.abortSignal\(signal\)/);
    expect(INDEX.indexOf('const action = String(body.action ?? "list");')).toBeLessThan(gateAt);
    expect(gateAt).toBeLessThan(INDEX.indexOf('if (action === "searchQuality")'));
  });

  it("neither the gate, the module nor the migration touches the shared request budget", () => {
    for (const [name, src] of [["gate", GATE], ["anon-budget.ts", MODULE], ["migration", MIGRATION]] as const) {
      expect(src.length, `${name} not read`).toBeGreaterThan(200);
      expect(src, name).not.toMatch(/check_rate_limit|check_global_rate_limit|\brate_limits\b/);
    }
  });

  it("job-board's CORS allow-list names neither new header, so a page cannot send them", () => {
    const allow = /"Access-Control-Allow-Headers":\s*"([^"]*)"/.exec(INDEX)?.[1] ?? "";
    expect(allow).toBe("authorization, x-client-info, apikey, content-type");
    expect(allow).not.toMatch(/x-rb-budget|x-rb-reader/);
  });
});
