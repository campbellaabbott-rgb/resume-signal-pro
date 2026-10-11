// @vitest-environment node
/**
 * THE APPLY BROKER GIVES NOTHING TO A CALLER WITHOUT THE WORKER SECRET (S11-052).
 *
 * apply-broker hands the worker a claimed packet: the applicant's email,
 * phone, address and a signed résumé URL. Its one gate is a constant-time
 * compare of the bearer with APPLY_WORKER_SECRET. The only test of the handler
 * always sent the right bearer, and the stop-button guards only grep for the
 * 401 text, so a refactor that bypassed the compare (mutation M19) left all 17
 * files green.
 *
 * The shipped handler runs here. claim, release and peek with no bearer, a
 * wrong one, a padded one, a prefix of the secret, and the secret itself
 * outside a Bearer header with junk around it are 401; with the secret unset
 * every call is 503. In none of them is a database client made, a table or
 * rpc read, or a URL signed. The positive control: the right bearer peeks.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

const SECRET = "worker_secret_for_the_harness_0123456789";
const env: Record<string, string | undefined> = {
  APPLY_WORKER_SECRET: SECRET, SUPABASE_URL: "https://h.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc",
};
type Touch = string;
let touched: Touch[] = [];
const g = globalThis as Record<string, unknown>;

// A client that records every use, answers empty, and signs nothing silently.
const CLIENT = `export function createClient() {
  const t = globalThis.__brokerTouched; t.push("createClient");
  const chain = (label) => new Proxy(function () {}, {
    get: (_x, p) => {
      if (p === "then") return (ok) => ok({ data: label === "rpc:agent_work_pending" ? { pending: 0, should_run: false } : null, error: null });
      if (typeof p === "symbol") return undefined;
      return (...a) => { t.push(label + "." + String(p)); return chain(label); };
    },
  });
  return {
    from: (table) => { t.push("from:" + table); return chain("from:" + table); },
    rpc: (name) => { t.push("rpc:" + name); return chain("rpc:" + name); },
    storage: { from: (b) => { t.push("storage:" + b); return { createSignedUrl: async () => { t.push("signed"); return { data: { signedUrl: "https://signed" }, error: null }; } }; } },
  };
}`;

let handler: EdgeHandler;
beforeAll(async () => {
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.fetch = async (u: string) => { touched.push(`fetch:${u}`); return new Response("{}"); };
  handler = await loadEdgeHandler("apply-broker", {
    "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/@supabase/supabase-js@2": CLIENT,
  });
}, 120_000);
beforeEach(() => { touched = []; g.__brokerTouched = touched; env.APPLY_WORKER_SECRET = SECRET; });

const call = async (action: string, authorization?: string) => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (authorization !== undefined) headers.authorization = authorization;
  const res = await handler(new Request("https://h.supabase.co/functions/v1/apply-broker", {
    method: "POST", headers, body: JSON.stringify({ action, worker_id: "w1", submission_id: "00000000-0000-4000-8000-000000000001", outcome: "submitted" }),
  }));
  return { status: res.status, body: await res.text() };
};

const BAD_BEARERS: Array<[string, string | undefined]> = [
  ["no authorization header", undefined],
  ["an empty bearer", "Bearer "],
  ["a wrong bearer", "Bearer not_the_worker_secret"],
  ["the secret padded to a longer token", `Bearer ${SECRET}${"0".repeat(32)}`],
  ["the secret padded with a second word", `Bearer ${SECRET} padding`],
  ["the secret with a byte appended", `Bearer ${SECRET}x`],
  ["a prefix of the secret", `Bearer ${SECRET.slice(0, -1)}`],
  ["the anon-style key", "Bearer eyJhbGciOiJIUzI1NiJ9.anon"],
];

describe("apply-broker refuses every caller that does not hold the worker secret", () => {
  for (const action of ["claim", "release", "peek"]) {
    for (const [what, auth] of BAD_BEARERS) {
      it(`${action} with ${what}: 401, and no table read, rpc or signed URL`, async () => {
        const r = await call(action, auth);
        expect(r.status, r.body).toBe(401);
        expect(r.body).not.toMatch(/email|phone|signedUrl|resume/i);
        expect(touched, "the handler reached the database or storage before refusing").toEqual([]);
      });
    }
  }

  it("with the secret unset, every call is 503 and touches nothing, even one bearing an empty secret", async () => {
    env.APPLY_WORKER_SECRET = undefined;
    for (const auth of [undefined, "Bearer ", `Bearer ${SECRET}`]) {
      const r = await call("claim", auth);
      expect(r.status).toBe(503);
    }
    env.APPLY_WORKER_SECRET = "";
    expect((await call("claim", "Bearer ")).status).toBe(503);
    expect(touched).toEqual([]);
  });

  it("positive control: the worker's own bearer reaches the database", async () => {
    const r = await call("peek", `Bearer ${SECRET}`);
    expect(r.status, r.body).toBe(200);
    expect(touched).toContain("rpc:agent_work_pending");
  });
});
