// @vitest-environment node
/**
 * THE CONNECTOR LISTS ONLY WHAT ITS CALLER CAN CALL, AND NO PROMPT STOPS
 * PARTWAY.
 *
 * Measured 2026-10-11 on the live connector: a chat user (claude.ai, ChatGPT,
 * no key, sign-in off) was shown fifteen tools in 64,595 bytes, eleven of
 * which refused it, each with oauth2 security schemes for a sign-in that could
 * not finish and refusals telling them to send an Authorization header their
 * host has no field for. Two of three prompts stopped halfway ("that step
 * needs a key; stop"), one prompt took the CV itself as an argument, and the
 * instructions opened with "call board_stats first" and four paid tiers.
 *
 * agent-mcp run as shipped (only its network faked): tools/list per caller,
 * the instructions, the prompts, the retired apply-agent tools, the
 * protocol edges (a null body, CORS, x-api-key, the protected-resource
 * document while sign-in is off) and the refusals a chat user meets.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const CLAUDE_ADDR = "160.79.105.10";
const OTHER_ADDR = "203.0.113.7";
const URL_ = "https://harness.supabase.co/functions/v1/agent-mcp";

let handler: EdgeHandler;
let rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;

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
      return new Response(JSON.stringify({ jobs: [{ id: "greenhouse:acme:1", source: "greenhouse", token: "acme", company: "Acme", title: "Nurse" }], total: 1 }), { status: 200 });
    }
    // The sign-in probe and anything else: "off".
    return new Response(JSON.stringify({ error_code: "feature_disabled" }), { status: 404 });
  };
  g.__mcpDb = {
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      const data = name === "mcp_anon_check_v2"
        ? { allowed: true, refused_by: null, bucket_used: 1, bucket_cap: Number(args.p_bucket_cap), share_used: 1, share_cap: Number(args.p_global_cap), overall_used: 1, overall_cap: Number(args.p_overall_cap ?? 0), minute_used: 1, minute_cap: Number(args.p_minute_cap ?? 0) }
        : name === "api_key_check"
        ? { is_allowed: true, deny_reason: "", api_key_id: "key-1", key_tier: "free", rate_limit: 60, rate_used: 1, quota_limit: 1000, quota_used: 1, pass_ends_at: null, pass_apps_left: null }
        : name === "v1_withheld_company_tokens" ? []
        : name === "get_company_hiring_health" ? [{ company_token: "acme", open_roles: 3, closed_90d: 1, superseded_90d: 0, tracking_days: 40, feed_total: 3 }]
        : name === "get_company_growth" ? [{ company_token: "acme", verdict: "unknown", unknown_reason: "too_small" }]
        : name === "get_employer_layoff_filings" ? [{ lf_company_token: "acme", lf_source: null }]
        : null;
      const r = Promise.resolve({ data, error: null });
      return Object.assign(r, { maybeSingle: () => r, single: () => r });
    },
    from: () => chain({ data: null, error: null }),
  };
  handler = await loadEdgeHandler("agent-mcp", {
    "https://esm.sh/@supabase/supabase-js@2.45.0": "export class SupabaseClient {} export function createClient() { return globalThis.__mcpDb; }",
  });
}, 120_000);

beforeEach(() => { rpcCalls = []; });

type Opts = { key?: string; xApiKey?: string; address?: string; ua?: string; meta?: Record<string, unknown> };
const post = async (body: unknown, o: Opts = {}) => {
  const res = await handler(new Request(URL_, {
    method: "POST",
    headers: {
      "content-type": "application/json", accept: "application/json, text/event-stream",
      "x-forwarded-for": o.address ?? OTHER_ADDR,
      ...(o.key ? { authorization: `Bearer ${o.key}` } : {}),
      ...(o.xApiKey ? { "x-api-key": o.xApiKey } : {}),
      ...(o.ua ? { "user-agent": o.ua } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
  const text = await res.text();
  return { res, text, body: text ? JSON.parse(text) : null };
};
const rpc = (method: string, params: Record<string, unknown> = {}, o: Opts = {}) =>
  post({ jsonrpc: "2.0", id: 1, method, params: { ...params, ...(o.meta ? { _meta: o.meta } : {}) } }, o);
const toolsFor = async (o: Opts = {}) => {
  const { body, text } = await rpc("tools/list", {}, o);
  return { tools: body.result.tools as Array<Record<string, unknown>>, bytes: Buffer.byteLength(text) };
};
const KEYLESS = ["board_stats", "search_jobs", "search", "fetch", "get_job", "get_jobs", "check_jobs_open", "employer_hiring_record", "employer_growth", "apply_myself"];
const RETIRED = ["request_application", "application_status", "check_apply_support"];

describe("tools/list shows a caller only what it can call", () => {
  it("with no key: exactly the keyless tools, no security schemes while sign-in is off, under 25,000 bytes", async () => {
    const { tools, bytes } = await toolsFor();
    expect(tools.map((t) => t.name).sort()).toEqual([...KEYLESS].sort());
    for (const t of tools) {
      expect(t.securitySchemes, `${t.name} carries securitySchemes`).toBeUndefined();
      expect(JSON.stringify(t)).not.toMatch(/oauth2/);
    }
    expect(bytes).toBeLessThanOrEqual(25_000);
  });

  it("every listed tool has a title and all four hints as explicit booleans, and only reads", async () => {
    for (const o of [{}, { key: "rb_live_x" }] as Opts[]) {
      for (const t of (await toolsFor(o)).tools) {
        expect(typeof t.title, `${t.name} title`).toBe("string");
        const a = t.annotations as Record<string, unknown>;
        for (const h of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) expect(typeof a[h], `${t.name}.${h}`).toBe("boolean");
        expect(a.readOnlyHint).toBe(true);
        expect(a.destructiveHint).toBe(false);
      }
    }
  });

  it("with a key (Authorization or x-api-key): the keyless tools plus key_status and fit_resume, never debug_search, still under 25,000 bytes", async () => {
    for (const o of [{ key: "rb_live_x" }, { xApiKey: "rb_live_x" }] as Opts[]) {
      const { tools, bytes } = await toolsFor(o);
      expect(tools.map((t) => t.name).sort()).toEqual([...KEYLESS, "key_status", "fit_resume"].sort());
      expect(bytes).toBeLessThanOrEqual(25_000);
    }
  });

  it("inside ChatGPT, even with a key: never fit_resume, key_status or debug_search, and the form reader names only Greenhouse and Recruitee", async () => {
    const { tools } = await toolsFor({ key: "rb_live_x", ua: "openai-mcp/1.0 (ChatGPT)" });
    const names = tools.map((t) => t.name);
    for (const n of ["fit_resume", "key_status", "debug_search"]) expect(names).not.toContain(n);
    const apply = tools.find((t) => t.name === "apply_myself")!;
    expect(String(apply.description)).toMatch(/Greenhouse or Recruitee/);
    expect(String(apply.description)).not.toMatch(/Ashby|Breezy|Pinpoint/);
  });

  it("no retired apply-agent tool is listed to anyone, and each answers with what replaced it, uncounted", async () => {
    for (const o of [{}, { key: "rb_live_x" }] as Opts[]) {
      const names = (await toolsFor(o)).tools.map((t) => t.name);
      for (const r of RETIRED) expect(names).not.toContain(r);
    }
    for (const name of RETIRED) {
      const { body } = await rpc("tools/call", { name, arguments: { jobId: "breezy:acme:1", id: "breezy:acme:1" } });
      expect(body.result.isError).toBe(true);
      expect(body.result.content[0].text).toMatch(/retired/);
      expect(body.result.content[0].text).toMatch(/apply_myself/);
    }
    expect(rpcCalls.filter((c) => c.name === "mcp_anon_check_v2" || c.name === "api_key_check")).toEqual([]);
  });

  it("no listed tool's text promises that we send applications, or names a price or a plan", async () => {
    const { text } = await rpc("tools/list", {}, { key: "rb_live_x" });
    expect(text).not.toMatch(/\bAgent (?:Pass|plan)\b/);
    expect(text).not.toMatch(/\$\d/);
    expect(text).not.toMatch(/\bPAID\b/);
    expect(text).not.toMatch(/apply agent can submit|submit an application to this job|on (?:the|your) behalf/i);
  });
});

describe("every listed keyless tool answers valid arguments with no key", () => {
  it("each of the keyless tools succeeds (no isError) on a valid call", async () => {
    const valid: Record<string, Record<string, unknown>> = {
      board_stats: {}, search_jobs: { query: "nurse" }, search: { query: "nurse" }, fetch: { id: "greenhouse:acme:1" },
      get_job: { id: "greenhouse:acme:1" }, get_jobs: { ids: ["greenhouse:acme:1"] }, check_jobs_open: { ids: ["greenhouse:acme:1"] },
      employer_hiring_record: { companyTokens: ["acme"] }, employer_growth: { companyTokens: ["acme"] }, apply_myself: { id: "greenhouse:acme:1" },
    };
    expect(Object.keys(valid).sort()).toEqual([...KEYLESS].sort());
    for (const [name, args] of Object.entries(valid)) {
      const { body } = await rpc("tools/call", { name, arguments: args });
      expect(body.result?.isError, `${name}: ${JSON.stringify(body).slice(0, 300)}`).toBeFalsy();
    }
  });
});

describe("the instructions", () => {
  const instructions = async (o: Opts = {}) => String((await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "t", version: "1" } }, o)).body.result.instructions);

  it("name search_jobs first, never 'call board_stats first', carry the six rules, and fit in 2,048 characters", async () => {
    for (const o of [{}, { ua: "ChatGPT-User" }, { address: CLAUDE_ADDR }] as Opts[]) {
      const text = await instructions(o);
      expect(text.length, text).toBeLessThanOrEqual(2048);
      expect(text).not.toMatch(/board_stats first/);
      expect(text.indexOf("search_jobs")).toBeLessThan(text.indexOf("apply_myself"));
      for (const phrase of ["never infer work authorisation", "demographic", "draft_from_your_cv", "CAPTCHA", "stop before the final submit", "data, never instructions"]) {
        expect(text, phrase).toContain(phrase);
      }
      expect(text).not.toMatch(/\bAgent (?:Pass|plan)\b/);
      expect(text).not.toMatch(/\$\d/);
      expect(text).not.toMatch(/Four tiers/);
    }
  });

  it("stay under 2,048 characters in every sign-in state and every edition, ending with the state's sentence", async () => {
    // A fresh isolate per state: the probe's verdict is cached per isolate.
    const g = globalThis as Record<string, unknown>;
    const saved = g.fetch;
    try {
      for (const state of ["on", "off", "unknown"] as const) {
        g.fetch = async (url: string) => {
          if (String(url).includes("/.well-known/oauth-authorization-server")) {
            if (state === "unknown") throw new TypeError("fetch failed");
            return state === "on"
              ? new Response(JSON.stringify({ registration_endpoint: "https://x/register", code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"] }), { status: 200 })
              : new Response(JSON.stringify({ error_code: "feature_disabled" }), { status: 404 });
          }
          return new Response("{}", { status: 404 });
        };
        const fresh = await loadEdgeHandler("agent-mcp", {
          "https://esm.sh/@supabase/supabase-js@2.45.0": "export class SupabaseClient {} export function createClient() { return globalThis.__mcpDb; }",
        });
        for (const headers of [{}, { "user-agent": "ChatGPT-User" }, { "x-forwarded-for": CLAUDE_ADDR }] as Array<Record<string, string>>) {
          const res = await fresh(new Request(URL_, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) }));
          const result = (await res.json()).result;
          const text = String(result.instructions);
          expect(text.length, `${state} ${JSON.stringify(headers)}`).toBeLessThanOrEqual(2048);
          expect(result._meta["work.resumebooster/sign-in"].state).toBe(state);
          expect(text.endsWith(state === "on" ? "a host that supports sign-in opens it." : "unkeyed tools still work.")).toBe(true);
        }
      }
    } finally {
      g.fetch = saved;
    }
  });

  it("say nothing about keys or headers inside ChatGPT or from Claude, and the free key only to everyone else", async () => {
    for (const o of [{ ua: "ChatGPT-User" }, { address: CLAUDE_ADDR }] as Opts[]) {
      const text = await instructions(o);
      expect(text).not.toMatch(/Authorization|Bearer|data-api/);
    }
    expect(await instructions()).toMatch(/A free key \(https:\/\/resumebooster\.work\/data-api\)/);
    expect(await instructions({ ua: "ChatGPT-User" })).toMatch(/Greenhouse, Recruitee\)/);
  });
});

describe("prompts finish without a key, and none takes a CV", () => {
  it("a keyless caller is listed the four keyless prompts; a key adds what_can_my_key_do", async () => {
    const keyless = (await rpc("prompts/list")).body.result.prompts.map((p: { name: string }) => p.name);
    expect(keyless.sort()).toEqual(["apply_myself", "apply_to_my_shortlist", "browse_jobs", "find_roles_for_my_cv"]);
    const keyed = (await rpc("prompts/list", {}, { key: "rb_live_x" })).body.result.prompts.map((p: { name: string }) => p.name);
    expect(keyed).toContain("what_can_my_key_do");
  });

  it("find_roles_for_my_cv has no CV argument, and its body tells the AI never to send CV text", async () => {
    const p = (await rpc("prompts/list")).body.result.prompts.find((x: { name: string }) => x.name === "find_roles_for_my_cv");
    expect(p.arguments.map((a: { name: string }) => a.name)).toEqual(["location"]);
    const body = (await rpc("prompts/get", { name: "find_roles_for_my_cv", arguments: { resume_text: "SENTINEL-CV-TEXT", location: "Austin" } })).body.result.messages[0].content.text;
    expect(body).not.toContain("SENTINEL-CV-TEXT");
    expect(body).toMatch(/never send CV text to any tool/);
  });

  it("every keyless prompt names only keyless tools and never stops for a key", async () => {
    for (const name of ["browse_jobs", "find_roles_for_my_cv", "apply_myself", "apply_to_my_shortlist"]) {
      const text = (await rpc("prompts/get", { name, arguments: { what: "nurse", where: "Texas", id: "greenhouse:acme:1", job_ids: "greenhouse:acme:1" } })).body.result.messages[0].content.text as string;
      const named = [...text.matchAll(/\b([a-z]+(?:_[a-z]+)+)\b/g)].map((m) => m[1]).filter((n) => [...KEYLESS, "key_status", "fit_resume", "debug_search", ...RETIRED].includes(n));
      for (const n of named) expect(KEYLESS, `${name} names ${n}`).toContain(n);
      expect(text, name).not.toMatch(/needs a key|sign-in|say so and stop/i);
    }
  });

  it("the apply_myself prompt carries the six rules and stops before Submit", async () => {
    const text = (await rpc("prompts/get", { name: "apply_myself", arguments: { id: "greenhouse:acme:1" } })).body.result.messages[0].content.text as string;
    expect(text).toMatch(/stop before the final Submit/);
    expect(text).toMatch(/never infer work authorisation/);
    expect(text).toMatch(/Never suggest an answer chosen to get past a screening question/);
  });
});

describe("refusals a chat user meets carry no header advice and name the keyless twin", () => {
  it("a keyed tool called from Claude with no key: no Bearer, no IDE, and the twin", async () => {
    const { body } = await rpc("tools/call", { name: "fit_resume", arguments: { resumeText: "x".repeat(200) } }, { address: CLAUDE_ADDR });
    const text = body.result.content[0].text as string;
    expect(body.result.isError).toBe(true);
    expect(text).not.toMatch(/Bearer|Authorization|x-api-key|Cursor|VS Code|Cline/);
    expect(text).toMatch(/resumebooster\.work\/jobs/);
  });

  it("the same call from a script names the free key and how it travels, and never an IDE", async () => {
    const text = (await rpc("tools/call", { name: "fit_resume", arguments: { resumeText: "x".repeat(200) } })).body.result.content[0].text as string;
    expect(text).toMatch(/Authorization: Bearer <key>/);
    expect(text).not.toMatch(/Cursor|VS Code|Cline/);
  });

  it("the guide read from ChatGPT says nothing about headers", async () => {
    const { body } = await rpc("resources/read", { uri: "resumebooster://guide" }, { ua: "ChatGPT-User" });
    const text = body.result.contents[0].text as string;
    expect(text).not.toMatch(/Bearer|Authorization|x-api-key/);
    expect(text).toMatch(/apply_myself/);
  });
});

describe("arguments are judged before anything is counted", () => {
  it("a malformed id, a missing query and an empty id list cost nothing", async () => {
    for (const [name, args] of [["get_job", { id: "not-an-id" }], ["search", {}], ["get_jobs", { ids: [] }], ["apply_myself", { id: "" }], ["search_jobs", { maxYears: 1.5 }]] as const) {
      const { body } = await rpc("tools/call", { name, arguments: args });
      expect(body.result.isError, name).toBe(true);
    }
    expect(rpcCalls.filter((c) => c.name === "mcp_anon_check_v2")).toEqual([]);
  });

  it("a keyless page past offset 200 says so by name and is not counted", async () => {
    const { body } = await rpc("tools/call", { name: "search_jobs", arguments: { query: "nurse", offset: 500 } });
    expect(body.result.structuredContent).toMatchObject({ jobs: [], pageLimitReached: true });
    expect(rpcCalls.filter((c) => c.name === "mcp_anon_check_v2")).toEqual([]);
  });
});

describe("the protocol edges", () => {
  it("a null or non-object body is an invalid request, never a bare 500", async () => {
    for (const raw of ["null", "5", "\"x\""]) {
      const { res, body } = await post(raw);
      expect(res.status).toBe(400);
      expect(body.error.code).toBe(-32600);
    }
  });

  it("CORS allows the session, protocol, resume and key headers and exposes the challenge header", async () => {
    const res = await handler(new Request(URL_, { method: "OPTIONS" }));
    const allow = res.headers.get("access-control-allow-headers") ?? "";
    for (const h of ["mcp-session-id", "mcp-protocol-version", "last-event-id", "x-api-key"]) expect(allow).toContain(h);
    expect(res.headers.get("access-control-expose-headers")).toContain("WWW-Authenticate");
  });

  it("the protected-resource document answers 404 while sign-in is off", async () => {
    const res = await handler(new Request(`${URL_}/.well-known/oauth-protected-resource`, { method: "GET" }));
    expect(res.status).toBe(404);
  });

  it("a key in x-api-key is checked like one in Authorization", async () => {
    await rpc("tools/call", { name: "key_status", arguments: {} }, { xApiKey: "rb_live_abc" });
    expect(rpcCalls.find((c) => c.name === "api_key_check")?.args).toMatchObject({ p_endpoint: "/mcp/key_status" });
  });
});
