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
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const USER = "55555555-5555-4555-8555-555555555555";
const KEY = "rb_live_harness_key_0123456789";
let handler: EdgeHandler;
let rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
let state: { subscribed: boolean; pass: boolean; resumeFile: string };

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
  state = { subscribed: false, pass: true, resumeFile: `${USER}/cv.pdf` };
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
        : name === "mcp_anon_check" ? { allowed: true, global_used: 1, ip_used: 1, ip_cap: 25, global_cap: 2000 }
        : null;
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
        : table === "job_board_postings" ? { id: "x", title: "Staff Nurse", company: "Acme Health", company_token: "acme", location: "Leeds", country: "GB", apply_url: "https://x", salary: "", salary_min_annual: null, category: "healthcare", posted_at: new Date().toISOString(), description: "Registered nurse wanted." }
        : null,
      error: null,
    }),
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  };
});

const call = async (name: string, args: Record<string, unknown>) => {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/agent-mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${KEY}`, "x-forwarded-for": "203.0.113.7" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  }));
  const body = await res.json() as { result?: { structuredContent?: Record<string, unknown>; content?: Array<{ text: string }>; isError?: boolean } };
  const text = body.result?.content?.[0]?.text ?? "{}";
  let sc: Record<string, unknown> = {};
  try { sc = body.result?.structuredContent ?? JSON.parse(text); } catch { sc = { text }; }
  return { sc, raw: JSON.stringify(body), isError: body.result?.isError === true };
};
const enqueued = () => rpcCalls.filter((c) => c.name === "agent_queue_enqueue");

describe("S11-039: a pass is spent only on a job the agent can submit", () => {
  it("a Workday job on a pass is refused, and nothing is written or spent", async () => {
    const { sc } = await call("request_application", { jobId: "workday:acme:R123" });
    expect(sc).toMatchObject({ accepted: false, refusedBy: "vendor" });
    expect(String(sc.fix)).toMatch(/Nothing was spent/);
    expect(enqueued()).toHaveLength(0);
  });

  it("a Teamtailor job on a pass is accepted and charged to the pass", async () => {
    const { sc } = await call("request_application", { jobId: "teamtailor:acme:123" });
    expect(sc).toMatchObject({ accepted: true });
    expect(enqueued()).toHaveLength(1);
    expect(enqueued()[0]!.args).toMatchObject({ p_pass_funded: true });
  });

  it("on the Agent plan a Workday job is still prepared for the person, and nothing is counted", async () => {
    state.subscribed = true; state.pass = false;
    const { sc } = await call("request_application", { jobId: "workday:acme:R123" });
    expect(sc).toMatchObject({ accepted: true });
    expect(enqueued()[0]!.args).toMatchObject({ p_pass_funded: false });
  });

  it("the tool description states the rule", async () => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/agent-mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "x-forwarded-for": "203.0.113.7" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }));
    const tools = ((await res.json()) as { result: { tools: Array<{ name: string; description: string }> } }).result.tools;
    const d = tools.find((t) => t.name === "request_application")!.description;
    expect(d).toMatch(/On a pass, only a job the agent can submit itself \(agentReady true[^)]*\) uses an application; any other job is refused and nothing is spent\./);
  });
});

describe("S11-041: a résumé on file is the file, not only its text", () => {
  it("key_status says a text-only account is not ready, and names the fix", async () => {
    state.resumeFile = "";
    const { sc } = await call("key_status", {});
    const apply = sc.apply as { ready: boolean; resumeOnFile: boolean; blockers: string[] };
    expect(apply.ready).toBe(false);
    expect(apply.resumeOnFile).toBe(false);
    expect(apply.blockers.join(" ")).toMatch(/Upload your CV in Account → Apply profile/);
    expect((sc.features as { request_application: boolean }).request_application).toBe(false);
  });

  it("request_application refuses it before anything is spent", async () => {
    state.resumeFile = "";
    const { sc } = await call("request_application", { jobId: "teamtailor:acme:123" });
    expect(sc).toMatchObject({ accepted: false, refusedBy: "resume" });
    expect(enqueued()).toHaveLength(0);
  });

  it("a file in another account's folder is not this account's file", async () => {
    state.resumeFile = "99999999-9999-4999-8999-999999999999/cv.pdf";
    const { sc } = await call("request_application", { jobId: "teamtailor:acme:123" });
    expect(sc).toMatchObject({ accepted: false, refusedBy: "resume" });
  });

  it("with the file in its own folder, the account is ready", async () => {
    const { sc } = await call("key_status", {});
    expect((sc.apply as { resumeOnFile: boolean }).resumeOnFile).toBe(true);
  });
});

describe("S11-121: the Agent plan opens the résumé scorer", () => {
  const cv = { resumeText: "Registered nurse with ICU experience, patient care and triage. ".repeat(4) };

  it("an Agent-plan key (minted 'free') is not refused, and key_status says so", async () => {
    state.subscribed = true; state.pass = false;
    const r = await call("fit_resume", cv);
    expect(r.raw).not.toMatch(/fit_resume is a paid feature/);
    const { sc } = await call("key_status", {});
    expect((sc.features as { fit_resume: boolean }).fit_resume).toBe(true);
  });

  it("a free key with neither plan nor pass is still refused", async () => {
    state.subscribed = false; state.pass = false;
    const r = await call("fit_resume", cv);
    expect(r.raw).toMatch(/fit_resume is a paid feature/);
    const { sc } = await call("key_status", {});
    expect((sc.features as { fit_resume: boolean }).fit_resume).toBe(false);
  });
});
