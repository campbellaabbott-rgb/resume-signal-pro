// @vitest-environment node
//
// Node, not jsdom: the handler is bundled with esbuild (helpers/edge-harness.ts).
/**
 * THE API DOOR BINDS A LOCAL CITY TO ITS COUNTRY, AND SAYS SO (S13-006).
 *
 * /v1/jobs builds its location filter from the same locationTerms and branch
 * builder as the board. On base, ?location=Wien OR-ed a plain "%Vienna%",
 * so Vienna VA and Vienna WV answered a search typed in German, as on the
 * board. Now the added English name reaches the filter bound to Austria, and
 * the explain=1 trace shows the name a caller can read ("Vienna", never
 * "Vienna@Austria") with the binding said beside it.
 *
 * Run against the shipped public-api handler with only its database faked.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

let handler: EdgeHandler;
let filters: Array<[string, unknown[]]>;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service_harness", SUPABASE_ANON_KEY: "anon_harness" };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (fn: unknown) => { g.__edgeHandler = fn; } };
  g.fetch = async () => new Response("{}", { status: 404 });
  handler = await loadEdgeHandler("public-api", {
    "https://esm.sh/@supabase/supabase-js@2.45.0": "export function createClient() { return globalThis.__v1LocDb; }",
  });
}, 120_000);

beforeEach(() => {
  filters = [];
  const chainFor = (table: string): unknown => {
    const chain: unknown = new Proxy({}, {
      get(_t, prop) {
        if (prop === "maybeSingle" || prop === "single") return () => Promise.resolve({ data: null, error: null });
        if (prop === "then") return (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(ok);
        return (...args: unknown[]) => { if (table === "job_board_postings") filters.push([String(prop), args]); return chain; };
      },
    });
    return chain;
  };
  (globalThis as Record<string, unknown>).__v1LocDb = {
    rpc: (name: string) => {
      const r = Promise.resolve(
        name === "api_key_check"
          ? { data: { is_allowed: true, deny_reason: "", api_key_id: "key-1", key_tier: "free", rate_limit: 60, rate_used: 1, quota_limit: 1000, quota_used: 1 }, error: null }
          : { data: null, error: null },
      );
      return Object.assign(r, { maybeSingle: () => r });
    },
    from: (table: string) => chainFor(table),
  };
});

const get = async (path: string) => {
  const res = await handler(new Request(`https://harness.supabase.co/functions/v1/public-api${path}`, { headers: { authorization: "Bearer rb_live_harness_key_0123456789" } }));
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Record<string, any> };
};
const ors = () => filters.filter(([m]) => m === "or").map(([, a]) => String(a[0]));

describe("/v1/jobs?location=", () => {
  it("Wien: the English name is bound to Austria in the filter, and the trace names it plainly with the binding", async () => {
    const { status, body } = await get("/v1/jobs?location=Wien&explain=1");
    expect(status).toBe(200);
    expect(ors()).toContain('and(location.ilike."%Vienna%",or(country.is.null,country.neq.US,location.ilike."%Austria%")),location.ilike."%Wien%"');
    expect(body.diagnostics.boundFilters.location).toEqual({ terms: ["Vienna", "Wien"], operator: "or", outsideUsUnlessNaming: { Vienna: "Austria" } });
    expect(JSON.stringify(body)).not.toContain("@");
  });

  it("Vienna, typed in English, is read as it always was: no binding, no note", async () => {
    const { body } = await get("/v1/jobs?location=Vienna&explain=1");
    expect(ors()).toContain('location.ilike."%Vienna%",location.ilike."%Wien%"');
    expect(body.diagnostics.boundFilters.location).toEqual({ terms: ["Vienna", "Wien"], operator: "or" });
  });

  it("muenchen, typed without the umlaut, binds both names", async () => {
    const { body } = await get("/v1/jobs?location=muenchen&explain=1");
    expect(body.diagnostics.boundFilters.location.outsideUsUnlessNaming).toEqual({ Munich: "Germany", "München": "Germany" });
    expect(body.diagnostics.boundFilters.location.terms).toEqual(["Munich", "München"]);
  });
});
