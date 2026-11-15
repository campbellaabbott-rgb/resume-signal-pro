// @vitest-environment node
//
// Node, not jsdom: the handlers are bundled with esbuild (helpers/edge-harness.ts).
/**
 * A BROWSER ASKS THE SCANNERS' PREFLIGHT ONCE IN TWO HOURS (cost audit
 * 2026-11-08, Do first #10; free-keyword-scan 2026-11-09.1,
 * free-keyword-scan-stream 2026-11-10.2).
 *
 * No function set Access-Control-Max-Age, so a browser cached each preflight
 * for its five-second default: a scan made more than five seconds after the
 * last one paid a round trip first, and the preflight ran the function (each
 * OPTIONS is an invocation). The two scanners now let a browser keep the
 * preflight for 7200 seconds, Chrome's ceiling.
 *
 * Run against the shipped handlers: the preflight carries the header beside
 * everything it carried before, and an ordinary answer (here a refused empty
 * résumé, which reaches no model) keeps its own headers.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 240_000 });

const handlers: Record<string, EdgeHandler> = {};

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "srk", SUPABASE_ANON_KEY: "anon_harness", LOVABLE_API_KEY: "lov" };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.EdgeRuntime = { waitUntil: () => undefined };
  g.fetch = async () => { throw new Error("no network in this test"); };
  handlers["free-keyword-scan"] = await loadEdgeHandler("free-keyword-scan", {
    "_shared/supabase-client.ts": "export const getServiceClient = () => null;",
  });
  handlers["free-keyword-scan-stream"] = await loadEdgeHandler("free-keyword-scan-stream", {
    "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return {}; }",
  });
}, 240_000);

describe.each(["free-keyword-scan", "free-keyword-scan-stream"])("%s", (fn) => {
  it("its preflight may be cached for two hours, and still names its origin rule, its headers and its build", async () => {
    const res = await handlers[fn](new Request(`https://harness.supabase.co/functions/v1/${fn}`, {
      method: "OPTIONS",
      headers: { origin: "https://resumebooster.work", "access-control-request-method": "POST", "access-control-request-headers": "authorization,apikey,content-type" },
    }));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-max-age")).toBe("7200");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-headers")).toBe("authorization, x-client-info, apikey, content-type");
    expect(res.headers.get("x-fn-build")).toMatch(new RegExp(`^${fn}\\.2026-\\d{2}-\\d{2}\\.\\d+$`));
  });

  it("an ordinary answer keeps its own headers beside it", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await handlers[fn](new Request(`https://harness.supabase.co/functions/v1/${fn}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer anon_harness", "cf-connecting-ip": "198.51.100.45", "cf-ipcountry": "US" },
      body: JSON.stringify({ resumeText: "" }),
    }));
    // The primary refuses it with a 400; the backup answers its event stream,
    // whose first event is the refusal.
    expect(res.status).toBe(fn === "free-keyword-scan" ? 400 : 200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("content-type")).toMatch(fn === "free-keyword-scan" ? /application\/json/ : /text\/event-stream/);
    await res.text();
    expect(res.headers.get("x-fn-build")).toMatch(new RegExp(`^${fn}\\.`));
    expect(res.headers.get("access-control-max-age")).toBe("7200");
    vi.restoreAllMocks();
  });
});
