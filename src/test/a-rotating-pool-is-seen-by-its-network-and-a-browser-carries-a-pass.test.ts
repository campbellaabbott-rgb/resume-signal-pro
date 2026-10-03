// @vitest-environment node
//
// Node, not jsdom: the handler half bundles job-board with esbuild, which
// refuses jsdom's TextEncoder (see helpers/edge-harness.ts).
/**
 * A ROTATING POOL IS SEEN BY ITS NETWORK, AND A BROWSER CAN CARRY A PASS.
 *
 * WHAT WAS WRONG (2026-10-03). The /jobs harvest runs at ~3,500-4,000 counted
 * board reads an hour from ~180-340 DIFFERENT addresses an hour, none over 80
 * calls: invisible to the .85 per-address cap. .86 reads mainland China from
 * the address and in its first twenty minutes nothing read CN, so the country
 * switch misses it too. job-board .87 (with migration 20261003180000) gives
 * the owner two more levers, both inert until a config key is set:
 *   - THE NETWORK. Every counted call carries its /24 (IPv4) or /48 (IPv6), so
 *     the telemetry can show where the pool lives and blockedNetworks can
 *     refuse it in one statement.
 *   - THE PASS. A browser solves a Cloudflare Turnstile check once a half hour
 *     and carries the pass job-board signs for it (x-rb-pass). requirePass
 *     refuses browsers without one. Without TURNSTILE_SECRET_KEY every state
 *     is 'unconfigured' and nothing can be refused for lack of a pass.
 *
 * WHAT THIS HOLDS:
 *   PURE MODULES. networkOf over the normalised address key; the pass signed
 *     under a key DERIVED from the service key (an HMAC under the raw key is
 *     refused), and refused when expired, dated past anything we sign,
 *     tampered in any part, signed under another key, malformed or missing;
 *     a pass comes with ttlSeconds, so the page can keep it by its own clock;
 *     classifyCaller's passState, 'unconfigured' for everyone without the
 *     secret, and the pass id (the first 16 hex of the nonce) only for a
 *     valid pass -- the id the counter meters, so one solve cannot read for a
 *     whole pool.
 *   THE board-pass ACTION, fetch faked: success only with success===true AND
 *     an allowed hostname; Cloudflare's codes on failure; 503 unconfigured
 *     without calling Cloudflare; a siteverify that does not answer inside its
 *     deadline is a 503, never a hang.
 *   THE HANDLER, bundled: board-pass answers with no-store and no database
 *     call, sends Cloudflare the caller's derived address; a counted read
 *     carries p_pass valid/invalid/none/unconfigured as the request earns it,
 *     p_pass_id only beside a valid pass, and p_net for IPv6 callers.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { addressKey, classifyCaller, networkOf, type CountedCaller } from "../../supabase/functions/job-board/anon-budget";
import {
  BOARD_PASS_HEADER, BOARD_PASS_HOSTS, BOARD_PASS_TTL_S, boardPassAction, passStateOf, readBoardPass, signBoardPass, SITEVERIFY_URL, verifyBoardPass,
} from "../../supabase/functions/job-board/board-pass";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const H = (o: Record<string, string>) => new Headers(o);
const SVC = "svc_pass_key";
const SECRET = "0x4AAAAAAAturnstile-secret";

describe("the network is the /24 or the /48 of the normalised address", () => {
  it("IPv4 a.b.c.d is a.b.c.0/24; an IPv6 /64 key is its /48", () => {
    expect(networkOf("203.0.113.9")).toBe("203.0.113.0/24");
    expect(networkOf(addressKey("43.130.5.77"))).toBe("43.130.5.0/24");
    expect(networkOf(addressKey("2001:db8:1:2:aaaa::1"))).toBe("2001:db8:1::/48");
    expect(networkOf(addressKey("[2606:4700::1]:443")), "a zero group stays a group").toBe("2606:4700:0::/48");
    expect(networkOf(addressKey("::ffff:1.2.3.4")), "an IPv4-mapped address is its IPv4 network").toBe("1.2.3.0/24");
  });

  it("no public address, no network", () => {
    for (const k of [null, "", "unknown", "10.0.0.0/8", "1.2.3", "2001:db8::/64", "nonsense"]) expect(networkOf(k), String(k)).toBeNull();
    for (const a of ["10.1.2.3", "192.168.0.1", "fe80::1", "::1"]) expect(networkOf(addressKey(a)), a).toBeNull();
  });

  it("classifyCaller carries the network beside the address, and the bucket stays the address's", async () => {
    const c = await classifyCaller(H({ "cf-connecting-ip": "43.130.5.77" }), SVC) as CountedCaller;
    expect(c).toMatchObject({ exempt: false, kind: "address", key: "43.130.5.77", net: "43.130.5.0/24" });
    expect((await classifyCaller(H({ "x-forwarded-for": "6.6.6.6, 10.0.0.7" }), SVC) as CountedCaller).net).toBeNull();
  });
});

describe("the pass: signed under a derived key, half an hour, refused in every other shape", () => {
  const NOW = Date.UTC(2026, 9, 3, 18, 0, 0);

  it("a pass we signed verifies, and says when it expires, in our time and as a lifetime", async () => {
    const { pass, expiresAt, ttlSeconds } = await signBoardPass(SVC, NOW);
    expect(pass).toMatch(/^v1\.\d{10}\.[0-9a-f]{32}\.[0-9a-f]{64}$/);
    expect(Date.parse(expiresAt) - NOW).toBe(BOARD_PASS_TTL_S * 1000);
    expect(ttlSeconds, "a visitor's clock can be anywhere: the page keeps the pass by this").toBe(BOARD_PASS_TTL_S);
    expect((await signBoardPass(SVC, NOW + 999)).ttlSeconds, "never longer than the pass really lives").toBe(BOARD_PASS_TTL_S - 1);
    expect(BOARD_PASS_TTL_S).toBe(1800);
    expect(await verifyBoardPass(pass, SVC, NOW)).toBe(true);
    expect(await verifyBoardPass(pass, SVC, NOW + 29 * 60_000)).toBe(true);
    const other = await signBoardPass(SVC, NOW);
    expect(other.pass, "a fresh nonce every time").not.toBe(pass);
  });

  it("the HMAC key is SHA-256(service key + ':board-pass'), never the raw service key", async () => {
    const exp = Math.floor(NOW / 1000) + 600;
    const payload = `v1.${exp}.${"ab".repeat(16)}`;
    const derived = createHash("sha256").update(`${SVC}:board-pass`).digest();
    expect(await verifyBoardPass(`${payload}.${createHmac("sha256", derived).update(payload).digest("hex")}`, SVC, NOW)).toBe(true);
    expect(await verifyBoardPass(`${payload}.${createHmac("sha256", SVC).update(payload).digest("hex")}`, SVC, NOW), "the raw key signs nothing").toBe(false);
  });

  it("expired, dated past what we sign, tampered, another key, malformed: all refused", async () => {
    const { pass } = await signBoardPass(SVC, NOW);
    const [v, exp, nonce, sig] = pass.split(".");
    expect(await verifyBoardPass(pass, SVC, NOW + BOARD_PASS_TTL_S * 1000), "expired at its own second").toBe(false);
    expect(await verifyBoardPass(pass, SVC, NOW + 31 * 60_000)).toBe(false);
    expect(await verifyBoardPass((await signBoardPass(SVC, NOW + 3600_000)).pass, SVC, NOW), "dated further ahead than we ever sign").toBe(false);
    const flip = (s: string) => (s[0] === "a" ? "b" : "a") + s.slice(1);
    expect(await verifyBoardPass([v, exp, nonce, flip(sig)].join("."), SVC, NOW), "signature").toBe(false);
    expect(await verifyBoardPass([v, String(Number(exp) + 60), nonce, sig].join("."), SVC, NOW), "expiry stretched").toBe(false);
    expect(await verifyBoardPass([v, exp, flip(nonce), sig].join("."), SVC, NOW), "nonce").toBe(false);
    expect(await verifyBoardPass(pass, "another_service_key", NOW), "another project's key").toBe(false);
    expect(await verifyBoardPass(pass, "", NOW), "no key verifies nothing").toBe(false);
    for (const bad of ["", "v1", "v2." + pass.slice(3), pass + ".x", pass.toUpperCase(), ` ${pass}`, `${pass}0`, "v1.1.2.3", "x".repeat(500)]) {
      expect(await verifyBoardPass(bad, SVC, NOW), JSON.stringify(bad.slice(0, 40))).toBe(false);
    }
  });

  it("passStateOf: unconfigured without the secret or the service key, none without the header, else valid or invalid", async () => {
    const { pass } = await signBoardPass(SVC);
    expect(await passStateOf(H({ [BOARD_PASS_HEADER]: pass }), SVC, ""), "no secret: nobody can be asked").toBe("unconfigured");
    expect(await passStateOf(H({ [BOARD_PASS_HEADER]: pass }), "", SECRET)).toBe("unconfigured");
    expect(await passStateOf(H({}), SVC, SECRET)).toBe("none");
    expect(await passStateOf(H({ [BOARD_PASS_HEADER]: "  " }), SVC, SECRET)).toBe("none");
    expect(await passStateOf(H({ [BOARD_PASS_HEADER]: pass }), SVC, SECRET)).toBe("valid");
    expect(await passStateOf(H({ [BOARD_PASS_HEADER]: pass.slice(0, -1) + "0" }), SVC, SECRET)).toBe(pass.endsWith("0") ? "valid" : "invalid");
    expect(await passStateOf(H({ [BOARD_PASS_HEADER]: "forged" }), SVC, SECRET)).toBe("invalid");
  });

  it("readBoardPass: the id the counter meters is the nonce's first 16 hex, and only for a valid pass", async () => {
    const { pass } = await signBoardPass(SVC);
    const nonce = pass.split(".")[2];
    expect(await readBoardPass(H({ [BOARD_PASS_HEADER]: pass }), SVC, SECRET)).toEqual({ state: "valid", id: nonce.slice(0, 16) });
    expect(await readBoardPass(H({ [BOARD_PASS_HEADER]: pass }), SVC, "")).toEqual({ state: "unconfigured", id: null });
    expect(await readBoardPass(H({}), SVC, SECRET)).toEqual({ state: "none", id: null });
    const forged = `v1.${pass.split(".")[1]}.${nonce}.${"0".repeat(64)}`;
    expect(await readBoardPass(H({ [BOARD_PASS_HEADER]: forged }), SVC, SECRET), "a forged pass names no id to meter").toEqual({ state: "invalid", id: null });
    const other = await signBoardPass(SVC);
    expect((await readBoardPass(H({ [BOARD_PASS_HEADER]: other.pass }), SVC, SECRET)).id, "each solve its own meter").not.toBe(nonce.slice(0, 16));
  });

  it("classifyCaller gives every counted caller a passState; 'unconfigured' for everyone without the secret", async () => {
    const { pass } = await signBoardPass(SVC);
    const at = async (h: Record<string, string>, secret: string) =>
      (await classifyCaller(H({ "cf-connecting-ip": "203.0.113.9", ...h }), SVC, secret) as CountedCaller).passState;
    expect(await at({ [BOARD_PASS_HEADER]: pass }, "")).toBe("unconfigured");
    expect(await at({}, "")).toBe("unconfigured");
    expect(await at({ [BOARD_PASS_HEADER]: pass }, SECRET)).toBe("valid");
    expect(await at({ [BOARD_PASS_HEADER]: "v1.x" }, SECRET)).toBe("invalid");
    expect(await at({}, SECRET)).toBe("none");
    expect(await at({ "x-rb-budget": "build" }, SECRET), "a build declaration still reports its state; the counter decides who is asked").toBe("none");
    const c = await classifyCaller(H({ "cf-connecting-ip": "203.0.113.9", [BOARD_PASS_HEADER]: pass }), SVC, SECRET) as CountedCaller;
    expect(c.passId).toBe(pass.split(".")[2].slice(0, 16));
    expect((await classifyCaller(H({ "cf-connecting-ip": "203.0.113.9", [BOARD_PASS_HEADER]: pass }), SVC, "") as CountedCaller).passId).toBeNull();
    expect(await classifyCaller(H({ authorization: `Bearer ${SVC}` }), SVC, SECRET), "the service key is exempt before any pass is read").toEqual({ exempt: true, kind: "service" });
  });
});

type Call = { url: string; init: RequestInit };
const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("the board-pass action, with Cloudflare faked", () => {
  let calls: Call[];
  let reply: (c: Call) => Promise<Response>;
  const fake = (async (u: unknown, init?: RequestInit) => {
    const c = { url: String(u), init: init ?? {} };
    calls.push(c);
    return reply(c);
  }) as typeof fetch;
  const act = (body: Record<string, unknown>, o: Partial<{ secret: string; serviceKey: string; remoteip: string; timeoutMs: number }> = {}) =>
    boardPassAction(body, { secret: SECRET, serviceKey: SVC, remoteip: "203.0.113.9", fetch: fake, ...o });
  beforeEach(() => { calls = []; reply = async () => answer({ success: true, hostname: "resumebooster.work", "error-codes": [] }); });

  it("a solved token on our host is exchanged for a pass that verifies, after one form POST to siteverify", async () => {
    const r = await act({ token: "tok-123" });
    expect(r.status).toBe(200);
    expect(await verifyBoardPass(String(r.body.pass), SVC)).toBe(true);
    expect(Date.parse(String(r.body.expiresAt)) - Date.now()).toBeGreaterThan(29 * 60_000);
    expect(r.body.ttlSeconds).toBeGreaterThanOrEqual(BOARD_PASS_TTL_S - 1);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(SITEVERIFY_URL);
    expect(calls[0].init.method).toBe("POST");
    const form = new URLSearchParams(String(calls[0].init.body));
    expect(Object.fromEntries(form)).toEqual({ secret: SECRET, response: "tok-123", remoteip: "203.0.113.9" });
    expect(calls[0].init.signal, "bounded by a deadline").toBeInstanceOf(AbortSignal);
  });

  it("every allowed host passes; any other host fails even when Cloudflare says success", async () => {
    expect([...BOARD_PASS_HOSTS].sort()).toEqual(["resumebooster.lovable.app", "resumebooster.work", "www.resumebooster.work"]);
    for (const host of BOARD_PASS_HOSTS) {
      reply = async () => answer({ success: true, hostname: host.toUpperCase() });
      expect((await act({ token: "t" })).status, host).toBe(200);
    }
    for (const host of ["evil.example", "resumebooster.work.evil.example", "", undefined]) {
      reply = async () => answer({ success: true, hostname: host, "error-codes": [] });
      const r = await act({ token: "t" });
      expect(r, String(host)).toEqual({ status: 403, body: { error: "board_pass_failed", codes: ["hostname-not-allowed"] } });
    }
  });

  it("a failed token is a 403 carrying Cloudflare's codes; only success === true passes", async () => {
    reply = async () => answer({ success: false, "error-codes": ["invalid-input-response", 7, "timeout-or-duplicate"] });
    expect(await act({ token: "t" })).toEqual({ status: 403, body: { error: "board_pass_failed", codes: ["invalid-input-response", "timeout-or-duplicate"] } });
    reply = async () => answer({ success: "true", hostname: "resumebooster.work" });
    expect((await act({ token: "t" })).status, "a truthy string is not success").toBe(403);
    expect(await act({ token: "" }), "no token: Cloudflare is not asked").toEqual({ status: 403, body: { error: "board_pass_failed", codes: ["missing-input-response"] } });
    expect((await act({ token: 42 })).status).toBe(403);
    expect((await act({ token: "x".repeat(5000) })).status).toBe(403);
    expect(calls).toHaveLength(2);
  });

  it("unconfigured: no secret (or no service key) is a 503 and Cloudflare is never called", async () => {
    expect(await act({ token: "t" }, { secret: "" })).toEqual({ status: 503, body: { error: "board_pass_unconfigured" } });
    expect(await act({ token: "t" }, { serviceKey: "" })).toEqual({ status: 503, body: { error: "board_pass_unconfigured" } });
    expect(calls).toEqual([]);
  });

  it("a siteverify that does not answer inside its deadline, throws, or answers garbage is a 503, never a hang or a pass", async () => {
    reply = (c) => new Promise((_, reject) => c.init.signal?.addEventListener("abort", () => reject(new Error("AbortError"))));
    const t0 = Date.now();
    expect(await act({ token: "t" }, { timeoutMs: 60 })).toEqual({ status: 503, body: { error: "board_pass_failed", codes: ["siteverify-unavailable"] } });
    expect(Date.now() - t0).toBeLessThan(2000);
    reply = async () => { throw new Error("ECONNRESET"); };
    expect((await act({ token: "t" })).status).toBe(503);
    reply = async () => new Response("<html>bad gateway</html>", { status: 502 });
    expect((await act({ token: "t" })).status).toBe(503);
  });
});

// ── the handler ─────────────────────────────────────────────────────────────

type Check = { args: Record<string, unknown> };
class MeterDb extends FakeDb {
  checks: Check[] = [];
  tablesRead: string[] = [];
  from(table: string) { this.tablesRead.push(table); return super.from(table); }
  // deno-lint-ignore no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc(name: string, args: Record<string, unknown> = {}): any {
    if (name !== "job_board_anon_check") return super.rpc(name, args);
    this.checks.push({ args });
    const result = Promise.resolve({ data: [{ is_allowed: true, used_today: 1, over_today: 0, cap_today: 10000, country_rule: false, enforcing: true, network_rule: false, pass_rule: false }], error: null });
    return { abortSignal: () => result, then: (a: never, b: never) => result.then(a, b) };
  }
}

describe("the handler: board-pass, and the pass state every counted read carries", () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://h.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SVC, TURNSTILE_SECRET_KEY: SECRET };
  let db: MeterDb;
  let handler: EdgeHandler;
  const realFetch = globalThis.fetch;
  let sent: Call[] = [];
  beforeAll(async () => {
    g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
    g.EdgeRuntime = { waitUntil: () => undefined };
    globalThis.fetch = (async (u: unknown, init?: RequestInit) => {
      sent.push({ url: String(u), init: init ?? {} });
      if (String(u) === SITEVERIFY_URL) return answer({ success: true, hostname: "www.resumebooster.work", "error-codes": [] });
      return new Response("no network in tests", { status: 503 });
    }) as typeof fetch;
    handler = await loadEdgeHandler("job-board", {
      "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return globalThis.__jbDb; }",
    });
  });
  afterAll(() => { globalThis.fetch = realFetch; });
  beforeEach(() => { db = new MeterDb(); g.__jbDb = db; sent = []; env.TURNSTILE_SECRET_KEY = SECRET; });

  const post = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
    handler(new Request("https://h.supabase.co/functions/v1/job-board", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9", origin: "https://resumebooster.work", ...headers },
      body: JSON.stringify(body),
    }));

  it("board-pass hands out a pass with no-store, CORS and no database call, and tells Cloudflare the caller's address", async () => {
    const res = await post({ action: "board-pass", token: "tok" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const body = await res.json();
    expect(await verifyBoardPass(body.pass, SVC)).toBe(true);
    expect(db.checks, "not counted").toEqual([]);
    expect(db.tablesRead, "no database").toEqual([]);
    const sv = sent.filter((c) => c.url === SITEVERIFY_URL);
    expect(sv).toHaveLength(1);
    expect(new URLSearchParams(String(sv[0].init.body)).get("remoteip")).toBe("203.0.113.9");
  });

  it("without the secret board-pass is a 503 and nothing calls Cloudflare", async () => {
    env.TURNSTILE_SECRET_KEY = "";
    const res = await post({ action: "board-pass", token: "tok" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "board_pass_unconfigured" });
    expect(sent).toEqual([]);
  });

  it("a counted read carries p_pass as the request earns it, and p_net beside its address", async () => {
    const { pass } = await signBoardPass(SVC);
    await post({ action: "facets" }, { [BOARD_PASS_HEADER]: pass });
    await post({ action: "facets" }, { [BOARD_PASS_HEADER]: pass.replace(/.$/, (c) => (c === "0" ? "1" : "0")) });
    await post({ action: "facets" });
    await post({ action: "facets" }, { "cf-connecting-ip": "2001:db8:1:2::77" });
    env.TURNSTILE_SECRET_KEY = "";
    await post({ action: "facets" }, { [BOARD_PASS_HEADER]: pass });
    expect(db.checks.map((c) => c.args.p_pass)).toEqual(["valid", "invalid", "none", "none", "unconfigured"]);
    expect(db.checks.map((c) => c.args.p_pass_id), "the meter's id rides only beside a valid pass").toEqual([pass.split(".")[2].slice(0, 16), null, null, null, null]);
    expect(db.checks.map((c) => c.args.p_net)).toEqual(["203.0.113.0/24", "203.0.113.0/24", "203.0.113.0/24", "2001:db8:1::/48", "203.0.113.0/24"]);
  });

  it("budget-echo reports the network and the pass state, uncounted", async () => {
    const { pass } = await signBoardPass(SVC);
    const echo = await (await post({ action: "budget-echo" }, { [BOARD_PASS_HEADER]: pass })).json();
    expect(echo).toMatchObject({ net: "203.0.113.0/24", passState: "valid", kind: "address" });
    expect(db.checks).toEqual([]);
  });
});
