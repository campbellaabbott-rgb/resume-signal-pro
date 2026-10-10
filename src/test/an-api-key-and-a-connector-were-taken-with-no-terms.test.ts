// @vitest-environment node
//
// Node, not jsdom: the handler is bundled with esbuild and the migration runs
// in pglite. The two pages' lines are mounted in
// an-api-key-and-a-connector-were-taken-with-no-terms-on-screen.test.tsx.
/**
 * AN API KEY AND A CONNECTOR WERE TAKEN WITH NO TERMS (commercial-readiness
 * plan 2026-10-08, item 12).
 *
 * The free data API key form and the connector's consent page carried no
 * "By continuing you agree to the Terms" line, and a key request recorded no
 * Terms. The form now sends the version its line showed; api-key-request
 * writes it on the request row the emailed link redeems (20261009132000).
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { buildIsAtLeast } from "./helpers/fn-build";
import { TERMS_VERSION } from "@/config/terms";

const db = new FakeDb();
let handler: EdgeHandler;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service_harness_0123456789abcdef0123456789", RESEND_API_KEY: "re_harness" };
  g.__termsDb = db;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.fetch = async (url: string) => {
    if (String(url).startsWith("https://api.resend.com/")) return new Response("{}", { status: 200 });
    throw new Error(`unexpected fetch ${url}`);
  };
  handler = await loadEdgeHandler("api-key-request", {
    "https://esm.sh/@supabase/supabase-js@2.45.0": "export const createClient = () => globalThis.__termsDb;",
  });
}, 60_000);

afterEach(() => { db.tables = {}; db.rpcs = {}; });

const post = (body: unknown) => handler(new Request("https://harness.supabase.co/functions/v1/api-key-request", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
}));

/** The RPC opens the request row the way the SQL does: keyed on the token hash. */
function openRequests() {
  db.rpcs.api_key_request_open = (a) => {
    db.rows("api_key_requests").push({ email: a.p_email, token_hash: a.p_token_hash, terms_version: null });
    return { data: { rq_send: true, rq_reason: "sent", rq_live_keys: 0 }, error: null };
  };
}

describe("a key request keeps the Terms it was shown", () => {
  it("writes the version the page sent on the request row its link redeems", async () => {
    openRequests();
    const res = await post({ email: "dev@example.org", name: "", termsVersion: TERMS_VERSION });
    expect(res.status).toBe(200);
    expect(db.rows("api_key_requests")).toEqual([expect.objectContaining({ email: "dev@example.org", terms_version: TERMS_VERSION })]);
    expect(buildIsAtLeast(res.headers.get("x-fn-build"), "api-key-request", "2026-10-09"), String(res.headers.get("x-fn-build"))).toBe(true);
  });

  it("records nothing for a version it does not know, and still takes the request", async () => {
    openRequests();
    const res = await post({ email: "dev@example.org", name: "", termsVersion: "1999-01-01" });
    expect(res.status).toBe(200);
    expect(db.rows("api_key_requests")[0].terms_version).toBeNull();
  });
});

describe("the migration", () => {
  it("adds a version column to a closed table, refuses a value that is not a date, and runs twice", async () => {
    const pg = new PGlite();
    await pg.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE public.api_key_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, token_hash text NOT NULL UNIQUE);
      ALTER TABLE public.api_key_requests ENABLE ROW LEVEL SECURITY;
      REVOKE ALL ON TABLE public.api_key_requests FROM PUBLIC, anon, authenticated;
      GRANT ALL ON TABLE public.api_key_requests TO service_role;`);
    const sql = readFileSync(resolve(__dirname, "../../supabase/migrations/20261009132000_an_api_key_request_keeps_the_terms_it_was_shown.sql"), "utf8");
    await pg.exec(sql);
    await pg.exec(sql);
    await pg.exec(`INSERT INTO public.api_key_requests (email, token_hash, terms_version) VALUES ('a@b.co', 'h1', '${TERMS_VERSION}')`);
    await expect(pg.exec("INSERT INTO public.api_key_requests (email, token_hash, terms_version) VALUES ('a@b.co', 'h2', 'yes')")).rejects.toThrow(/terms_version_is_a_date/);
    // The self-check refuses a table a client role can read.
    await pg.exec("GRANT SELECT ON public.api_key_requests TO anon");
    await expect(pg.exec(sql)).rejects.toThrow(/readable by a client role/);
    await pg.close();
  }, 60_000);
});
