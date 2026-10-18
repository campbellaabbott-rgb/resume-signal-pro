// @vitest-environment node
/**
 * A GENERATION IN PROGRESS IS LEASED, AND A STALE MAKER IS REFUSED
 * (critical-path plan 2026-10-12, CP-019 and its review note; CP-C items 1-2).
 *
 * Three makers can work one paid order (the webhook, the success page's
 * verifier, the retry sweep) and nothing told them apart: a maker that
 * finished after the sweep had reclaimed its row still wrote the row and
 * mailed the buyer a second time. 20261011144000 gives the row a lease with
 * a token: take_delivery_lease hands it to one maker for ten minutes,
 * finish_delivery_generation and update_delivery_retry land only with the
 * row's current token while the lease is live, an expired lease is reclaimed
 * with a new token, and the success page's step writer releases the lease it
 * holds. Run against Postgres (pglite) with the live definitions and the
 * migration itself, self-check included, applied twice.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { liveDefinitionOf } from "./helpers/live-sql";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 180_000 });

const MIG = resolve(__dirname, "../../supabase/migrations");
const file = (prefix: string) => {
  const name = readdirSync(MIG).find((f) => f.startsWith(prefix));
  if (!name) throw new Error(`no migration starts with ${prefix}`);
  return readFileSync(resolve(MIG, name), "utf8");
};

let db: PGlite;
const SID = "cs_live_leasedorder";

const row = async (sid = SID) => (await db.query<Record<string, unknown>>(
  "SELECT id, status, retry_count, lease_token, lease_until, lease_until > now() AS live FROM public.product_deliveries WHERE stripe_session_id = $1", [sid])).rows[0];
const take = async (seen: string, sid = SID) => (await db.query<{ t: string | null }>(
  "SELECT public.take_delivery_lease($1, $2) AS t", [sid, seen])).rows[0].t;
const finish = async (token: string | null, status = "content_generated", sid = SID) => (await db.query<{ ok: boolean }>(
  "SELECT public.finish_delivery_generation($1, $2, $3) AS ok", [sid, token, status])).rows[0].ok;
const fail = async (id: unknown, error: string, token: string | null) => (await db.query<{ ok: boolean }>(
  "SELECT public.update_delivery_retry($1, 'generation_failed', $2, true, $3) AS ok", [id, error, token])).rows[0].ok;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.product_deliveries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(),
      stripe_session_id text NOT NULL, customer_email text, product_type text NOT NULL, product_name text, amount_cents integer,
      payment_completed_at timestamptz, content_generation_started_at timestamptz, content_generation_completed_at timestamptz,
      email_sent_at timestamptz, email_delivered_at timestamptz, status text NOT NULL DEFAULT 'payment_received',
      generation_success boolean, generation_error text, email_success boolean, email_error text,
      ai_response_valid boolean, ai_parse_error text, generation_duration_ms integer, ai_model_used text, metadata jsonb,
      retry_count integer NOT NULL DEFAULT 0, max_retries integer NOT NULL DEFAULT 8, next_retry_at timestamptz,
      last_retry_error text, transient_failures integer NOT NULL DEFAULT 0);
  `);
  // The writers as the database held them before this round, then the round's files.
  await db.exec(`CREATE OR REPLACE ${liveDefinitionOf("delivery_error_is_transient").body}\n$$;`);
  await db.exec(`CREATE OR REPLACE ${liveDefinitionOf("log_delivery_step").body}\n$$;`);
  await db.exec(file("20261009134100_"));
  await db.exec(file("20261011140000_"));
  await db.exec(file("20261011144000_"));
  // Safe twice: the self-check runs again on the same database.
  await db.exec(file("20261011144000_"));
}, 180_000);

afterAll(async () => { await db?.close(); });

beforeEach(async () => {
  await db.exec("TRUNCATE public.product_deliveries");
  await db.query("INSERT INTO public.product_deliveries (stripe_session_id, product_type, status, customer_email) VALUES ($1, 'cover_letter', 'payment_received', 'buyer@example.com')", [SID]);
});

describe("the catalogue after the migration", () => {
  it("keeps exactly one update_delivery_retry, the one that takes p_lease_token, and closes every lease function to the client roles", async () => {
    const { rows } = await db.query<{ proname: string; args: string }>(
      "SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('update_delivery_retry', 'take_delivery_lease', 'finish_delivery_generation', 'release_delivery_lease') ORDER BY 1");
    expect(rows).toEqual([
      { proname: "finish_delivery_generation", args: "p_stripe_session_id text, p_lease_token uuid, p_status text, p_duration_ms integer, p_model text" },
      { proname: "release_delivery_lease", args: "p_stripe_session_id text, p_lease_token uuid" },
      { proname: "take_delivery_lease", args: "p_stripe_session_id text, p_seen_status text, p_minutes integer, p_product_type text, p_email text" },
      { proname: "update_delivery_retry", args: "p_id uuid, p_status text, p_error text, p_increment_retry boolean, p_lease_token uuid" },
    ]);
    const priv = await db.query<{ fn: string; anon: boolean; auth: boolean; svc: boolean }>(`
      SELECT fn, has_function_privilege('anon', fn, 'EXECUTE') AS anon, has_function_privilege('authenticated', fn, 'EXECUTE') AS auth,
             has_function_privilege('service_role', fn, 'EXECUTE') AS svc
        FROM unnest(ARRAY['public.take_delivery_lease(text,text,integer,text,text)', 'public.finish_delivery_generation(text,uuid,text,integer,text)',
                          'public.release_delivery_lease(text,uuid)', 'public.update_delivery_retry(uuid,text,text,boolean,uuid)']) AS fn`);
    for (const p of priv.rows) expect(p, p.fn).toMatchObject({ anon: false, auth: false, svc: true });
  });
});

describe("one maker at a time", () => {
  it("the first maker takes the lease; a second is refused while it is live, whatever status it saw", async () => {
    const t1 = await take("payment_received");
    expect(t1).toMatch(/^[0-9a-f-]{36}$/);
    expect(await row()).toMatchObject({ status: "generating", lease_token: t1, live: true });
    expect(await take("payment_received"), "a maker that saw the old status took a live lease").toBeNull();
    expect(await take("generating"), "a second maker took a live lease").toBeNull();
  });

  it("only the holder's token finishes the order, once, and the finish releases the lease", async () => {
    const t1 = await take("payment_received");
    expect(await finish("11111111-1111-4111-8111-111111111111")).toBe(false);
    expect(await finish(null)).toBe(false);
    expect((await row()).status).toBe("generating");
    expect(await finish(t1)).toBe(true);
    expect(await row()).toMatchObject({ status: "content_generated", lease_token: null, lease_until: null });
    expect(await finish(t1), "a finished order was finished again").toBe(false);
  });

  it("the success page finishes as 'generated'; any other status is refused", async () => {
    const t1 = await take("payment_received");
    await expect(db.query("SELECT public.finish_delivery_generation($1, $2, 'delivered')", [SID, t1])).rejects.toThrow(/not a made-order status/);
    expect(await finish(t1, "generated")).toBe(true);
    expect((await row()).status).toBe("generated");
  });
});

describe("the reclaim and the stale maker", () => {
  it("an expired lease is reclaimed with a new token; the first maker's finish and failure are then refused and change nothing", async () => {
    const t1 = await take("payment_received");
    await db.query("UPDATE public.product_deliveries SET lease_until = now() - interval '1 minute' WHERE stripe_session_id = $1", [SID]);
    const t2 = await take("generating");
    expect(t2).toMatch(/^[0-9a-f-]{36}$/);
    expect(t2).not.toBe(t1);
    expect(await finish(t1), "the first maker finished an order the sweep had reclaimed").toBe(false);
    const { id } = await row();
    expect(await fail(id, "Generation failed: 500", t1), "the first maker's late failure landed").toBe(false);
    expect(await fail(id, "Generation failed: 500", null), "a tokenless failure landed on a held order").toBe(false);
    expect(await row()).toMatchObject({ status: "generating", retry_count: 0, lease_token: t2 });
    expect(await finish(t2)).toBe(true);
    expect((await row()).status).toBe("content_generated");
  });

  it("the holder's failure lands and releases the lease; a tokenless failure lands once nobody holds the row", async () => {
    const t1 = await take("payment_received");
    const { id } = await row();
    expect(await fail(id, "Generation failed: 400 - bad request", t1)).toBe(true);
    expect(await row()).toMatchObject({ status: "generation_failed", retry_count: 1, lease_token: null, lease_until: null });
    expect(await fail(id, "Generation failed: 400 - bad request", null), "the writers that never lease were refused").toBe(true);
    expect((await row()).retry_count).toBe(2);
    expect(await take("generation_failed"), "a failed order could not be leased for its next try").toMatch(/^[0-9a-f-]{36}$/);
  });

  it("a lease that expired but was never reclaimed still takes the first maker's finish (nobody else is on it)", async () => {
    const t1 = await take("payment_received");
    await db.query("UPDATE public.product_deliveries SET lease_until = now() - interval '1 minute' WHERE stripe_session_id = $1", [SID]);
    expect(await finish(t1)).toBe(true);
    expect((await row()).status).toBe("content_generated");
  });
});

describe("what is never leased, and what the page's step writer does", () => {
  it("a delivered, refunded or mailed order is never leased", async () => {
    await db.query("UPDATE public.product_deliveries SET status = 'delivered' WHERE stripe_session_id = $1", [SID]);
    expect(await take("delivered")).toBeNull();
    await db.query("UPDATE public.product_deliveries SET status = 'refunded' WHERE stripe_session_id = $1", [SID]);
    expect(await take("refunded")).toBeNull();
    await db.query("INSERT INTO public.product_deliveries (stripe_session_id, product_type, status, email_sent_at) VALUES ('cs_live_mailed', 'cover_letter', 'content_generated', now())");
    expect(await take("content_generated", "cs_live_mailed")).toBeNull();
  });

  it("a row nobody wrote is created by the maker that takes it", async () => {
    const t = (await db.query<{ t: string | null }>(
      "SELECT public.take_delivery_lease('cs_live_missing', 'payment_received', 10, 'cover_letter', 'buyer@example.com') AS t")).rows[0].t;
    expect(t).toMatch(/^[0-9a-f-]{36}$/);
    const r = (await db.query<Record<string, unknown>>("SELECT status, product_type, customer_email FROM public.product_deliveries WHERE stripe_session_id = 'cs_live_missing'")).rows[0];
    expect(r).toEqual({ status: "generating", product_type: "cover_letter", customer_email: "buyer@example.com" });
  });

  it("the page records a failure through log_delivery_step and gives the lease back by its token, and only by its token", async () => {
    const t1 = await take("payment_received");
    await db.query("SELECT public.log_delivery_step($1, 'generation_completed', false, 'the page could not make it')", [SID]);
    expect(await row()).toMatchObject({ status: "generation_failed", lease_token: t1, live: true });
    const release = async (token: string | null) => (await db.query<{ ok: boolean }>("SELECT public.release_delivery_lease($1, $2) AS ok", [SID, token])).rows[0].ok;
    expect(await release("22222222-2222-4222-8222-222222222222")).toBe(false);
    expect(await release(null)).toBe(false);
    expect((await row()).lease_token).toBe(t1);
    expect(await release(t1)).toBe(true);
    expect(await row()).toMatchObject({ status: "generation_failed", lease_token: null, lease_until: null });
    expect(await take("generation_failed"), "a released row could not be leased again").toMatch(/^[0-9a-f-]{36}$/);
  });

  it("a closed order stays closed under the lease writers too (20261011140000 holds)", async () => {
    const t1 = await take("payment_received");
    await db.query("UPDATE public.product_deliveries SET status = 'refunded' WHERE stripe_session_id = $1", [SID]);
    expect(await finish(t1)).toBe(false);
    expect((await row()).status).toBe("refunded");
  });
});
