// @vitest-environment node
/**
 * THE FIT SCORER THE SITE CALLS LET EACH CALLER NAME ITS OWN BUCKET.
 *
 * Sweep S8-062 (2026-10-08). job-fit (called by /jobs and LiveMatches) and
 * application-fit keyed their rate limit on the FIRST x-forwarded-for hop,
 * which the caller writes: each forged hop drew a fresh bucket, and a hop past
 * 45 characters made check_rate_limit raise, which both read as allowed. The
 * .88 fix (addressAllowance) covered job-board's own copy only. Each call
 * reads up to twenty descriptions and scans up to 50k characters.
 *
 * Now both key a reader on the address the platform states (cf-connecting-ip,
 * else the last hop; IPv6 by /64), over an hour, and answer a limiter that
 * cannot answer with 503 instead of scoring. The shipped handlers run here
 * with only the database faked (helpers/edge-harness.ts).
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { buildIsAtLeast } from "./helpers/fn-build";
import { FIT_PER_ADDRESS_HOUR } from "../../supabase/functions/job-board/abuse-guards";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const SVC = "svc-key-for-tests";
type RpcCall = { name: string; args: Record<string, unknown> };
const state: { calls: RpcCall[]; answer: () => { data: unknown; error: unknown }; reads: number } = {
  calls: [], answer: () => ({ data: true, error: null }), reads: 0,
};
const fakeClient = {
  rpc: async (name: string, args: Record<string, unknown>) => { state.calls.push({ name, args }); return state.answer(); },
  from: () => {
    state.reads++;
    const q = { select: () => q, in: async () => ({ data: [{ id: "j1", description: "x".repeat(400), min_years: null }], error: null }) };
    return q;
  },
};
const stub = "export function createClient() { return globalThis.__fitDb; }";

let jobFit: EdgeHandler;
let appFit: EdgeHandler;
beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://h.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SVC };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.__fitDb = fakeClient;
  jobFit = await loadEdgeHandler("job-fit", { "https://esm.sh/@supabase/supabase-js@2.45.0": stub });
  appFit = await loadEdgeHandler("application-fit", { "https://esm.sh/@supabase/supabase-js@2": stub });
});

const RESUME = "Registered nurse with eight years in acute care, ICU and emergency triage. ".repeat(3);
const fitBatch = (headers: Record<string, string>) => jobFit(new Request("https://h.supabase.co/functions/v1/job-fit", {
  method: "POST", headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify({ action: "fit-batch", resumeText: RESUME, ids: ["j1"] }),
}));
const appCheck = (headers: Record<string, string>) => appFit(new Request("https://h.supabase.co/functions/v1/application-fit", {
  method: "POST", headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify({ jobPosting: "We need an ICU nurse with triage experience. ".repeat(4), resumeText: RESUME }),
}));
const reset = (answer = () => ({ data: true as unknown, error: null as unknown })) => { state.calls = []; state.reads = 0; state.answer = answer; };
const limits = () => state.calls.filter((c) => c.name === "check_rate_limit").map((c) => c.args);

describe("job-fit keys a reader on the platform's address (S8-062)", () => {
  it("two forged first hops behind one address spend one bucket, over an hour, at job-board's allowance", async () => {
    reset();
    await fitBatch({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "1.1.1.1, 203.0.113.9" });
    await fitBatch({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "2.2.2.2, 203.0.113.9" });
    expect(limits().map((a) => a.p_ip), "each forged hop was its own bucket").toEqual(["203.0.113.9", "203.0.113.9"]);
    expect(limits()[0]).toMatchObject({ p_function: "job-board-fit", p_max_requests: FIT_PER_ADDRESS_HOUR, p_window_minutes: 60 });
  });

  it("a forged hop longer than the limiter accepts is not the key; the hop the proxy appended is", async () => {
    reset();
    await fitBatch({ "x-forwarded-for": `${"a".repeat(60)}, 198.51.100.7` });
    expect(limits()[0].p_ip).toBe("198.51.100.7");
    reset();
    await fitBatch({ "cf-connecting-ip": "2001:db8:1:2:3:4:5:6" });
    expect(limits()[0].p_ip, "an IPv6 reader is its /64").toBe("2001:db8:1:2::/64");
  });

  it("a limiter that cannot answer refuses, and nothing is scored", async () => {
    reset(() => ({ data: null, error: { message: "p_ip too long" } }));
    const res = await fitBatch({ "cf-connecting-ip": "203.0.113.9" });
    expect(res.status, "an error was read as allowed").toBe(503);
    expect(state.reads).toBe(0);
  });

  it("a spent bucket is a 429 that says it is hourly; a keyed server caller keeps its own daily row", async () => {
    reset(() => ({ data: false, error: null }));
    const res = await fitBatch({ "cf-connecting-ip": "203.0.113.9" });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: "rate_limited", window: "1h", limit: FIT_PER_ADDRESS_HOUR, rateLimited: true });
    reset();
    await fitBatch({ authorization: `Bearer ${SVC}`, "x-rb-bucket": "key:abc-123", "cf-connecting-ip": "203.0.113.9" });
    expect(limits()[0]).toMatchObject({ p_ip: "key:abc-123", p_max_requests: 1000, p_window_minutes: 1440 });
  });

  it("says which build answered", async () => {
    reset();
    const res = await fitBatch({ "cf-connecting-ip": "203.0.113.9" });
    expect(buildIsAtLeast(res.headers.get("x-fn-build"), "job-fit", "2026-10-09")).toBe(true);
  });
});

describe("application-fit keys a caller the same way (S8-062)", () => {
  it("one address behind two forged hops is one bucket, over an hour", async () => {
    reset();
    await appCheck({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "1.1.1.1, 203.0.113.9" });
    await appCheck({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "2.2.2.2, 203.0.113.9" });
    expect(limits().map((a) => a.p_ip)).toEqual(["203.0.113.9", "203.0.113.9"]);
    expect(limits()[0]).toMatchObject({ p_function: "application-fit", p_window_minutes: 60 });
  });

  it("a limiter error refuses instead of scoring", async () => {
    reset(() => ({ data: null, error: { message: "boom" } }));
    const res = await appCheck({ "cf-connecting-ip": "203.0.113.9" });
    expect(res.status).toBe(503);
    expect(buildIsAtLeast(res.headers.get("x-fn-build"), "application-fit", "2026-10-09")).toBe(true);
  });
});
