// @vitest-environment node
/**
 * A MODEL READS SLIM CARDS, AND A CHATGPT SEARCH IS NOT LOGGED.
 *
 * Wave 4 (spec D2 §2.1, economics decision 6):
 *   - a model pays for every byte it is handed: a ten-row keyless page is 8 KB
 *     or less, compact JSON, no resource_link blocks, fields a posting does
 *     not state are absent, and get_jobs cuts its descriptions to 40,000
 *     characters in all, saying truncatedForSize;
 *   - a keyless caller pages to offset 200, and the next page is withheld by
 *     name (pageLimitReached), never by an empty page; a count the page has
 *     already passed is reported as a floor (totalAtLeast);
 *   - ChatGPT searches ask the board not to log them (the no-log flag job-board
 *     .93 honours beside the reader proof); nobody else's do;
 *   - the research alias says what its url is: the posting's page on the site.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const URL_ = "https://harness.supabase.co/functions/v1/agent-mcp";
let handler: EdgeHandler;
let boardBodies: Array<Record<string, unknown>>;
let listAnswer: Record<string, unknown>;

const card = (i: number) => ({
  id: `greenhouse:acme${i}:${100000 + i}`, source: "greenhouse", token: `acme${i}`, company: `Acme Health Partners ${i}`,
  title: `Senior Registered Nurse, Intensive Care Unit (Nights) ${i}`, location: "Leeds, West Yorkshire, United Kingdom",
  country: "GB", workMode: "onsite", employmentType: "full_time", salary: "£38,000 - £45,000 per year plus shift allowance",
  postedAt: "2026-10-10T09:00:00Z", applyUrl: `https://boards.greenhouse.io/acme${i}/jobs/${100000 + i}?gh_src=board`,
  salaryMinAnnual: 48000, salaryMaxAnnual: 57000, salaryPeriod: "year", salaryCurrency: "GBP", experienceBand: "senior", minYears: 3,
  department: "Critical Care", category: "healthcare", matchScope: "title", recheckedAt: "2026-10-12T08:00:00Z",
  description: "x".repeat(4000), snippet: "y".repeat(400), agency: false, closeMatch: null,
});

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service_harness", SUPABASE_ANON_KEY: "anon_harness" };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.fetch = async (url: string, init: { body?: string } = {}) => {
    // TEST-NET-2 stands in for an OpenAI egress block.
    if (String(url) === "https://openai.com/chatgpt-connectors.json") {
      return new Response(JSON.stringify({ creationTime: "2026-10-06T23:18:01", prefixes: [{ ipv4Prefix: "198.51.100.0/24" }] }), { status: 200 });
    }
    if (String(url).endsWith("/functions/v1/job-board")) {
      const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
      boardBodies.push(body);
      if (body.action === "detail") return new Response(JSON.stringify({ job: card(1), description: "d".repeat(8000) }), { status: 200 });
      return new Response(JSON.stringify(listAnswer), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  };
  g.__mcpDb = {
    rpc: (name: string, args: Record<string, unknown> = {}) => {
      const data = name === "mcp_anon_check_v2"
        ? { allowed: true, refused_by: null, bucket_used: 1, bucket_cap: Number(args.p_bucket_cap), share_used: 1, share_cap: Number(args.p_global_cap), overall_used: 1, overall_cap: 20000, minute_used: 1, minute_cap: 15 }
        : name === "api_key_check"
        ? { is_allowed: true, deny_reason: "", api_key_id: "key-1", key_tier: "free", rate_limit: 60, rate_used: 1, quota_limit: 1000, quota_used: 1 }
        : null;
      const r = Promise.resolve({ data, error: null });
      return Object.assign(r, { maybeSingle: () => r, single: () => r });
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  };
  handler = await loadEdgeHandler("agent-mcp", {
    "https://esm.sh/@supabase/supabase-js@2.45.0": "export class SupabaseClient {} export function createClient() { return globalThis.__mcpDb; }",
  });
}, 120_000);

beforeEach(() => {
  boardBodies = [];
  listAnswer = { jobs: Array.from({ length: 10 }, (_, i) => card(i)), total: 1584, hasMore: true, nextOffset: 10, filterCoverage: { salaryFloor: 0.24 }, filterCoverageAt: "2026-10-12T03:00:00Z" };
});

const call = async (name: string, args: Record<string, unknown>, headers: Record<string, string> = {}) => {
  const res = await handler(new Request(URL_, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  }));
  const text = await res.text();
  const body = JSON.parse(text) as { result: { structuredContent: Record<string, unknown>; content: Array<{ type: string; text?: string }> } };
  return { text, sc: body.result.structuredContent, content: body.result.content };
};

describe("slim cards for a model", () => {
  it("a ten-row keyless page fits in 8 KB of text, compact, with no resource links and no nulls", async () => {
    const r = await call("search_jobs", { query: "nurse" });
    const page = r.content[0].text!;
    expect(Buffer.byteLength(page)).toBeLessThanOrEqual(8_192);
    expect(page).not.toMatch(/\n/);
    expect(r.content.map((c) => c.type)).toEqual(["text"]);
    const cards = r.sc.jobs as Array<Record<string, unknown>>;
    expect(cards).toHaveLength(10);
    for (const c of cards) {
      expect(Object.values(c)).not.toContain(null);
      expect(c).not.toHaveProperty("description");
      expect(c).not.toHaveProperty("agentReady");
      expect(c.applyForm).toBe(true);
    }
  });

  it("get_jobs cuts ten descriptions to 40,000 characters in all and says so", async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `greenhouse:acme${i}:${100000 + i}`);
    const r = await call("get_jobs", { ids }, { authorization: "Bearer rb_live_x" });
    const cards = r.sc.jobs as Array<{ description: string }>;
    expect(cards.reduce((n, c) => n + c.description.length, 0)).toBeLessThanOrEqual(40_000);
    expect(r.sc.truncatedForSize).toBe(true);
  });
});

describe("a keyless page says where it stops", () => {
  it("a next page past offset 200 is withheld by name", async () => {
    listAnswer = { ...listAnswer, nextOffset: 210 };
    const r = await call("search_jobs", { query: "nurse", offset: 200 });
    expect(r.sc.pageLimitReached).toBe(true);
    expect(r.sc.nextOffset).toBeUndefined();
  });

  it("a total the page has already passed is reported as a floor", async () => {
    listAnswer = { ...listAnswer, total: 5, hasMore: false, nextOffset: undefined };
    const r = await call("search_jobs", { query: "nurse", offset: 10 });
    expect(r.sc.totalAtLeast).toBe(20);
  });
});

describe("a ChatGPT search is not logged; everyone else's is", () => {
  it("ChatGPT's searches carry the no-log flag to the board; a Claude or script search does not", async () => {
    const chatgpt = { "user-agent": "openai-mcp/1.0 (ChatGPT)", "x-forwarded-for": "198.51.100.20" };
    await call("search_jobs", { query: "nurse" }, chatgpt);
    await call("search", { query: "nurse" }, chatgpt);
    expect(boardBodies.map((b) => b.noLog)).toEqual([true, true]);
    boardBodies = [];
    await call("search_jobs", { query: "nurse" });
    await call("search_jobs", { query: "nurse" }, { "x-forwarded-for": "160.79.105.10" });
    expect(boardBodies.map((b) => b.noLog)).toEqual([undefined, undefined]);
    // Sweep S12-085: tied to OpenAI's published egress, a ChatGPT search was
    // logged whenever that list could not be read. Fail-closed: the claim
    // alone keeps a search out of the log (it never picks who pays).
    boardBodies = [];
    await call("search_jobs", { query: "nurse" }, { "user-agent": "openai-mcp/1.0 (ChatGPT)" });
    expect(boardBodies.map((b) => b.noLog)).toEqual([true]);
  });
});

describe("the research alias says what its url is", () => {
  it("the description and the url agree: the posting's page on the site", async () => {
    const res = await handler(new Request(URL_, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }));
    const tool = ((await res.json()) as { result: { tools: Array<{ name: string; description: string }> } }).result.tools.find((t) => t.name === "search")!;
    expect(tool.description).toMatch(/url is the posting's page on resumebooster\.work/);
    expect(tool.description).not.toMatch(/employer's own apply page when the board holds one/);
    const r = await call("search", { query: "nurse" });
    for (const x of r.sc.results as Array<{ url: string }>) expect(x.url.startsWith("https://resumebooster.work/jobs?job=")).toBe(true);
  });
});
