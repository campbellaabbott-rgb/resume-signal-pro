/**
 * resume-match's shipped index.ts, bundled with only its sockets stubbed
 * (helpers/edge-harness.ts), talking to a real Postgres that holds the match
 * migrations (db.ts) through the pglite PostgREST client. What answers is the
 * code that deploys.
 */
import type { PGlite } from "@electric-sql/pglite";
import { loadEdgeHandler, type EdgeHandler } from "../../helpers/edge-harness";
import { PgSupabase } from "../../helpers/pglite-supabase";

export const SERVICE_KEY = "service_harness_key_0123456789abcdef0123456789";
export const ANON_KEY = "anon_harness_key";

export interface Endpoint {
  handler: EdgeHandler;
  client: PgSupabase;
  logs: string[];
  post(body: unknown, opts?: { ip?: string; service?: boolean }): Promise<{ status: number; body: any; headers: Headers; text: string }>;
}

export async function bootEndpoint(db: PGlite, env: Record<string, string> = {}): Promise<Endpoint> {
  const g = globalThis as Record<string, unknown>;
  const vars: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, SUPABASE_ANON_KEY: ANON_KEY, ...env };
  g.Deno = { env: { get: (k: string) => vars[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  const client = new PgSupabase(db);
  g.__matchClient = client;
  const logs: string[] = [];
  const handler = await loadEdgeHandler("resume-match", {
    "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return globalThis.__matchClient; }",
  });
  const realLog = console.log;
  const post: Endpoint["post"] = async (body, opts = {}) => {
    const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": opts.ip ?? "203.0.113.9" };
    headers.authorization = `Bearer ${opts.service ? SERVICE_KEY : ANON_KEY}`;
    headers.apikey = ANON_KEY;
    console.log = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };
    try {
      const res = await handler(new Request("https://harness.supabase.co/functions/v1/resume-match", { method: "POST", headers, body: JSON.stringify(body) }));
      const text = await res.text();
      let parsed: unknown = null;
      try { parsed = JSON.parse(text); } catch { /* not json */ }
      return { status: res.status, body: parsed, headers: res.headers, text };
    } finally {
      console.log = realLog;
    }
  };
  return { handler, client, logs, post };
}

/** A site profile a confirmed strip would send. */
export const columbusCashier = (over: Record<string, unknown> = {}) => ({
  action: "match",
  profile: {
    roles: ["Cashier"],
    home: { city: "Columbus", region: "OH", country: "US" },
    canWorkIn: ["US"],
    relocate: "none",
    remote: false,
    radiusKm: 40,
    level: "entry",
    years: { low: 1, high: 2 },
    ...over,
  },
});
