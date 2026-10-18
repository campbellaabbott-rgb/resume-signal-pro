// @vitest-environment node
/**
 * TWO MIGRATIONS OF THE PAYMENTS-DELIVERY ROUND, RUN IN A REAL POSTGRES (pglite).
 *
 * 20261011140000 (CP-019): every status write to product_deliveries was
 * unconditional, so a refunded order whose late failure write landed after the
 * refund went back on the retry queue, and a delivered order a slower writer
 * reported as failed was made and mailed again. A BEFORE UPDATE trigger now
 * keeps refunded, delivered and a mailed saved copy closed, under every writer.
 *
 * 20261011141000 (S12-154): a scan-credit purchase claimed by an account was
 * still spent, and counted, for whoever held its session id: on a shared
 * browser the next person spent the buyer's credits. A claimed purchase now
 * answers only its claimer, in the spender and in the balance.
 *
 * Each file's own DO-block self-check runs here too (a failure raises). The
 * functions they act on are the live definitions (helpers/live-sql.ts takes
 * the last migration that defines each), and the lane starts from Supabase's
 * default grants.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { liveDefinitionOf } from "./helpers/live-sql";
import { creditedEmailOf, grantFromStripe, reserveScanCredit, resolveCreditSessions, sessionHash, type CreditDb } from "../../supabase/functions/_shared/scan-credits";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const DIR = resolve(__dirname, "../../supabase/migrations");
const file = (stamp: string) => readFileSync(resolve(DIR, readdirSync(DIR).find((f) => f.startsWith(`${stamp}_`))!), "utf8");
/** A live definition, as a statement pglite can run. */
const def = (fn: string) => `CREATE OR REPLACE ${liveDefinitionOf(fn).body}\n$$;`;

const BASE = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
`;

const DELIVERIES = `
  CREATE TABLE public.product_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    stripe_session_id text NOT NULL, customer_email text, product_type text NOT NULL, product_name text, amount_cents integer,
    payment_completed_at timestamptz, content_generation_started_at timestamptz, content_generation_completed_at timestamptz,
    email_sent_at timestamptz, status text NOT NULL DEFAULT 'payment_received', generation_success boolean, generation_error text,
    email_success boolean, email_error text, ai_response_valid boolean, ai_parse_error text, generation_duration_ms integer,
    metadata jsonb, retry_count integer NOT NULL DEFAULT 0, max_retries integer NOT NULL DEFAULT 8,
    next_retry_at timestamptz, last_retry_error text, transient_failures integer NOT NULL DEFAULT 0,
    -- 20261011144000's lease, as the live database holds it: the live update_delivery_retry names these columns.
    lease_token uuid, lease_until timestamptz
  );
