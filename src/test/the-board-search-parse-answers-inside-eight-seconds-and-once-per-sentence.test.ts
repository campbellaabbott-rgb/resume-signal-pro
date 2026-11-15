// @vitest-environment node
//
// Node, not jsdom: the handler is bundled with esbuild, which refuses jsdom's
// TextEncoder (see helpers/edge-harness.ts).
/**
 * THE BOARD'S SEARCH PARSE ANSWERS INSIDE EIGHT SECONDS, AND ONCE PER SENTENCE
 * (cost audit 2026-11-08, nl-search).
 *
 * nl-search sent every typed sentence to one preview model with no timeout:
 * a slow reply held the reader for up to the platform's 150 s, a retired
 * model took the feature down, and the same sentence typed again was a new
 * model call. Now:
 *   - the parse has eight seconds (AbortSignal.timeout(8000)); past them the
 *     page gets the answer it already shows for a failed parse, at once, and
 *     the model request is stopped;
 *   - today's model is still asked first, and gpt-5-mini only when it fails,
 *     through the shared chain (so each reply logs its usage line);
 *   - a sentence this isolate already parsed (any case, Unicode form or
 *     spacing) is answered from memory, with no spend-gate count and no model
 *     call; a refusal, a timeout or a failed parse is never remembered;
 *   - the memory is bounded: MEMO_LIMIT sentences, least recently asked
 *     dropped first, none older than MEMO_TTL_MS;
 *   - the preflight carries the new build and Access-Control-Max-Age 7200.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { MEMO_LIMIT, MEMO_TTL_MS, ParseMemo, normaliseQuery } from "../../supabase/functions/nl-search/memo";
import { buildIsAtLeast } from "./helpers/fn-build";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 180_000 });

const PRIMARY = "google/gemini-3-flash-preview";
const MINI = "openai/gpt-5-mini";
const SERVE = "export function serve(h) { globalThis.__edgeHandler = h; }";
const CLIENT = "export function createClient() { const db = globalThis.__nlDb; return { rpc: (n, a) => db.rpc(n, a), from: (t) => db.from(t) }; }";
const STUBS: Record<string, string> = {
  "https://deno.land/std@0.168.0/http/server.ts": SERVE,
  "https://esm.sh/@supabase/supabase-js@2.39.3": CLIENT,
  "https://esm.sh/@supabase/supabase-js@2": CLIENT,
};

let handler: EdgeHandler;
let db: FakeDb;
let counts: number;
let asked: Array<{ model: string; signal: AbortSignal | undefined }>;
let logged: string[];
let gateway: (model: string, signal: AbortSignal | undefined) => Promise<Response>;

const toolReply = (args: Record<string, unknown>) =>
  new Response(JSON.stringify({
    choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ function: { name: "apply_search", arguments: JSON.stringify(args) } }] } }],
    usage: { prompt_tokens: 812, completion_tokens: 31 },
  }), { status: 200 });

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = {
    SUPABASE_URL: "https://harness.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-harness-key-0123456789abcdef",
    LOVABLE_API_KEY: "lovable_harness",
  };
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.fetch = (url: string, init?: { body?: string; signal?: AbortSignal }) => {
    if (String(url).includes("ai.gateway.lovable.dev")) {
      const model = String(JSON.parse(String(init?.body ?? "{}")).model);
      asked.push({ model, signal: init?.signal });
      return gateway(model, init?.signal);
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  };
  handler = await loadEdgeHandler("nl-search", STUBS);
}, 180_000);

beforeEach(() => {
  db = new FakeDb({});
  counts = 0;
  asked = [];
  logged = [];
  db.rpcs.check_rate_limit = () => { counts++; return { data: true, error: null }; };
  (globalThis as Record<string, unknown>).__nlDb = db;
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { logged.push(a.map(String).join(" ")); });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

const ask = (query: string) =>
  handler(new Request("https://harness.supabase.co/functions/v1/nl-search", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer anon_harness", apikey: "anon_harness", "cf-connecting-ip": "198.51.100.4" },
    body: JSON.stringify({ query }),
  }));

describe("a parse that does not come inside eight seconds", () => {
  it("is answered 504 timedOut the moment the eight seconds end, and the model request is stopped", async () => {
    const budget = new AbortController();
    const asks: number[] = [];
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => { asks.push(ms); return budget.signal; });
    // A gateway that never answers on its own: only an abort ends it.
    gateway = (_model, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    });

    const pending = ask("remote staff engineer roles in berlin");
    await vi.waitFor(() => expect(asked.length).toBe(1), { timeout: 2_000 });
    expect(asks).toEqual([8_000]);
    // The address and the function-wide ceiling: both counted before the model was asked.
    expect(counts, "the spend gate did not count before the model was asked").toBeGreaterThan(0);

    const at = Date.now();
    budget.abort();
    const res = await pending;
    expect(Date.now() - at, "the answer waited after the budget ended").toBeLessThan(1_000);
    expect(res.status).toBe(504);
    expect(await res.json()).toMatchObject({ error: "Parse unavailable", timedOut: true });
    expect(asked[0].model).toBe(PRIMARY);
    expect(asked[0].signal?.aborted, "the model request was left running").toBe(true);
  });

  it("a timed-out sentence is not remembered: asked again, the model is asked again", async () => {
    const budget = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => budget.signal);
    gateway = (_model, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    });
    const pending = ask("data roles that sponsor visas");
    await vi.waitFor(() => expect(asked.length).toBe(1), { timeout: 2_000 });
    budget.abort();
    expect((await pending).status).toBe(504);

    vi.restoreAllMocks();
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { logged.push(a.map(String).join(" ")); });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    gateway = async () => toolReply({ query: "data" });
    const again = await ask("data roles that sponsor visas");
    expect(again.status).toBe(200);
    expect(again.headers.get("x-nl-memo")).toBeNull();
    expect(asked.length).toBe(2);
  });
});

describe("the model chain", () => {
  it("asks today's model first, and only it when it answers; its usage is logged, numbers only", async () => {
    gateway = async () => toolReply({ query: "product manager", remote: true });
    const res = await ask("product manager jobs, remote please");
    expect(res.status).toBe(200);
    expect(asked.map((a) => a.model)).toEqual([PRIMARY]);
    const body = await res.json();
    expect(body).toHaveProperty("filters");
    expect(logged.filter((l) => l.startsWith("[AI-USAGE]"))).toEqual([
      `[AI-USAGE] context=NL-SEARCH model=${PRIMARY} prompt_tokens=812 completion_tokens=31 cached_tokens=- reasoning_tokens=- finish_reason=tool_calls`,
    ]);
  });

  it("asks gpt-5-mini only after today's model fails, and the reader gets the parse", async () => {
    gateway = async (model) => (model === PRIMARY ? new Response(JSON.stringify({ error: "model not found" }), { status: 404 }) : toolReply({ query: "nurse" }));
    const res = await ask("night shift nurse in leeds");
    expect(res.status).toBe(200);
    expect(asked.map((a) => a.model)).toEqual([PRIMARY, MINI]);
  });

  it("a reply with no tool call from both models is 502 No parse, as before, and is not remembered", async () => {
    gateway = async () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "I think you want jobs" } }] }), { status: 200 });
    const res = await ask("something vague about jobs");
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "No parse" });
    expect(asked.map((a) => a.model)).toEqual([PRIMARY, MINI]);
    asked = [];
    expect((await ask("something vague about jobs")).status).toBe(502);
    expect(asked.length, "a failed parse was served from memory").toBe(2);
  });

  it("a gateway refusal from both models keeps today's 429 for the page's retry note", async () => {
    gateway = async () => new Response(JSON.stringify({ error: "rate limited" }), { status: 429 });
    const res = await ask("frontend roles in lisbon");
    expect(res.status).toBe(429);
    expect((await res.json()).gatewayStatus).toBe(429);
    expect(asked.map((a) => a.model)).toEqual([PRIMARY, MINI]);
  });
});

describe("a sentence asked twice is parsed once", () => {
  it("the repeat, in any case or spacing, comes from memory with no count and no model call, and says so", async () => {
    gateway = async () => toolReply({ query: "rust", remote: true });
    const first = await ask("Rust jobs, fully remote");
    expect(first.status).toBe(200);
    const firstBody = await first.text();
    const counted = counts;
    expect(counted).toBeGreaterThan(0);
    expect(asked.length).toBe(1);

    const again = await ask("  rust   JOBS, fully remote ");
    expect(again.status).toBe(200);
    expect(again.headers.get("x-nl-memo")).toBe("hit");
    expect(again.headers.get("x-fn-build")).toMatch(/^nl-search\./);
    expect(await again.text()).toBe(firstBody);
    expect(counts, "a remembered parse spent from the gate").toBe(counted);
    expect(asked.length, "a remembered parse asked the model").toBe(1);
  });

  it("the key evens out case, Unicode form and spacing, and nothing else", () => {
    expect(normaliseQuery("  Ｒust\tJOBS\n remote ")).toBe("rust jobs remote");
    expect(normaliseQuery("rust jobs")).not.toBe(normaliseQuery("rust job"));
  });

  it("the memory holds at most its limit, drops the least recently asked first, and forgets past its time", () => {
    let now = 0;
    const memo = new ParseMemo<string>(3, 1_000, () => now);
    memo.set("a", "A");
    memo.set("b", "B");
    memo.set("c", "C");
    expect(memo.get("a")).toBe("A"); // a is now the most recently asked
    memo.set("d", "D");
    expect(memo.size).toBe(3);
    expect(memo.get("b"), "the least recently asked was kept").toBeUndefined();
    expect(memo.get("a")).toBe("A");
    now = 1_001;
    expect(memo.get("a"), "an answer past its time was served").toBeUndefined();
    expect(memo.size).toBe(2);

    expect(MEMO_LIMIT).toBe(256);
    expect(MEMO_TTL_MS).toBe(6 * 60 * 60 * 1000);
    const big = new ParseMemo<number>();
    for (let i = 0; i < MEMO_LIMIT * 3; i++) big.set(`q${i}`, i);
    expect(big.size).toBe(MEMO_LIMIT);
  });
});

describe("the preflight", () => {
  it("carries the new build and lets a browser keep it for two hours", async () => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/nl-search", { method: "OPTIONS" }));
    expect(res.headers.get("access-control-max-age")).toBe("7200");
    expect(buildIsAtLeast(res.headers.get("x-fn-build"), "nl-search", "2026-11-09", 1), String(res.headers.get("x-fn-build"))).toBe(true);
  });
});
