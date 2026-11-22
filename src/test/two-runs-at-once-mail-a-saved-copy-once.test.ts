// @vitest-environment node
/**
 * TWO RUNS AT ONCE MAIL A SAVED COPY ONCE (S10-077).
 *
 * WHAT WAS WRONG. retry-failed-deliveries runs on pg_cron, and also for any
 * visitor who POSTs to it (verify_jwt false, six an hour per address). Its
 * queue read, get_failed_deliveries_for_retry, claimed nothing: a plain
 * SELECT ... LIMIT. Generation is leased, so two runs no longer pay for two
 * generations, but an order whose copy is already saved and an order whose
 * mail failed are mailed with no lease. Two runs at once were both handed the
 * row and both mailed the buyer.
 *
 * WHAT HOLDS NOW, with the shipped sweep's handler run twice at once against
 * the selector as the repository's migrations leave it, in Postgres (pglite,
 * Supabase's default grants, row level security on, called as the service
 * role):
 *   - a made-but-never-mailed order is mailed once, not twice;
 *   - so is an order whose mail failed;
 *   - the row the first run was handed is held for twenty minutes, and once
 *     that has passed with nothing written (a run that died) the next run is
 *     handed it and mails it: the claim strands nothing;
 *   - one run alone still mails it, once;
 *   - the selector is an invoker, and closed to anon and authenticated.
 * pglite has one connection, so the two runs' reads reach Postgres one after
 * the other, as they would when the first commits first; the migration's own
 * self-check holds the same disjointness inside one transaction.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SUPABASE_DEFAULTS } from "./helpers/supabase-defaults";
import { sqlCodeOf } from "./helpers/live-sql";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const MIG = resolve(__dirname, "../../supabase/migrations");
const defines = (f: string) => /FUNCTION\s+public\.get_failed_deliveries_for_retry\s*\(/.test(sqlCodeOf(readFileSync(resolve(MIG, f), "utf8")));
/** Every file that defines the selector from its three-argument form on, in order: what the database holds. */
const SELECTOR_FILES = readdirSync(MIG).filter((f) => f.endsWith(".sql") && f >= "20261011143000").sort().filter(defines);

const SERVICE = "service_role_harness_key_0123456789abcdef";
const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: "anon_harness" };

let pg: PGlite;
let db: FakeDb;
let sweep: EdgeHandler;
/** Every mail the sweep asked send-product-email for, by the order it names. */
let mailed: string[] = [];
const realFetch = globalThis.fetch;

beforeAll(async () => {
  expect(SELECTOR_FILES[0], "the three-argument selector's migration was not found").toMatch(/^20261011143000_/);
  pg = new PGlite();
  await pg.exec(`
    ${SUPABASE_DEFAULTS}
    CREATE TABLE public.product_deliveries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(),
      stripe_session_id text NOT NULL UNIQUE, customer_email text, product_type text NOT NULL, product_name text,
      content_generation_started_at timestamptz, content_generation_completed_at timestamptz, email_sent_at timestamptz,
      status text NOT NULL DEFAULT 'payment_received', generation_success boolean, generation_error text, email_success boolean,
      email_error text, metadata jsonb, retry_count integer NOT NULL DEFAULT 0, max_retries integer NOT NULL DEFAULT 8,
      next_retry_at timestamptz, last_retry_error text);
    ALTER TABLE public.product_deliveries ENABLE ROW LEVEL SECURITY;
  `);
  for (const f of SELECTOR_FILES) await pg.exec(readFileSync(resolve(MIG, f), "utf8"));
  // The sweep reaches Postgres with the service-role key, so its reads run as service_role.
  await pg.exec("SET ROLE service_role");

  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.__claimDb = () => db;
  g.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/functions/v1/send-product-email")) {
      mailed.push(String(JSON.parse(String(init?.body ?? "{}")).sessionId));
      return new Response("{}", { status: 200 });
    }
    return new Response("{}", { status: 500 });
  };
  sweep = await loadEdgeHandler("retry-failed-deliveries", {
    "https://deno.land/std@0.190.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/@supabase/supabase-js@2": "export const createClient = () => globalThis.__claimDb();",
  });
}, 180_000);

afterAll(async () => {
  (globalThis as Record<string, unknown>).fetch = realFetch;
  await pg?.close();
});

