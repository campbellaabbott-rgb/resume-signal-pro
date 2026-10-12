// @vitest-environment node
/**
 * The MCP connector (agent-mcp), run as shipped with only its network faked.
 *
 * Inside ChatGPT this server may not send the reader to buy anything
 * (OpenAI's app rules). The first way it kept that rule was a word filter run
 * over the WHOLE answer on the way out, so job data was filtered too: an
 * employer, a title, an id or an apply link holding one of the filtered words
 * lost the clause that held it, and a string with nothing left became the
 * pass sentence. get_job on such an id then failed, because the id itself had
 * been rewritten. And the filter ran on tools/call only, so the guide, the
 * key's status resource and the initialize text still carried the pass link.
 *
 * Now each purchase sentence has a ChatGPT edition chosen where the sentence
 * is built; job data is never read by the choice. Since the apply pivot
 * (owner decision 2026-10-11) there is nothing to buy on any edition: the
 * pass and the plan are retired, so no answer carries a pass link at all.
 * The edition still chooses the words around the data (a plain siteUrl with
 * no tracking tags, the forms read inside ChatGPT), never the data.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

let handler: EdgeHandler;
let tables: Record<string, unknown>;

const JOBS = [
  { id: "lever:upgrade:abc", source: "lever", token: "upgrade", company: "Upgrade", title: "Subscription Billing Analyst", matchScope: "title", applyUrl: "https://jobs.lever.co/upgrade/abc" },
  { id: "greenhouse:bestbuy:1", source: "greenhouse", token: "bestbuy", company: "Best Buy", title: "Purchase Ledger Clerk", matchScope: "title", applyUrl: "https://boards.greenhouse.io/bestbuy/jobs/1" },
  { id: "ashby:buyersedge:7", source: "ashby", token: "buyersedge", company: "Buyers Edge", title: "Buy-side Analyst — Subscribe & Save", matchScope: "description", applyUrl: "https://jobs.ashbyhq.com/buyersedge/7" },
];
const DESCRIPTION =
  "You will buy inventory for our stores. You will purchase supplies, or upgrade the point-of-sale systems; " +
  "you will also manage customer subscriptions — subscribe, renew, cancel. Bought-in parts are logged in the ledger.";

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
      const body = JSON.parse(String(init.body ?? "{}")) as { action?: string; id?: string };
      if (body.action === "detail") {
        const job = JOBS.find((j) => j.id === body.id);
        return new Response(JSON.stringify(job ? { job, description: DESCRIPTION } : { job: null }), { status: 200 });
      }
      return new Response(JSON.stringify({ jobs: JOBS, total: 3, hasMore: false }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  };
  handler = await loadEdgeHandler("agent-mcp", {
    "https://esm.sh/@supabase/supabase-js@2.45.0": "export class SupabaseClient {} export function createClient() { return globalThis.__mcpDb; }",
  });
}, 120_000);

beforeEach(() => {
  // An account-linked free key with a live mandate and a résumé, and no plan
  // and no pass: request_application reaches the funding refusal.
  tables = {
    api_keys: { user_id: "00000000-0000-4000-8000-000000000001" },
    agent_mandates: { active: true, paused_until: null, resume_text: "r".repeat(200), apply_mode: "review" },
  };
  (globalThis as Record<string, unknown>).__mcpDb = {
    rpc: (name: string) => {
      const data = name === "mcp_anon_check_v2"
        ? { allowed: true, refused_by: null, bucket_used: 1, bucket_cap: 100, share_used: 1, share_cap: 4000, overall_used: 1, overall_cap: 20000, minute_used: 1, minute_cap: 15 }
        : name === "api_key_check"
          ? { is_allowed: true, deny_reason: "", api_key_id: "key-1", key_tier: "free", rate_limit: 60, rate_used: 1, quota_limit: 1000, quota_used: 1, pass_ends_at: null, pass_apps_left: null }
          : null;
      const r = Promise.resolve({ data, error: null });
      return Object.assign(r, { maybeSingle: () => r, single: () => r });
    },
    from: (table: string) => chain({ data: tables[table] ?? null, error: null }),
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  };
});

const KEY = "rb_live_harness_key_0123456789";
const IN_CHATGPT_META = { meta: { "openai/subject": "u-123" } };
const IN_CHATGPT_UA = { ua: "openai-mcp/1.0.0" };

type Opts = { key?: string; meta?: Record<string, unknown>; ua?: string };
const rpc = async (method: string, params: Record<string, unknown>, opts: Opts = {}) => {
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/agent-mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json", accept: "application/json, text/event-stream",
      ...(opts.key ? { authorization: `Bearer ${opts.key}` } : {}),
      ...(opts.ua ? { "user-agent": opts.ua } : {}),
      "x-forwarded-for": "203.0.113.7",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { ...params, ...(opts.meta ? { _meta: opts.meta } : {}) } }),
  }));
  const text = await res.text();
  return { raw: text, body: JSON.parse(text) as { result?: Record<string, unknown> } };
};
const call = async (name: string, args: Record<string, unknown>, opts: Opts = {}) => {
  const { raw, body } = await rpc("tools/call", { name, arguments: args }, opts);
  const result = (body.result ?? {}) as { structuredContent?: Record<string, unknown>; content?: Array<{ text: string }> };
  const fromText = JSON.parse(result.content?.[0]?.text ?? "{}") as Record<string, unknown>;
  return { raw, sc: result.structuredContent ?? fromText, fromText };
};
const cardFields = (j: Record<string, unknown>) => ({ id: j.id, title: j.title, company: j.company, applyUrl: j.applyUrl });

describe("inside ChatGPT a job arrives exactly as the board gave it", () => {
  for (const [label, opts] of [["openai/ _meta", IN_CHATGPT_META], ["ChatGPT's user agent", IN_CHATGPT_UA]] as const) {
    it(`search_jobs keeps every employer, title, id and apply link holding a purchase word (${label})`, async () => {
      for (const key of [undefined, KEY]) {
        const plain = await call("search_jobs", { query: "analyst" }, { key });
        const gpt = await call("search_jobs", { query: "analyst" }, { key, ...opts });
        const want = JOBS.map(cardFields);
        expect((gpt.sc.jobs as Array<Record<string, unknown>>).map(cardFields)).toEqual(want);
        expect((gpt.fromText.jobs as Array<Record<string, unknown>>).map(cardFields)).toEqual(want);
        expect((plain.sc.jobs as Array<Record<string, unknown>>).map(cardFields)).toEqual(want);
        // The edition chooses the link's tags, never the posting it names.
        for (const j of gpt.sc.jobs as Array<Record<string, unknown>>) expect(String(j.siteUrl)).toBe(`https://resumebooster.work/jobs?job=${encodeURIComponent(String(j.id))}`);
      }
    });

    it(`get_job and fetch on such an id answer the posting, description intact (${label})`, async () => {
      const plain = await call("get_job", { id: "lever:upgrade:abc" }, { key: KEY });
      const gpt = await call("get_job", { id: "lever:upgrade:abc" }, { key: KEY, ...opts });
      expect(cardFields(gpt.sc)).toEqual(cardFields(plain.sc));
      expect(gpt.sc.description).toBe(plain.sc.description);
      expect(cardFields(gpt.sc)).toEqual(cardFields(JOBS[0]));
      expect(gpt.sc.description).toBe(DESCRIPTION);

      const fetched = await call("fetch", { id: "greenhouse:bestbuy:1" }, opts);
      expect(fetched.sc).toMatchObject({ id: "greenhouse:bestbuy:1", title: "Purchase Ledger Clerk", text: DESCRIPTION });
      expect((fetched.sc.metadata as Record<string, unknown>).company).toBe("Best Buy");
    });
  }
});

describe("no edition is sent to buy anything: the pass and the plan are retired", () => {
  it("request_application answers its retirement in both editions, with the path that replaced it and no link to buy", async () => {
    for (const opts of [{ key: KEY }, { key: KEY, ...IN_CHATGPT_META }] as Opts[]) {
      const r = await call("request_application", { jobId: "greenhouse:bestbuy:1" }, opts);
      expect(r.raw).toMatch(/retired/);
      expect(r.raw).toMatch(/apply_myself/);
      expect(r.raw).not.toMatch(/agents\/pass|\bbuy\b|subscribe at/i);
    }
  });

  it("key_status carries no buy, upgrade or pass link in either edition", async () => {
    for (const opts of [{ key: KEY }, { key: KEY, ...IN_CHATGPT_UA }] as Opts[]) {
      const r = await call("key_status", {}, opts);
      expect(r.sc).not.toHaveProperty("upgrade");
      expect(r.sc).not.toHaveProperty("apply");
      expect(r.raw).not.toMatch(/agents\/pass|\\"buy\\"/);
    }
  });
});

describe("the answers that are not tool calls follow the same rule", () => {
  it("resources/read of the guide and of the key's status carry no pass link on any edition", async () => {
    const guide = (opts: Opts) => rpc("resources/read", { uri: "resumebooster://guide" }, opts);
    expect((await guide({})).raw).not.toMatch(/agents\/pass/);
    expect((await guide(IN_CHATGPT_UA)).raw).not.toMatch(/agents\/pass/);
    expect((await guide(IN_CHATGPT_META)).raw).not.toMatch(/agents\/pass/);

    const me = (opts: Opts) => rpc("resources/read", { uri: "resumebooster://me/key" }, { key: KEY, ...opts });
    expect((await me({})).raw).not.toMatch(/agents\/pass/);
    const gptMe = await me(IN_CHATGPT_UA);
    expect(gptMe.raw).toContain("contents");
    expect(gptMe.raw).not.toMatch(/agents\/pass|\\"buy\\"/);
  });

  it("initialize and the tool list carry no pass link for any host", async () => {
    for (const opts of [{}, IN_CHATGPT_UA]) {
      const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } }, opts);
      expect(init.raw).not.toMatch(/Agent Pass|agents\/pass/);
      const list = await rpc("tools/list", {}, opts);
      expect(list.raw).not.toContain("request_application");
      expect(list.raw).not.toMatch(/agents\/pass|Agent Pass/);
    }
  });
});
