// @vitest-environment node
/**
 * The MCP connector (agent-mcp), run as shipped with only its network faked.
 *
 *  - S11-039. A $29 pass sold as "apply to 10 jobs for you" spent an
 *    application on every request, and about 96% of postings are on systems
 *    the agent can only prepare for. OWNER DECISION 2026-10-11: a pass is
 *    spent only on a job the agent can submit itself; any other is refused
 *    and nothing is spent. On the Agent plan nothing is counted, so such a
 *    job is still prepared for the person to send.
 *  - S11-041. key_status and request_application counted a résumé as on
 *    file from its text alone; a send needs the file. A text-only account
 *    was told it was ready and spent a pass on packets that block.
 *  - S11-121. Agent-plan keys are minted 'free', and fit_resume refused them
 *    with a pass upsell, while /agents sells the scorer with the plan.
 *
 * THE APPLY PIVOT (owner decision 2026-10-11) supersedes S11-039 and S11-041
 * on this surface: the Agent plan, the Agent Pass and the apply agent are
 * retired, nothing is sent for anyone, and apply_myself is the only apply
 * path. The pass and résumé-file gates live on, dormant, inside the
 * enqueue seam; through the connector every apply-agent tool now answers its
 * retirement, writes nothing and spends nothing. Fit scoring is free at 25 a
 * day on any key, and the plan, a pass, a paid tier or Pro open the full
 * 1,000 (S11-121's property, kept: the plan still opens the scorer).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const USER = "55555555-5555-4555-8555-555555555555";
const KEY = "rb_live_harness_key_0123456789";
let handler: EdgeHandler;
let rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
let state: { subscribed: boolean; pass: boolean; resumeFile: string; pro: boolean; fitUsed: number; confirmed: boolean; proven: boolean; fitReadFails: boolean };

function chain(result: unknown): unknown {
  const p: unknown = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") return (ok: (v: unknown) => unknown, no: (e: unknown) => unknown) => Promise.resolve(result).then(ok, no);
      if (prop === "maybeSingle" || prop === "single") return () => Promise.resolve(result);
      return () => p;
    },
  });
  return p;
}

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service_harness", SUPABASE_ANON_KEY: "anon_harness" };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.fetch = async (url: string) => {
    if (String(url).endsWith("/functions/v1/job-board")) {
      return new Response(JSON.stringify({ jobs: [], total: 0, hasMore: false }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  };
  handler = await loadEdgeHandler("agent-mcp", {
    "https://esm.sh/@supabase/supabase-js@2.45.0": "export class SupabaseClient {} export function createClient() { return globalThis.__mcpDb; }",
  });
}, 120_000);

beforeEach(() => {
  rpcCalls = [];
  state = { subscribed: false, pass: true, resumeFile: `${USER}/cv.pdf`, pro: false, fitUsed: 1, confirmed: true, proven: false, fitReadFails: false };
  const later = new Date(Date.now() + 3 * 3_600_000).toISOString();
  (globalThis as Record<string, unknown>).__mcpDb = {
    rpc: (name: string, args: Record<string, unknown> = {}) => {
      rpcCalls.push({ name, args });
      const data =
        name === "api_key_check"
          ? { is_allowed: true, deny_reason: "", api_key_id: "key-1", key_tier: state.pass ? "pass" : "free", rate_limit: 60, rate_used: 1, quota_limit: 1000, quota_used: 1, pass_ends_at: state.pass ? later : null, pass_apps_left: state.pass ? 9 : null }
        : name === "agent_subscription_rows"
          ? (state.subscribed ? [{ user_id: USER, status: "active", current_period_end: later, bound: true }] : [])
        : name === "agent_queue_enqueue"
          ? { enqueued_ok: true, enqueue_reason: "queued", queued_row_id: 7, pass_apps_left: 8 }
        : name === "agent_employer_in_cooldown" ? false
        : name === "pro_entitlement_rows" ? (state.pro ? [{ status: "active", current_period_end: later, bound: true }] : [])
        : name === "mcp_anon_check" ? { allowed: true, global_used: 1, ip_used: 1, ip_cap: 25, global_cap: 2000 }
        // The free fit allowance's reader (20261011110000), shared with POST /v1/fit.
        : name === "api_key_fit_allowance" ? [{ fa_user_id: USER, fa_confirmed: state.confirmed, fa_proven: state.proven, fa_used: state.fitUsed }]
        : null;
      if (name === "api_key_fit_allowance" && state.fitReadFails) {
        const failed = Promise.resolve({ data: null, error: { message: "statement timeout" } });
        return Object.assign(failed, { maybeSingle: () => failed, single: () => failed });
      }
      const r = Promise.resolve({ data, error: null });
      return Object.assign(r, { maybeSingle: () => r, single: () => r });
    },
    from: (table: string) => chain({
      data:
        table === "api_keys" ? { user_id: USER }
        : table === "agent_mandates" ? {
          active: true, paused_until: null, apply_mode: "review", resume_text: "Registered nurse. ".repeat(20),
          resume_file_url: state.resumeFile, countries: null, category: null, max_age_days: null, salary_min: null,
          blocked_companies: [], employer_cooldown_days: 0, last_prepare_kick_at: new Date().toISOString(),
        }
        : table === "agent_passes" ? (state.pass ? { activated_at: new Date().toISOString(), expires_at: later, closed_at: null, shelf_expires_at: later, applications_total: 10, applications_used: 1 } : null)
        : table === "api_usage" ? { calls: state.fitUsed }
        : table === "job_board_postings" ? { id: "x", title: "Staff Nurse", company: "Acme Health", company_token: "acme", location: "Leeds", country: "GB", apply_url: "https://x", salary: "", salary_min_annual: null, category: "healthcare", posted_at: new Date().toISOString(), description: "Registered nurse wanted." }
        : null,
      error: null,
    }),
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  };
});

const call = async (name: string, args: Record<string, unknown>, key: string | null = KEY) => {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/agent-mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(key ? { authorization: `Bearer ${key}` } : {}), "x-forwarded-for": "203.0.113.7" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  }));
  const body = await res.json() as { result?: { structuredContent?: Record<string, unknown>; content?: Array<{ text: string }>; isError?: boolean } };
  const text = body.result?.content?.[0]?.text ?? "{}";
  let sc: Record<string, unknown> = {};
  try { sc = body.result?.structuredContent ?? JSON.parse(text); } catch { sc = { text }; }
  return { sc, raw: JSON.stringify(body), isError: body.result?.isError === true };
};
const enqueued = () => rpcCalls.filter((c) => c.name === "agent_queue_enqueue");
const rpc = async (method: string, params: Record<string, unknown> = {}, key: string | null = KEY) => {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/agent-mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(key ? { authorization: `Bearer ${key}` } : {}), "x-forwarded-for": "203.0.113.7" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }));
  return await res.json() as { result?: Record<string, unknown> };
};

describe("the apply pivot: the apply agent's tools are retired, and nothing is sent or spent", () => {
  it("request_application on a pass, on the plan, for any hiring system, answers the retirement and writes nothing", async () => {
    for (const [subscribed, pass] of [[false, true], [true, false]] as const) {
      state.subscribed = subscribed; state.pass = pass;
      for (const jobId of ["teamtailor:acme:123", "workday:acme:R123"]) {
        const r = await call("request_application", { jobId });
        expect(r.isError).toBe(true);
        expect(r.raw).toMatch(/retired/);
        expect(r.raw).toMatch(/apply_myself/);
      }
    }
    expect(enqueued()).toHaveLength(0);
    // Not even metered: a retired tool is answered before the key check.
    expect(rpcCalls.filter((c) => c.name === "api_key_check")).toHaveLength(0);
  });

  it("no caller is listed an apply-agent tool, and no listed text sells a pass or the plan", async () => {
    const r = await rpc("tools/list");
    const tools = (r.result?.tools ?? []) as Array<{ name: string; description: string }>;
    for (const n of ["request_application", "application_status", "check_apply_support"]) expect(tools.map((t) => t.name)).not.toContain(n);
    expect(JSON.stringify(tools)).not.toMatch(/\bAgent (?:Pass|plan)\b|agents\/pass/);
  });

  it("key_status reports no apply readiness and no place to buy a pass", async () => {
    state.resumeFile = "";
    const { sc } = await call("key_status", {});
    expect(sc.apply).toBeUndefined();
    expect(JSON.stringify(sc)).not.toMatch(/agents\/pass|\bupgrade\b|request_application/);
    expect((sc.features as Record<string, unknown>).request_application).toBeUndefined();
  });
});

describe("S11-121, kept: the Agent plan opens the scorer, and fit is free at 25 a day on any key", () => {
  const cv = { resumeText: "Registered nurse with ICU experience, patient care and triage. ".repeat(4) };

  it("an Agent-plan key (minted 'free') gets the full allowance, and key_status says so", async () => {
    state.subscribed = true; state.pass = false; state.fitUsed = 500;
    const r = await call("fit_resume", cv);
    expect(r.isError).toBe(false);
    expect(r.sc.fitFreeLeftToday).toBeUndefined();
    const { sc } = await call("key_status", {});
    expect(sc.features).toMatchObject({ fit_resume: true, fitDailyLimit: 1000, fitFreeLeftToday: null });
  });

  it("a Pro account's key gets the full allowance too", async () => {
    state.subscribed = false; state.pass = false; state.pro = true; state.fitUsed = 300;
    const r = await call("fit_resume", cv);
    expect(r.isError).toBe(false);
    expect(r.sc.fitFreeLeftToday).toBeUndefined();
  });

  it("a free key with neither plan, pass nor Pro scores 25 a day, says how many are left, and is refused past that", async () => {
    state.subscribed = false; state.pass = false; state.pro = false;
    state.fitUsed = 25;
    const ok = await call("fit_resume", cv);
    expect(ok.isError, ok.raw).toBe(false);
    expect(ok.sc.fitFreeLeftToday).toBe(0);
    state.fitUsed = 26;
    const refused = await call("fit_resume", cv);
    expect(refused.isError).toBe(true);
    expect(refused.raw).toMatch(/free daily allowance is used \(25 scorings a day\)/);
    expect(refused.raw).not.toMatch(/paid feature|agents\/pass|data-api/);
    const { sc } = await call("key_status", {});
    expect(sc.features).toMatchObject({ fit_resume: false, fitDailyLimit: 25, fitFreeLeftToday: 0, fitBlocker: "spent" });
    expect(rpcCalls.some((c) => c.name === "api_key_fit_allowance" && c.args.p_endpoint === "/mcp/fit_resume")).toBe(true);
  });

  // THE SAME RULE AS POST /v1/fit (the wave-4 integration): the free 25 are for
  // a key whose email was confirmed or whose account proved its mailbox. Before,
  // this door scored every live key and /v1 refused the unconfirmed ones.
  it("an unconfirmed key on an unproven account is refused and told where a confirmed key comes from; key_status says why", async () => {
    state.subscribed = false; state.pass = false; state.pro = false;
    state.confirmed = false; state.proven = false; state.fitUsed = 1;
    const refused = await call("fit_resume", cv);
    expect(refused.isError).toBe(true);
    expect(refused.raw).toMatch(/fit_resume needs a key whose email address was confirmed, or an account that has proven its mailbox/);
    expect(refused.raw).toMatch(/resumebooster\.work\/data-api/);
    expect(refused.raw).not.toMatch(/paid feature|agents\/pass|\bAgent (?:Pass|plan)\b/);
    const { sc } = await call("key_status", {});
    expect(sc.features).toMatchObject({ fit_resume: false, fitDailyLimit: 25, fitBlocker: "unconfirmed" });
  });

  it("a proven account counts as confirmed, as it does on /v1", async () => {
    state.subscribed = false; state.pass = false; state.pro = false;
    state.confirmed = false; state.proven = true; state.fitUsed = 3;
    const ok = await call("fit_resume", cv);
    expect(ok.isError, ok.raw).toBe(false);
    expect(ok.sc.fitFreeLeftToday).toBe(22);
  });

  it("a reader that fails refuses without scoring, never opens", async () => {
    state.subscribed = false; state.pass = false; state.pro = false;
    state.fitReadFails = true;
    const refused = await call("fit_resume", cv);
    expect(refused.isError).toBe(true);
    expect(refused.raw).toMatch(/allowance could not be read just now; nothing was scored/);
  });
});

describe("no place that says what opens the scorer names a plan, a pass or a price", () => {
  it("initialize's instructions", async () => {
    const r = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    const text = String(r.result?.instructions ?? "");
    expect(text).not.toMatch(/\bAgent (?:Pass|plan)\b|\$\d|paid key/);
  });

  it("the guide", async () => {
    const r = await rpc("resources/read", { uri: "resumebooster://guide" });
    const text = JSON.stringify(r.result ?? {});
    expect(text).toMatch(/25 scorings a day/);
    expect(text).not.toMatch(/\bAgent (?:Pass|plan)\b|\$\d|agents\/pass/);
  });

  it("board_stats, as a keyless caller reads it, sells nothing", async () => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/agent-mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "x-forwarded-for": "203.0.113.7" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "board_stats", arguments: {} } }),
    }));
    const text = await res.text();
    expect(text).not.toMatch(/withKey|\bAgent (?:Pass|plan)\b|paid key/);
  });

  // llms.txt since the apply pivot (owner decision 2026-10-11): the Agent Pass
  // and the Agent plan are retired, so the crawler file no longer names them
  // as what opens the scorer. It says the scorer is gated as POST /v1/fit is,
  // which stays true whichever key tiers that gate admits (src owner: the frontend).
  it("llms.txt says the same as the server", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const txt = readFileSync(resolve(__dirname, "../../public/llms.txt"), "utf8");
    expect(txt).toMatch(/résumé fit scoring is gated exactly as POST \/v1\/fit is/);
    expect(txt).not.toMatch(/\bAgent (?:Pass|plan)\b/);
    expect(txt).not.toMatch(/a paid key, a live Agent Pass or the Agent plan on the key's account opens résumé fit scoring/);
  });
});