beforeEach(async () => {
  mailed = [];
  await pg.exec("TRUNCATE public.product_deliveries");
  db = new FakeDb();
  db.rpcs.check_rate_limit = () => ({ data: true, error: null });
  // The queue read is the database's own function.
  db.rpcs.get_failed_deliveries_for_retry = async (a) => {
    try {
      const { rows } = await pg.query(
        "SELECT * FROM public.get_failed_deliveries_for_retry($1::integer, $2::boolean, $3::boolean)",
        [a.p_limit ?? 10, a.p_include_generating ?? false, a.p_include_unmailed ?? false],
      );
      return { data: rows, error: null };
    } catch (e) {
      return { data: null, error: { message: (e as Error).message } };
    }
  };
  db.rpcs.get_purchased_content_by_session = (a) => ({
    data: [{ product_type: "cover_letter", generated_content: { coverLetter: `Dear Hiring Manager (${String(a.p_session_id)})` } }],
    error: null,
  });
  db.rpcs.update_delivery_retry = () => ({ data: true, error: null });
  for (const k of ["log", "warn", "error"] as const) vi.spyOn(console, k).mockImplementation(() => undefined);
});

/** An order the success page or the webhook made and saved, whose mail never left, made 20 minutes ago. */
const madeNeverMailed = (sid: string) => pg.query(
  `INSERT INTO public.product_deliveries (stripe_session_id, product_type, product_name, customer_email, status, created_at, content_generation_completed_at, metadata)
   VALUES ($1, 'cover_letter', 'Cover Letter', 'buyer@example.com', 'content_generated', now() - interval '1 hour', now() - interval '20 minutes', '{"language":"en"}')`, [sid]);
/** An order made and saved whose mail the provider refused. */
const mailFailed = (sid: string) => pg.query(
  `INSERT INTO public.product_deliveries (stripe_session_id, product_type, product_name, customer_email, status, created_at, content_generation_completed_at, metadata)
   VALUES ($1, 'cover_letter', 'Cover Letter', 'buyer@example.com', 'email_failed', now() - interval '1 hour', now() - interval '50 minutes', '{"language":"en"}')`, [sid]);

const run = () => sweep(new Request("https://harness.supabase.co/functions/v1/retry-failed-deliveries", {
  method: "POST", headers: { "content-type": "application/json" }, body: "{}",
}));

describe("two runs at once, the cron's and a visitor's", () => {
  it("mail a made-but-never-mailed order once", async () => {
    await madeNeverMailed("cs_live_savedcopy_once");
    const answers = await Promise.all([run(), run()]);
    expect(answers.map((r) => r.status)).toEqual([200, 200]);
    expect(mailed, "both runs were handed the saved copy and both mailed the buyer").toEqual(["cs_live_savedcopy_once"]);
  });

  it("mail an order whose mail failed once", async () => {
    await mailFailed("cs_live_resend_once");
    await Promise.all([run(), run()]);
    expect(mailed, "both runs resent the failed mail").toEqual(["cs_live_resend_once"]);
  });
});

describe("the claim strands nothing", () => {
  it("the row a run was handed is held for twenty minutes, and handed again once they have passed with nothing written", async () => {
    await madeNeverMailed("cs_live_dead_run");
    // A run that read the queue and died before it wrote anything.
    const first = await pg.query<{ stripe_session_id: string }>("SELECT stripe_session_id FROM public.get_failed_deliveries_for_retry(2, true, true)");
    expect(first.rows.map((r) => r.stripe_session_id)).toEqual(["cs_live_dead_run"]);
    const held = await pg.query<{ minutes: number }>(
      "SELECT round(extract(epoch FROM next_retry_at - now()) / 60)::int AS minutes FROM public.product_deliveries WHERE stripe_session_id = 'cs_live_dead_run'");
    expect(held.rows[0].minutes, "the row handed out carries no claim").toBe(20);
    await run();
    expect(mailed, "a run inside the twenty minutes was handed a row another run holds").toEqual([]);
    await pg.query("UPDATE public.product_deliveries SET next_retry_at = now() - interval '1 minute' WHERE stripe_session_id = 'cs_live_dead_run'");
    await run();
    expect(mailed, "a lapsed claim stranded the order").toEqual(["cs_live_dead_run"]);
  });

  it("one run alone mails the saved copy, once", async () => {
    await madeNeverMailed("cs_live_one_run");
    await run();
    expect(mailed).toEqual(["cs_live_one_run"]);
  });
});

describe("the selector", () => {
  it("is an invoker, closed to anon and authenticated by name, and open to the service role", async () => {
    const { rows } = await pg.query<{ definer: boolean; anon: boolean; auth: boolean; svc: boolean }>(`
      SELECT p.prosecdef AS definer,
             has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
             has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc
        FROM pg_proc p WHERE p.oid = 'public.get_failed_deliveries_for_retry(integer,boolean,boolean)'::regprocedure`);
    expect(rows[0]).toEqual({ definer: false, anon: false, auth: false, svc: true });
  });
});
