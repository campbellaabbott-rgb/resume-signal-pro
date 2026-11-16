// @vitest-environment node
//
// Node, not jsdom: the handler is bundled with esbuild (helpers/edge-harness.ts).
/**
 * THE PRODUCT PREVIEW ENDPOINT IS RETIRED, AND NO PAGE ASKS IT (NB-10, owner: retire).
 *
 * Preview-before-pay wrote a free slice of a paid product's deliverable with
 * a model on the project's key, for any visitor who asked, behind a
 * per-address and a function-wide hour limit. No mounted page reached it: the
 * apply-kit panel showed it only to a member without Pro, who is offered
 * nothing since the Apply Assistant was retired, and the add-ons showcase that
 * also showed it is imported by no page.
 *
 * Held here, run and read:
 *   - every request, from a visitor, a signed-in member, our own servers or a
 *     warm-up ping, and a plain GET, is answered 410 retired with no count,
 *     read or model call;
 *   - the preflight still answers with its build, so the deploy is provable
 *     from outside, and still gives browsers two hours of leave;
 *   - the function imports nothing it could reach a model or the database
 *     with;
 *   - no file the site or another function ships names the endpoint.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { buildIsAtLeast } from "./helpers/fn-build";

const FN = "generate-product-preview";
const ROOT = resolve(__dirname, "../..");
const SERVE = "export function serve(h) { globalThis.__edgeHandler = h; }";
// The shipped build before the retirement read the spend gate and the
// database through these; recording them is what makes a call visible here.
const CLIENT =
  "export function createClient() { const t = globalThis.__previewTouches; return { rpc: async (n) => { t.push('rpc:' + n); return { data: true, error: null }; }, from: (x) => { t.push('from:' + x); const q = { select: () => q, eq: () => q, gte: () => q, insert: async () => ({ error: null }), maybeSingle: async () => ({ data: null, error: null }), single: async () => ({ data: null, error: null }) }; return q; }, auth: { getUser: async () => ({ data: { user: null }, error: null }) } }; }";
const STUBS: Record<string, string> = {
  "https://deno.land/std@0.168.0/http/server.ts": SERVE,
  "https://deno.land/std@0.190.0/http/server.ts": SERVE,
  "https://esm.sh/@supabase/supabase-js@2": CLIENT,
  "https://esm.sh/@supabase/supabase-js@2.39.3": CLIENT,
};
const SERVICE_KEY = "service-role-harness-key-0123456789abcdef";
const RESUME = "Jane Doe -- Senior software engineer with ten years of TypeScript, Postgres and payments work. Led a team of five. ".repeat(3);

const touches: string[] = [];
let handler: EdgeHandler;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = {
    SUPABASE_URL: "https://harness.supabase.co",
    SUPABASE_ANON_KEY: "anon_harness",
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    LOVABLE_API_KEY: "lovable_harness",
  };
  g.__previewTouches = touches;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.EdgeRuntime = { waitUntil: () => undefined };
  g.fetch = async (url: string) => {
    touches.push(`fetch:${String(url)}`);
    return new Response(JSON.stringify({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }] }), { status: 200 });
  };
  handler = await loadEdgeHandler(FN, STUBS);
}, 120_000);

beforeEach(() => {
  touches.length = 0;
});

const ask = (method: string, headers: Record<string, string>, body?: unknown) =>
  handler(new Request(`https://harness.supabase.co/functions/v1/${FN}`, {
    method,
    headers: { apikey: "anon_harness", "cf-connecting-ip": "198.51.100.4", ...(body ? { "content-type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  }));

describe("the product preview endpoint answers everyone 410 retired and does nothing", () => {
  const callers: Array<[string, string, Record<string, string>, unknown]> = [
    ["a visitor asking for a preview", "POST", { authorization: "Bearer anon_harness" }, { productId: "full_analysis", resumeText: RESUME }],
    ["a signed-in member asking for one with a posting", "POST", { authorization: "Bearer member.jwt.harness" }, { productId: "interview_coach", resumeText: RESUME, jobDescription: "Senior engineer, payments." }],
    ["our own servers", "POST", { authorization: `Bearer ${SERVICE_KEY}` }, { productId: "full_analysis", resumeText: RESUME }],
    ["a warm-up ping", "POST", { authorization: "Bearer anon_harness" }, { _warmup: true, timestamp: 1 }],
    ["a plain GET, the way the verifier asks", "GET", {}, undefined],
  ];
  for (const [who, method, headers, body] of callers) {
    it(`${who}: 410 retired, with no count, read or model call`, async () => {
      const res = await ask(method, headers, body);
      expect(res.status).toBe(410);
      const json = (await res.json()) as { error?: unknown; code?: unknown };
      expect(json.code).toBe("retired");
      expect(String(json.error)).toMatch(/retired/i);
      expect(json).not.toHaveProperty("preview");
      expect(touches).toEqual([]);
    });
  }

  it("the preflight still answers its build and two hours of leave, so the deploy is provable from outside", async () => {
    const res = await ask("OPTIONS", {});
    expect(res.status).toBe(200);
    expect(buildIsAtLeast(res.headers.get("x-fn-build"), FN, "2026-11-09"), String(res.headers.get("x-fn-build"))).toBe(true);
    expect(res.headers.get("access-control-max-age")).toBe("7200");
    expect(touches).toEqual([]);
  });
});

describe("nothing is left that could write a preview, or ask for one", () => {
  it("the function imports only the server: no shared module, no database client, no model", () => {
    const dir = resolve(ROOT, "supabase/functions", FN);
    expect(readdirSync(dir).sort()).toEqual(["index.ts"]);
    const imports = [...readFileSync(join(dir, "index.ts"), "utf8").matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
    expect(imports).toEqual(["https://deno.land/std@0.190.0/http/server.ts"]);
  });

  it("no file the site or another function ships names the endpoint", () => {
    const named: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (name === "node_modules" || p === resolve(ROOT, "src/test") || p === resolve(ROOT, "supabase/functions", FN)) continue;
          walk(p);
        } else if (/\.(ts|tsx|js|mjs)$/.test(name) && readFileSync(p, "utf8").includes(FN)) {
          named.push(relative(ROOT, p));
        }
      }
    };
    walk(resolve(ROOT, "src"));
    walk(resolve(ROOT, "supabase/functions"));
    expect(named).toEqual([]);
  });
});
