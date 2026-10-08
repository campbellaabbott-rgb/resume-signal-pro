// @vitest-environment node
/**
 * AN OWNER'S DASHBOARD WHOSE PREFLIGHT REFUSES ITS KEY CAN NEVER LOAD (wave 2
 * email-ops, register L1-03).
 *
 * WHAT WAS WRONG. /analytics and /errors send the owner's key as x-admin-key
 * (adminAuthHeaders) to get-analytics and get-error-telemetry, whose CORS
 * preflight allowed only "authorization, x-client-info, apikey, content-type".
 * The browser refused every request before it left (FunctionsFetchError), and
 * without the header the function answers 401: both dashboards were dead
 * whatever key was entered. company-claim had the same defect until PR #13.
 *
 * WHAT HOLDS NOW: every function a page calls with adminAuthHeaders() is
 * found in the source, its SHIPPED handler is run, and its preflight must
 * allow x-admin-key; the two dashboards' functions then answer the key and
 * refuse a wrong one.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { ProxyDb } from "./helpers/proxy-db";
import { codeOf } from "./helpers/strip-comments";

const ROOT = resolve(__dirname, "../..");
const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { if (e !== "test") walk(p, out); } else if (/\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
};

/** Functions invoked with the owner's key header, by name, from the frontend's code. */
const KEYED = (() => {
  const found = new Set<string>(["admin-ops"]); // adminRpc() sends it to admin-ops
  for (const p of walk(resolve(ROOT, "src"))) {
    const code = codeOf(readFileSync(p, "utf8"));
    for (const m of code.matchAll(/functions\.invoke\(\s*['"`]([\w-]+)['"`]/g)) {
      // The call's own arguments: up to the statement's end.
      const call = code.slice(m.index!, code.indexOf(");", m.index!));
      if (/headers:\s*adminAuthHeaders\(\)/.test(call)) found.add(m[1]);
    }
  }
  return [...found].sort();
})();

const STUBS: Record<string, string> = {
  "https://deno.land/std@0.168.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
  "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
  "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return globalThis.__keyedDb; }",
  "https://esm.sh/@supabase/supabase-js@2.39.3": "export function createClient() { return globalThis.__keyedDb; }",
  "https://esm.sh/resend@2.0.0": "export class Resend { constructor() { this.emails = { send: async () => ({ data: {}, error: null }) }; } }",
};
const ADMIN = "admin-key-harness-0123456789";
const handlers: Record<string, EdgeHandler> = {};

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => ({ SUPABASE_URL: "https://h.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc", ADMIN_API_KEY: ADMIN } as Record<string, string>)[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.__keyedDb = new ProxyDb();
  for (const fn of KEYED) handlers[fn] = await loadEdgeHandler(fn, STUBS);
}, 180_000);

describe("every function a page sends the owner's key to lets the browser send it", () => {
  it("finds the keyed callers, the two dashboards among them", () => {
    expect(KEYED).toEqual(expect.arrayContaining(["admin-ops", "company-claim", "get-analytics", "get-error-telemetry", "scan-heartbeat"]));
  });

  it("each shipped preflight allows x-admin-key", async () => {
    const refused: string[] = [];
    for (const fn of KEYED) {
      const res = await handlers[fn](new Request(`https://h.supabase.co/functions/v1/${fn}`, { method: "OPTIONS" }));
      const allowed = (res.headers.get("access-control-allow-headers") ?? "").split(",").map((h) => h.trim().toLowerCase());
      if (!allowed.includes("x-admin-key")) refused.push(fn);
    }
    expect(refused, "the browser refuses these requests before they leave").toEqual([]);
  });

  it("the two dashboards' functions answer the key and refuse a wrong one", async () => {
    for (const fn of ["get-analytics", "get-error-telemetry"]) {
      const call = (key: string) => handlers[fn](new Request(`https://h.supabase.co/functions/v1/${fn}`, {
        method: "POST", headers: { "content-type": "application/json", "x-admin-key": key },
        body: JSON.stringify({ startDate: "2026-10-01T00:00:00Z", endDate: "2026-10-07T00:00:00Z", sinceIso: "2026-10-01T00:00:00Z", limit: 10 }),
      }));
      expect((await call("wrong")).status, fn).toBe(401);
      expect((await call(ADMIN)).status, fn).not.toBe(401);
    }
  });
});
