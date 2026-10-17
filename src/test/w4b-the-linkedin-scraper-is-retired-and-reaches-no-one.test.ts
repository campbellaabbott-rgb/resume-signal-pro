// @vitest-environment node
/**
 * THE LINKEDIN SCRAPER IS RETIRED, AND REACHES NO ONE (S12-152).
 *
 * scrape-linkedin had no caller on the site, but it was a live,
 * unauthenticated Firecrawl proxy on the project's key: its limits read a
 * forwarded hop the caller writes and failed open, and a caller rotating
 * through an IPv6 /64 bought a fresh allowance each time. The LinkedIn
 * insights it fed are among the free report extras the owner stopped
 * offering (2026-10-12).
 *
 * Run as shipped: every request, the preflight included, is answered 410
 * with the build stamp, and no request leaves the function (no Firecrawl, no
 * database, no LinkedIn).
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

const SERVE = "export function serve(h) { globalThis.__edgeHandler = h; }";
const outbound = vi.fn(async () => new Response("{}", { status: 200 }));
let handler: EdgeHandler;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: () => "set" } };
  g.fetch = outbound;
  handler = await loadEdgeHandler("scrape-linkedin", { "https://deno.land/std@0.168.0/http/server.ts": SERVE });
}, 120_000);

const call = (method: string, body?: unknown, headers: Record<string, string> = {}) => handler(new Request("https://harness.supabase.co/functions/v1/scrape-linkedin", {
  method,
  headers: { "content-type": "application/json", ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}));

describe("scrape-linkedin", () => {
  it("answers a profile request 410 retired, with its build, and fetches nothing", async () => {
    const res = await call("POST", { url: "https://www.linkedin.com/in/someone" }, { "x-forwarded-for": "2001:db8::1" });
    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({ code: "retired" });
    expect(res.headers.get("x-fn-build")).toBe("scrape-linkedin.2026-10-11.24");
    expect(res.headers.get("access-control-expose-headers")).toMatch(/x-fn-build/);
    expect(outbound).not.toHaveBeenCalled();
  });

  it("answers a body that is not JSON the same way: it reads no body at all", async () => {
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/scrape-linkedin", { method: "POST", body: "not json" }));
    expect(res.status).toBe(410);
    expect(outbound).not.toHaveBeenCalled();
  });

  it("the preflight is answered with the build, so a deploy is provable without a call to anyone", async () => {
    const res = await call("OPTIONS");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-fn-build")).toBe("scrape-linkedin.2026-10-11.24");
    expect(outbound).not.toHaveBeenCalled();
  });
});