`;

let withTrigger: PGlite;
let withoutTrigger: PGlite;

async function deliveriesDb(applyTrigger: boolean): Promise<PGlite> {
  const pg = new PGlite();
  await pg.exec(BASE + DELIVERIES);
  for (const fn of ["delivery_error_is_transient", "update_delivery_retry", "log_delivery_step"]) await pg.exec(def(fn));
  if (applyTrigger) await pg.exec(`BEGIN;\n${file("20261011140000")}\nCOMMIT;`);
  return pg;
}

beforeAll(async () => {
  withTrigger = await deliveriesDb(true);
  withoutTrigger = await deliveriesDb(false);
}, 180_000);

afterAll(async () => { await withTrigger?.close(); await withoutTrigger?.close(); });

async function scenario(pg: PGlite, start: { status: string; email_sent_at?: string | null }, write: (id: string) => string) {
  const { rows } = await pg.query<{ id: string }>(
    "INSERT INTO public.product_deliveries (stripe_session_id, product_type, status, next_retry_at, email_sent_at) VALUES ($1, 'cover_letter', $2, 'infinity', $3) RETURNING id",
    [`cs_test_${Math.random().toString(36).slice(2)}`, start.status, start.email_sent_at ?? null],
  );
  const id = rows[0].id;
  await pg.exec(write(id));
  return (await pg.query<{ status: string; next_retry_at: string | null; last_retry_error: string | null }>(
    "SELECT status, next_retry_at::text, last_retry_error FROM public.product_deliveries WHERE id = $1", [id])).rows[0];
}

const lateFailure = (id: string) => `SELECT public.update_delivery_retry('${id}'::uuid, 'generation_failed', 'Generation failed: 400', true)`;
const lateMailFailure = (id: string) => `SELECT public.update_delivery_retry('${id}'::uuid, 'email_failed', 'send-product-email answered 502', true)`;
const plainUpdate = (status: string) => (id: string) => `UPDATE public.product_deliveries SET status = '${status}' WHERE id = '${id}'`;

describe("a closed paid order stays closed (20261011140000)", () => {
  it("without the trigger, a late failure reopens a refunded order: the defect this file closes", async () => {
    const r = await scenario(withoutTrigger, { status: "refunded" }, lateFailure);
    expect(r.status).toBe("generation_failed");
    expect(r.next_retry_at).not.toBe("infinity");
  });

  it("a refunded order is never reopened, by the retry writer or a plain update", async () => {
    for (const write of [lateFailure, lateMailFailure, plainUpdate("delivered"), plainUpdate("payment_received")]) {
      const r = await scenario(withTrigger, { status: "refunded" }, write);
      expect(r.status).toBe("refunded");
      expect(r.next_retry_at, "the refunded order was put back on the schedule").toBe("infinity");
    }
  });

  it("a delivered order moves only to refunded, and keeps the refused writer's message", async () => {
    const failed = await scenario(withTrigger, { status: "delivered" }, lateMailFailure);
    expect(failed.status).toBe("delivered");
    expect(failed.last_retry_error).toBe("send-product-email answered 502");
    expect((await scenario(withTrigger, { status: "delivered" }, plainUpdate("content_generated"))).status).toBe("delivered");
    expect((await scenario(withTrigger, { status: "delivered" }, (id) => `SELECT public.log_delivery_step((SELECT stripe_session_id FROM public.product_deliveries WHERE id = '${id}'), 'generation_completed', false, 'late')`)).status).toBe("delivered");
    expect((await scenario(withTrigger, { status: "delivered" }, plainUpdate("refunded"))).status).toBe("refunded");
  });

  it("a mailed saved copy is not sent back to generation; an unmailed one is", async () => {
    expect((await scenario(withTrigger, { status: "content_generated", email_sent_at: new Date().toISOString() }, lateFailure)).status).toBe("content_generated");
    expect((await scenario(withTrigger, { status: "content_generated", email_sent_at: null }, lateFailure)).status).toBe("generation_failed");
  });

  it("the open states still move", async () => {
    expect((await scenario(withTrigger, { status: "payment_received" }, lateMailFailure)).status).toBe("email_failed");
    expect((await scenario(withTrigger, { status: "email_failed" }, plainUpdate("delivered"))).status).toBe("delivered");
    expect((await scenario(withTrigger, { status: "generation_failed" }, plainUpdate("generating"))).status).toBe("generating");
  });

  it("the trigger function is closed to the client roles", async () => {
    const { rows } = await withTrigger.query<{ anon: boolean; auth: boolean }>(
      "SELECT has_function_privilege('anon', 'public.product_delivery_stays_closed()', 'EXECUTE') AS anon, has_function_privilege('authenticated', 'public.product_delivery_stays_closed()', 'EXECUTE') AS auth");
    expect(rows[0]).toEqual({ anon: false, auth: false });
  });
});

// ── 20261011141000 ─────────────────────────────────────────────────────────

let credits: PGlite;
const BUYER = "00000000-0000-4000-8000-0000000004b1";
const NEXT_PERSON = "00000000-0000-4000-8000-0000000004b2";

function creditDb(db: PGlite): CreditDb {
  const run = async (sql: string, params: unknown[]) => {
    try { return { data: (await db.query(sql, params)).rows, error: null }; } catch (e) { return { data: null, error: { message: String(e) } }; }
  };
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      const keys = Object.keys(args);
      const r = await run(`SELECT public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) AS v`, keys.map((k) => args[k]));
      return { data: r.error ? null : (r.data as Array<{ v: unknown }>)[0]?.v ?? null, error: r.error };
    },
    from: (table: string) => {
      let cols = "*";
      const q = {
        select: (c: string) => { cols = c; return q; },
        in: (col: string, vals: string[]) => run(`SELECT ${cols} FROM public.${table} WHERE ${col} = ANY($1)`, [vals]) as unknown as typeof q,
        then: undefined,
      };
      return q as never;
    },
  } as CreditDb;
}

beforeAll(async () => {
  credits = new PGlite();
  await credits.exec(BASE + `
    CREATE TABLE public.user_scan_credits (id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, email text NOT NULL UNIQUE,
      credits_remaining integer NOT NULL DEFAULT 0, total_credits_purchased integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE public.used_stripe_sessions (session_id text PRIMARY KEY, used_at timestamptz DEFAULT now(), ip_address text, product_type text);
    CREATE FUNCTION public.add_scan_credits(p_email text, p_credits integer) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
    BEGIN
      INSERT INTO public.user_scan_credits (email, credits_remaining, total_credits_purchased) VALUES (lower(trim(p_email)), p_credits, p_credits)
      ON CONFLICT (email) DO UPDATE SET credits_remaining = user_scan_credits.credits_remaining + p_credits,
        total_credits_purchased = user_scan_credits.total_credits_purchased + p_credits;
      RETURN true;
    END $$;
    CREATE FUNCTION public.use_scan_credit(p_email text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT false $$;
    CREATE FUNCTION public.get_scan_credits(p_email text) RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT 0 $$;
  `);
  await credits.exec(`BEGIN;\n${file("20261005120000")}\nCOMMIT;`);
  await credits.exec(`BEGIN;\n${file("20261011141000")}\nCOMMIT;`);
}, 180_000);

afterAll(async () => { await credits?.close(); });

describe("a pack bought with no address typed before Checkout is recorded under the address Stripe collected (S12-103)", () => {
  it("customer_details.email is the credited address, in the webhook's order", () => {
    const paid = { payment_status: "paid", mode: "payment", amount_total: 1000, metadata: { product_type: "scan_pack", credits: "10" } };
    expect(grantFromStripe({ ...paid, customer_email: null, customer_details: { email: " Typed@Example.com " } }), "the proof ignored the only address the session had")
      .toEqual({ email: "typed@example.com", productType: "scan_pack", credits: 10 });
    // buyerEmailOf's order: what the buyer typed into Checkout first.
    expect(creditedEmailOf({ ...paid, customer_email: "prefill@example.com", customer_details: { email: "typed@example.com" } })).toBe("typed@example.com");
    expect(creditedEmailOf({ ...paid, customer_email: null, metadata: { ...paid.metadata, customer_email: "meta@example.com" } })).toBe("meta@example.com");
  });
});

describe("a claimed credit purchase answers only its claimer (20261011141000, S12-154)", () => {
  it("leaves exactly one spender, with the caller's user id, closed to clients", async () => {
    const { rows } = await credits.query<{ sig: string }>("SELECT p.oid::regprocedure::text AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'scan_credit_redeem'");
    expect(rows.map((r) => r.sig)).toEqual(["scan_credit_redeem(text,text,uuid)"]);
    const { rows: acl } = await credits.query<{ a: boolean; b: boolean }>("SELECT has_function_privilege('anon', 'public.scan_credit_redeem(text,text,uuid)', 'EXECUTE') AS a, has_function_privilege('authenticated', 'public.scan_credit_redeem(text,text,uuid)', 'EXECUTE') AS b");
    expect(acl[0]).toEqual({ a: false, b: false });
  });

  it("on a shared browser the next person, holding the buyer's session id, sees and spends nothing of theirs", async () => {
    const db = creditDb(credits);
    const id = "cs_test_sharedbrowserpurchase01";
    const hash = await sessionHash(id);
    await credits.exec("SELECT public.add_scan_credits('buyer@example.com', 3)");
    await credits.query("INSERT INTO public.scan_credit_session_grants (session_hash, email, product_type, credits_bought, claimed_by) VALUES ($1, 'buyer@example.com', 'scan_pack', 3, $2)", [hash, BUYER]);
    // Signed out, then signed in as someone else: the stored id reaches nothing.
    for (const who of [null, NEXT_PERSON]) {
      expect(await resolveCreditSessions(db, [id], { stripeKey: "", claimFor: who }), "the next person was shown the buyer's purchase and address").toEqual([]);
      expect(await reserveScanCredit(db, { userId: who, provenEmail: null, sessionIds: [id] }, { stripeKey: "" })).toBeNull();
      const bal = await credits.query<{ v: number }>("SELECT public.scan_credit_balance(NULL, ARRAY[$1], $2::uuid) AS v", [hash, who]);
      expect(bal.rows[0].v).toBe(0);
    }
    // Even a caller that skips the module is refused by the database.
    const direct = await credits.query<{ v: boolean }>("SELECT public.scan_credit_redeem('buyer@example.com', $1, NULL) AS v", [hash]);
    expect(direct.rows[0].v).toBe(false);
    // The buyer, on any device.
    const hold = await reserveScanCredit(db, { userId: BUYER, provenEmail: null, sessionIds: [] }, { stripeKey: "" });
    expect(hold).toMatchObject({ via: "purchase", sessionHash: hash });
  });

  it("an unclaimed purchase still answers whoever holds its session id", async () => {
    const db = creditDb(credits);
    const id = "cs_test_unclaimedpurchase0001";
    const hash = await sessionHash(id);
    await credits.exec("SELECT public.add_scan_credits('bearer@example.com', 1)");
    await credits.query("INSERT INTO public.scan_credit_session_grants (session_hash, email, product_type, credits_bought) VALUES ($1, 'bearer@example.com', 'scan_pack', 1)", [hash]);
    expect(await reserveScanCredit(db, { userId: null, provenEmail: null, sessionIds: [id] }, { stripeKey: "" })).toMatchObject({ via: "purchase" });
  });
});
