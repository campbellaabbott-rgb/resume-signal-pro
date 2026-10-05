// @vitest-environment node
/**
 * THE PAYMENTS WAVE'S TWO MIGRATIONS DO WHAT THEIR HEADERS SAY.
 *
 * Run against pglite with stand-ins for the schemas Supabase provides (vault,
 * net) -- not read for spellings.
 *
 * 20261005110000 (platform sweep L6-26 / register 2.04, and L6-27):
 *   - log_delivery_step CREATES the row a sale needs when the success page
 *     claims it first (the old INSERT omitted the NOT NULL product_type and
 *     failed, silently, for every such sale);
 *   - the retry selector leaves a payment_received row alone for its first
 *     ten minutes (the webhook may still be generating it) and still never
 *     picks a row whose next_retry_at is infinity.
 *
 * 20261005113000 (2026-10-04 completeness review): the reconcile cron sends
 * its vault key as x-reconcile-cron, the key check answers a boolean and is
 * closed to every client role, and the tick still stamps lastCronAt.
 */
import { describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const MIG = resolve(__dirname, "../../supabase/migrations");
const DELIVERY_SQL = readFileSync(resolve(MIG, "20261005110000_a_sale_the_success_page_claims_first_leaves_a_delivery_record.sql"), "utf8");
const RECONCILE_SQL = readFileSync(resolve(MIG, "20261005113000_the_payment_safety_net_answers_its_cron_and_nobody_else.sql"), "utf8");

const ROLES = "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;";

const DELIVERIES = `
  CREATE TABLE public.product_deliveries (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now(),
    stripe_session_id text NOT NULL,
    customer_email text,
    product_type text NOT NULL,
    product_name text,
    amount_cents integer,
    payment_completed_at timestamptz,
    content_generation_started_at timestamptz,
    content_generation_completed_at timestamptz,
    email_sent_at timestamptz,
    status text NOT NULL DEFAULT 'payment_received',
    generation_success boolean,
    generation_error text,
    email_success boolean,
    email_error text,
    ai_response_valid boolean,
    ai_parse_error text,
    generation_duration_ms integer,
    metadata jsonb,
    retry_count integer NOT NULL DEFAULT 0,
    max_retries integer NOT NULL DEFAULT 3,
    next_retry_at timestamptz,
    last_retry_error text
  );`;

describe("20261005110000: a sale the success page claims first leaves a delivery record", () => {
  it("log_delivery_step creates the row, with the product and the buyer, and the rest of its steps still apply", async () => {
    const db = new PGlite();
    await db.exec(ROLES + DELIVERIES);
    await db.exec(DELIVERY_SQL);
    await db.query("SELECT public.log_delivery_step($1, 'payment_received', true, NULL, NULL, $2::jsonb)", [
      "pro_grant-1", JSON.stringify({ product_type: "premium_package", email: "pro@example.com", product_name: "Premium", amount_cents: 0 }),
    ]);
    const { rows } = await db.query<{ product_type: string; customer_email: string; status: string; payment_completed_at: string | null }>(
      "SELECT product_type, customer_email, status, payment_completed_at FROM public.product_deliveries WHERE stripe_session_id = 'pro_grant-1'");
    expect(rows, "the success page's claim left no delivery record").toHaveLength(1);
    expect(rows[0]).toMatchObject({ product_type: "premium_package", customer_email: "pro@example.com", status: "payment_received" });
    expect(rows[0].payment_completed_at).not.toBeNull();

    await db.query("SELECT public.log_delivery_step('pro_grant-1', 'email_sent', false, 'mail down')");
    const after = await db.query<{ status: string }>("SELECT status FROM public.product_deliveries WHERE stripe_session_id = 'pro_grant-1'");
    expect(after.rows[0].status).toBe("email_failed");

    await db.query("SELECT public.log_delivery_step('cs_no_metadata', 'generation_started')");
    const bare = await db.query<{ product_type: string }>("SELECT product_type FROM public.product_deliveries WHERE stripe_session_id = 'cs_no_metadata'");
    expect(bare.rows[0].product_type, "a step with no metadata still creates its row").toBe("unknown");
  });

  it("the sweeper waits ten minutes for the webhook, and never picks a row it was told to leave", async () => {
    const db = new PGlite();
    await db.exec(ROLES + DELIVERIES);
    await db.exec(DELIVERY_SQL);
    await db.exec(`
      INSERT INTO public.product_deliveries (stripe_session_id, product_type, status, created_at) VALUES
        ('fresh_payment', 'cover_letter', 'payment_received', now() - interval '2 minutes'),
        ('old_payment', 'cover_letter', 'payment_received', now() - interval '11 minutes'),
        ('fresh_failure', 'cover_letter', 'generation_failed', now() - interval '1 minute');
      INSERT INTO public.product_deliveries (stripe_session_id, product_type, status, created_at, next_retry_at) VALUES
        ('analysis', 'full_analysis', 'payment_received', now() - interval '3 hours', 'infinity');
    `);
    const { rows } = await db.query<{ stripe_session_id: string }>("SELECT stripe_session_id FROM public.get_failed_deliveries_for_retry(10)");
    expect(rows.map((r) => r.stripe_session_id).sort()).toEqual(["fresh_failure", "old_payment"]);
  });

  it("both stay closed to every client role", async () => {
    const db = new PGlite();
    await db.exec(ROLES + DELIVERIES);
    await db.exec(DELIVERY_SQL);
    for (const sig of ["public.log_delivery_step(text,text,boolean,text,integer,jsonb)", "public.get_failed_deliveries_for_retry(integer)"]) {
      const { rows } = await db.query<{ anon: boolean; auth: boolean; svc: boolean }>(
        `SELECT has_function_privilege('anon', '${sig}', 'EXECUTE') AS anon,
                has_function_privilege('authenticated', '${sig}', 'EXECUTE') AS auth,
                has_function_privilege('service_role', '${sig}', 'EXECUTE') AS svc`);
      expect(rows[0], sig).toEqual({ anon: false, auth: false, svc: true });
    }
  });
});

const PLATFORM = `
  CREATE SCHEMA vault;
  CREATE TABLE vault.secrets (id serial PRIMARY KEY, name text UNIQUE, secret text);
  CREATE VIEW vault.decrypted_secrets AS SELECT id, name, secret AS decrypted_secret FROM vault.secrets;
  CREATE FUNCTION vault.create_secret(p_secret text, p_name text) RETURNS uuid LANGUAGE plpgsql AS $$
  BEGIN INSERT INTO vault.secrets (name, secret) VALUES (p_name, p_secret); RETURN gen_random_uuid(); END $$;
  CREATE SCHEMA net;
  CREATE TABLE net.calls (url text, headers jsonb, body jsonb);
  CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint LANGUAGE plpgsql AS $$
  BEGIN INSERT INTO net.calls VALUES (url, headers, body); RETURN 1; END $$;
  CREATE TABLE public.job_board_meta (k text PRIMARY KEY, v jsonb, updated_at timestamptz);
  CREATE FUNCTION public.reconcile_stripe_tick() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN END $$;
  REVOKE ALL ON FUNCTION public.reconcile_stripe_tick() FROM PUBLIC, anon, authenticated;
`;

describe("20261005113000: the payment safety net answers its cron and nobody else", () => {
  it("generates a key once, sends it from the tick, and still stamps lastCronAt", async () => {
    const db = new PGlite();
    await db.exec(ROLES + PLATFORM);
    await db.exec(RECONCILE_SQL);
    await db.exec(RECONCILE_SQL); // re-applying leaves the key alone
    const keys = await db.query<{ secret: string }>("SELECT secret FROM vault.secrets WHERE name = 'reconcile_cron_key'");
    expect(keys.rows).toHaveLength(1);
    const key = keys.rows[0].secret;
    expect(key.length).toBeGreaterThanOrEqual(32);

    await db.query("SELECT public.reconcile_stripe_tick()");
    const call = await db.query<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }>("SELECT url, headers, body FROM net.calls");
    expect(call.rows).toHaveLength(1);
    expect(call.rows[0].url).toMatch(/\/functions\/v1\/reconcile-stripe$/);
    expect(call.rows[0].headers["x-reconcile-cron"], "the cron does not identify itself").toBe(key);
    expect(call.rows[0].body).toEqual({ lookbackHours: 48 });
    const stamp = await db.query<{ v: { lastCronAt?: string } }>("SELECT v FROM public.job_board_meta WHERE k = 'reconcile_stripe_cron'");
    expect(stamp.rows[0]?.v?.lastCronAt).toBeTruthy();
  });

  it("the key check answers a boolean, refuses short and wrong keys, and is closed to clients", async () => {
    const db = new PGlite();
    await db.exec(ROLES + PLATFORM);
    await db.exec(RECONCILE_SQL);
    const key = (await db.query<{ secret: string }>("SELECT secret FROM vault.secrets WHERE name = 'reconcile_cron_key'")).rows[0].secret;
    const ask = async (k: string | null) =>
      (await db.query<{ ok: boolean }>("SELECT public.reconcile_cron_key_matches($1) AS ok", [k])).rows[0].ok;
    expect(await ask(key)).toBe(true);
    expect(await ask(key.slice(0, -1) + (key.endsWith("a") ? "b" : "a"))).toBe(false);
    expect(await ask("short")).toBe(false);
    expect(await ask(null)).toBe(false);
    const priv = await db.query<{ anon: boolean; auth: boolean; svc: boolean; tick_anon: boolean }>(
      `SELECT has_function_privilege('anon', 'public.reconcile_cron_key_matches(text)', 'EXECUTE') AS anon,
              has_function_privilege('authenticated', 'public.reconcile_cron_key_matches(text)', 'EXECUTE') AS auth,
              has_function_privilege('service_role', 'public.reconcile_cron_key_matches(text)', 'EXECUTE') AS svc,
              has_function_privilege('anon', 'public.reconcile_stripe_tick()', 'EXECUTE') AS tick_anon`);
    expect(priv.rows[0]).toEqual({ anon: false, auth: false, svc: true, tick_anon: false });
  });

  it("on a host with no vault the tick still fires, unkeyed (and the function refuses it), rather than failing", async () => {
    const db = new PGlite();
    await db.exec(ROLES + PLATFORM.replace(/CREATE SCHEMA vault;[\s\S]*?END \$\$;\n/, ""));
    await db.exec(RECONCILE_SQL);
    await db.query("SELECT public.reconcile_stripe_tick()");
    const call = await db.query<{ headers: Record<string, string> }>("SELECT headers FROM net.calls");
    expect(call.rows[0].headers["x-reconcile-cron"]).toBeUndefined();
    expect(call.rows[0].headers["Content-Type"]).toBe("application/json");
  });
});
