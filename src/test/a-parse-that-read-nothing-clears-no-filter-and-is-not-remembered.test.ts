// @vitest-environment node
//
// Node, not jsdom: the handler is bundled with esbuild, which refuses jsdom's
// TextEncoder (see helpers/edge-harness.ts).
/**
 * A PARSE THAT READ NOTHING CLEARS NO FILTER AND IS NOT REMEMBERED (NB-23,
 * NB-24; the nl-search half).
 *
 * NB-23. A model reply whose tool arguments did not parse read as {}, which
 * validated to no filters, which the page applied: every filter the reader
 * had set was cleared, and the empty answer was remembered for the sentence.
 * Now an unreadable reply sends the chain to the next model and, past the
 * last, answers 502 "No parse"; an answer that binds no filter is sent but
 * never remembered.
 *
 * NB-24. The gateway's own error text went to the anonymous caller as
 * `detail`. It stays in the function log; the caller gets the status and a
 * fixed reason.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 180_000 });

const SERVE = "export function serve(h) { globalThis.__edgeHandler = h; }";
const CLIENT = "export function createClient() { const db = globalThis.__nlDb; return { rpc: (n, a) => db.rpc(n, a), from: (t) => db.from(t) }; }";
const STUBS: Record<string, string> = {
  "https://deno.land/std@0.168.0/http/server.ts": SERVE,
  "https://esm.sh/@supabase/supabase-js@2.39.3": CLIENT,
  "https://esm.sh/@supabase/supabase-js@2": CLIENT,
};

let handler: EdgeHandler;
let db: FakeDb;
let asked: string[];
let gateway: (model: string) => Promise<Response>;

const toolReply = (rawArguments: string) =>
  new Response(JSON.stringify({
    choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ function: { name: "apply_search", arguments: rawArguments } }] } }],
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
  g.fetch = (url: string, init?: { body?: string }) => {
    if (String(url).includes("ai.gateway.lovable.dev")) {
      const model = String(JSON.parse(String(init?.body ?? "{}")).model);
      asked.push(model);
      return gateway(model);
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  };
  handler = await loadEdgeHandler("nl-search", STUBS);
}, 180_000);

beforeEach(() => {
  db = new FakeDb({});
  asked = [];
  db.rpcs.check_rate_limit = () => ({ data: true, error: null });
  (globalThis as Record<string, unknown>).__nlDb = db;
  vi.spyOn(console, "log").mockImplementation(() => undefined);
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

describe("an unreadable tool reply is not an empty one (NB-23)", () => {
  it("positive control: a readable reply binds its filter", async () => {
    gateway = async () => toolReply(JSON.stringify({ q: "nurse", workMode: "remote" }));
    const res = await ask("remote nurse jobs in the positive control");
    expect(res.status).toBe(200);
    expect((await res.json()).filters).toMatchObject({ q: "nurse", workMode: "remote" });
  });

  it("arguments that do not parse send the chain on, and past the last model the page gets 502, not an empty filter set", async () => {
    gateway = async () => toolReply("{ q: nurse, oops");
    const res = await ask("nurse jobs whose parse breaks");
    expect(asked.length, "the second model was never asked").toBeGreaterThan(1);
    expect(res.status, "an unreadable reply was answered as no filters").toBe(502);
    const body = await res.json();
    expect(body.filters).toBeUndefined();
  });

  it("an unreadable first reply and a readable second one: the second one's filters", async () => {
    let n = 0;
    gateway = async () => (n++ === 0 ? toolReply("not json at all") : toolReply(JSON.stringify({ q: "pharmacist" })));
    const res = await ask("pharmacist roles after one bad reply");
    expect(res.status).toBe(200);
    expect((await res.json()).filters).toMatchObject({ q: "pharmacist" });
  });

  it("an answer that binds nothing is sent, but the same sentence asked again goes to the model again", async () => {
    gateway = async () => toolReply(JSON.stringify({}));
    const first = await ask("something that maps to no filter at all");
    expect(first.status).toBe(200);
    expect((await first.json()).filters).toEqual({});
    const before = asked.length;
    gateway = async () => toolReply(JSON.stringify({ q: "barista" }));
    const second = await ask("something that maps to no filter at all");
    expect(asked.length, "the empty answer was remembered").toBeGreaterThan(before);
    expect((await second.json()).filters).toMatchObject({ q: "barista" });
  });
});

describe("the gateway's own text stays in the log (NB-24)", () => {
  it("a gateway refusal answers its status and a fixed reason, with no upstream body", async () => {
    gateway = async () => new Response("upstream says: org quota for workspace ws_12345 exhausted", { status: 429 });
    const res = await ask("remote nurse jobs while the gateway is busy");
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toMatchObject({ error: "Parse unavailable", reason: "busy" });
    expect(body.detail, "the gateway's text reached the caller").toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("ws_12345");
  });
});
