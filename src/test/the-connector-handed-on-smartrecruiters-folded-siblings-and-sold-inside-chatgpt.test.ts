// @vitest-environment node
/**
 * The MCP connector (agent-mcp), run as shipped with only its network faked.
 *
 *  - OWNER DECISION 4 (2026-10-08): SmartRecruiters postings are withheld from
 *    the connector until SmartRecruiters (SAP) grants permission; it served
 *    them.
 *  - S8-029: search never sent groupSimilar:false, so a multi-site employer's
 *    sibling postings were folded into one card and never delivered.
 *  - S8-077: relatedTotal and each card's matchScope were dropped, so `total`
 *    (title matches) contradicted the rows served.
 *  - S8-079: coverage percentages were hand-typed into tool descriptions; the
 *    live filterCoverage the board answers with was dropped on the way out.
 *  - MCP directory prep (commercial plan, experiment 2): result links go to
 *    the posting's page with tracking, and nothing returned inside ChatGPT
 *    sends the reader to buy something (OpenAI's app rules).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

let handler: EdgeHandler;
let boardBodies: Array<Record<string, unknown>>;
let boardAnswer: Record<string, unknown>;
let rpcNames: string[];

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
  g.fetch = async (url: string, init: { body?: string }) => {
    if (String(url).endsWith("/functions/v1/job-board")) {
      boardBodies.push(JSON.parse(String(init.body ?? "{}")));
      return new Response(JSON.stringify(boardAnswer), { status: 200 });
    }
    // The sign-in probe and anything else: answer "off".
    return new Response("{}", { status: 404 });
  };
  handler = await loadEdgeHandler("agent-mcp", {
    "https://esm.sh/@supabase/supabase-js@2.45.0": "export class SupabaseClient {} export function createClient() { return globalThis.__mcpDb; }",
  });
}, 120_000);

beforeEach(() => {
  boardBodies = [];
  rpcNames = [];
  boardAnswer = {
    jobs: [
      { id: "greenhouse:acme:1", source: "greenhouse", token: "acme", company: "Acme", title: "Kubernetes Engineer", matchScope: "title", applyUrl: "https://boards.greenhouse.io/acme/jobs/1" },
      { id: "smartrecruiters:acmesr:9", source: "smartrecruiters", token: "acmesr", company: "Acme SR", title: "Kubernetes Engineer", matchScope: "title" },
      { id: "greenhouse:acme:2", source: "greenhouse", token: "acme", company: "Acme", title: "Platform Engineer", matchScope: "description" },
    ],
    total: 141, relatedTotal: 2859, filterCoverage: { hasStatedPay: 0.322 }, filterCoverageAt: "2026-10-08T10:36:00Z",
    hasMore: true, nextOffset: 20,
  };
  (globalThis as Record<string, unknown>).__mcpDb = {
    rpc: (name: string) => {
      rpcNames.push(name);
      const data = name === "v1_withheld_company_tokens"
        ? ["acmesr", "usajobs"]
        : name === "get_company_hiring_health" || name === "get_company_growth"
          ? [{ company_token: "acmesr", closed_90d: 4, superseded_90d: 0, verdict: "unknown", unknown_reason: "no_series" }]
          : name === "mcp_anon_check_v2"
        ? { allowed: true, refused_by: null, bucket_used: 1, bucket_cap: 100, share_used: 1, share_cap: 4000, overall_used: 1, overall_cap: 20000, minute_used: 1, minute_cap: 15 }
        : name === "api_key_check"
          ? { is_allowed: true, deny_reason: "", api_key_id: "key-1", key_tier: "free", rate_limit: 60, rate_used: 1, quota_limit: 1000, quota_used: 1, pass_ends_at: null, pass_apps_left: null }
          : null;
      const r = Promise.resolve({ data, error: null });
      return Object.assign(r, { maybeSingle: () => r, single: () => r });
    },
    from: () => chain({ data: null, error: null }),
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  };
});

const call = async (name: string, args: Record<string, unknown>, opts: { key?: string; meta?: Record<string, unknown>; ua?: string } = {}) => {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/agent-mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json", accept: "application/json, text/event-stream",
      ...(opts.key ? { authorization: `Bearer ${opts.key}` } : {}),
      ...(opts.ua ? { "user-agent": opts.ua } : {}),
      "x-forwarded-for": "203.0.113.7",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args, ...(opts.meta ? { _meta: opts.meta } : {}) } }),
  }));
  const body = await res.json() as { result?: { structuredContent?: Record<string, unknown>; content?: Array<{ text: string }> } };
  return { status: res.status, raw: JSON.stringify(body), sc: body.result?.structuredContent ?? JSON.parse(body.result?.content?.[0]?.text ?? "{}") };
};

describe("search through the connector", () => {
  it("withholds SmartRecruiters rows and asks the board not to fold siblings", async () => {
    const { sc } = await call("search_jobs", { query: "kubernetes" });
    const jobs = sc.jobs as Array<Record<string, unknown>>;
    expect(jobs.map((j) => j.id)).toEqual(["greenhouse:acme:1", "greenhouse:acme:2"]);
    expect(boardBodies[0]).toMatchObject({ groupSimilar: false });
  });

  it("carries the description-match total, the live coverage and each card's scope and page", async () => {
    const { sc } = await call("search_jobs", { query: "kubernetes" });
    expect(sc).toMatchObject({ relatedTotal: 2859, filterCoverage: { hasStatedPay: 0.322 }, filterCoverageAt: "2026-10-08T10:36:00Z" });
    const [first] = sc.jobs as Array<Record<string, unknown>>;
    expect(first).toMatchObject({ matchScope: "title" });
    expect(String(first.siteUrl)).toMatch(/^https:\/\/resumebooster\.work\/jobs\?job=greenhouse%3Aacme%3A1&utm_source=mcp&utm_medium=connector/);
  });

  it("the research listing links each result to its page on the site, tagged", async () => {
    const { sc } = await call("search", { query: "kubernetes" });
    const urls = (sc.results as Array<{ url: string }>).map((r) => r.url);
    expect(urls.every((u) => u.startsWith("https://resumebooster.work/jobs?job=") && u.includes("utm_source=mcp"))).toBe(true);
  });
});

describe("a SmartRecruiters employer named by its own token is refused, not answered empty", () => {
  // Its token is the employer's slug, never the vendor code, so the vendor
  // check let it through: the board filtered to that employer, every row was
  // dropped on the way out, and the agent read "no openings". /v1 refuses the
  // same token with a 451 through the withheld reader; so does the connector.
  it("search_jobs refuses it by name, before the board is asked", async () => {
    const r = await call("search_jobs", { query: "engineer", companies: ["acmesr"] });
    expect(r.raw).toMatch(/acmesr cannot be served by this server/);
    expect(r.raw).toMatch(/SmartRecruiters/);
    expect(boardBodies).toHaveLength(0);
  });

  it("another employer in the same search is still answered", async () => {
    const r = await call("search_jobs", { query: "engineer", companies: ["acme"] });
    expect(r.raw).not.toMatch(/cannot be served/);
    expect(boardBodies).toHaveLength(1);
  });

  it.each(["employer_hiring_record", "employer_growth"])("%s refuses it rather than publishing its SmartRecruiters figures", async (tool) => {
    const r = await call(tool, { companyTokens: ["acmesr"] }, { key: "rb_live_harness_key_0123456789" });
    expect(r.raw).toMatch(/acmesr cannot be served by this server/);
    expect(rpcNames).not.toContain(tool === "employer_growth" ? "get_company_growth" : "get_company_hiring_health");
  });
});

describe("nothing sends the reader to buy (inside ChatGPT, and since the apply pivot anywhere)", () => {
  it("key_status carries no purchase link for any caller", async () => {
    const plain = await call("key_status", {}, { key: "rb_live_harness_key_0123456789" });
    expect(plain.raw).not.toMatch(/agents\/pass/);
    const gpt = await call("key_status", {}, { key: "rb_live_harness_key_0123456789", meta: { "openai/subject": "u-123" } });
    expect(gpt.raw).not.toMatch(/agents\/pass|\bbuy\b|subscribe at/i);
    const byAgent = await call("key_status", {}, { key: "rb_live_harness_key_0123456789", ua: "openai-mcp/1.0.0" });
    expect(byAgent.raw).not.toMatch(/agents\/pass/);
  });
});

describe("the guide an agent reads first names what the connector withholds", () => {
  it("resources/read of the guide names SmartRecruiters and the federal feed", async () => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/agent-mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "resources/read", params: { uri: "resumebooster://guide" } }),
    }));
    const body = await res.json() as { result?: { contents?: Array<{ text?: string }> } };
    const text = body.result?.contents?.[0]?.text ?? "";
    expect(text.length).toBeGreaterThan(500);
    expect(text).toMatch(/SmartRecruiters/);
    expect(text).toMatch(/federal/);
  });
});
