// @vitest-environment node
/**
 * A SHORTLIST REFUSAL SAYS WHAT HAPPENED AND WHEN TO TRY AGAIN (S14X-197,
 * the function's half; the page's half is
 * every-shortlist-refusal-read-evaluation-failed.test.tsx).
 *
 * WHAT WAS WRONG. Every refusal was a bare sentence with no code: a scorer
 * outage and a missing scoring key were both 503s the page could not tell
 * apart, no answer said when to try again (and the browser could not read
 * Retry-After, which was never exposed), and the account-cap answer told the
 * employer to "Delete roles you no longer need", which no page lets them do.
 *
 * WHAT HOLDS NOW, running the shipped handler with the network faked: each
 * refusal carries a code; a scorer outage is scoring_unavailable with the
 * gateway's status, a Retry-After the browser may read, and the seconds in
 * the body; a missing key is scoring_not_configured; the cap answer offers no
 * deletion; and nothing is stored on any of them.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { buildIsAtLeast } from "./helpers/fn-build";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 180_000 });

const CLIENT = `export function createClient() {
  const db = globalThis.__slDb;
  return {
    rpc: (n, a) => db.rpc(n, a),
    from: (t) => {
      const q = db.from(t);
      const select = q.select.bind(q);
      q.select = (cols, opts) => {
        if (!opts || !opts.head) return select(cols);
        const counted = { eq: () => counted, then: (ok, no) => Promise.resolve({ data: null, error: null, count: globalThis.__slHeld }).then(ok, no) };
        return counted;
      };
      return q;
    },
    auth: { getUser: async () => ({ data: { user: { id: "user-1", email: "hr@employer.test" } }, error: null }) },
  };
}`;

const JD = "Senior data engineer: Airflow, dbt and Snowflake, five years, on-call for the warehouse.";
const RESUME = "Built Airflow pipelines and dbt models on Snowflake for six years; led the warehouse on-call rota. ".repeat(3);
const WEBSITE = ["e30", Buffer.from(JSON.stringify({ sub: "user-1", role: "authenticated", aud: "authenticated" })).toString("base64url"), "sig"].join(".");

let db: FakeDb;
let handler: EdgeHandler;
let gateway: () => Response;
const env: Record<string, string> = {};

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.fetch = async (url: string) => String(url).includes("ai.gateway.lovable.dev") ? gateway() : new Response("{}", { status: 200 });
  handler = await loadEdgeHandler("shortlist-evaluate", { "https://esm.sh/@supabase/supabase-js@2": CLIENT });
}, 180_000);

beforeEach(() => {
  Object.assign(env, {
    SUPABASE_URL: "https://harness.supabase.co", SUPABASE_ANON_KEY: "anon_harness",
    SUPABASE_SERVICE_ROLE_KEY: "service_harness", LOVABLE_API_KEY: "lovable_harness",
  });
  db = new FakeDb();
  db.rows("shortlist_roles").push({ id: "role-1", jd_text: JD, jd_version: 2 });
  db.rpcs.check_rate_limit = () => ({ data: true, error: null });
  const g = globalThis as Record<string, unknown>;
  g.__slDb = db;
  g.__slHeld = 0;
  gateway = () => new Response("upstream down", { status: 502 });
});
afterEach(() => { delete env.LOVABLE_API_KEY; });

const evaluate = async () => {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/shortlist-evaluate", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${WEBSITE}`, "cf-connecting-ip": "198.51.100.4" },
    body: JSON.stringify({ roleId: "role-1", resumeText: RESUME, attested: true }),
  }));
  return { status: res.status, headers: res.headers, body: await res.json() as Record<string, unknown> };
};

describe("each refusal names itself", () => {
  it("a scorer outage is scoring_unavailable, with a Retry-After the browser may read", async () => {
    const r = await evaluate();
    expect(buildIsAtLeast(r.headers.get("x-fn-build"), "shortlist-evaluate", "2026-11-09", 2), String(r.headers.get("x-fn-build"))).toBe(true);
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ code: "scoring_unavailable", gatewayStatus: 502, retryAfterSeconds: 120 });
    expect(r.headers.get("retry-after")).toBe("120");
    expect(String(r.headers.get("access-control-expose-headers")).toLowerCase()).toContain("retry-after");
    expect(db.rows("shortlist_candidates")).toEqual([]);
  });

  it("the gateway's own Retry-After is passed on", async () => {
    gateway = () => new Response("slow down", { status: 429, headers: { "retry-after": "30" } });
    const r = await evaluate();
    expect(r.body).toMatchObject({ code: "scoring_unavailable", gatewayStatus: 429, retryAfterSeconds: 30 });
    expect(r.headers.get("retry-after")).toBe("30");
  });

  it("a missing scoring key is scoring_not_configured, not an outage", async () => {
    delete env.LOVABLE_API_KEY;
    const r = await evaluate();
    expect(r.status).toBe(503);
    expect(r.body.code).toBe("scoring_not_configured");
  });

  it("an unreadable answer is scoring_failed", async () => {
    gateway = () => new Response(JSON.stringify({ choices: [] }), { status: 200 });
    const r = await evaluate();
    expect(r.status).toBe(502);
    expect(r.body.code).toBe("scoring_failed");
  });

  it("the account cap offers no deletion the product does not have", async () => {
    (globalThis as Record<string, unknown>).__slHeld = 10_000;
    const r = await evaluate();
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("candidate_cap");
    expect(String(r.body.error)).not.toMatch(/delete/i);
  });
});
