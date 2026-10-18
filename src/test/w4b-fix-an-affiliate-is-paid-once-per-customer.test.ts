// @vitest-environment node
/**
 * AN AFFILIATE IS PAID ONCE PER CUSTOMER, NEVER FOR THEMSELVES, AND A
 * DISPUTED PAYMENT TAKES THE COMMISSION BACK (migration 20261011211000;
 * wave 4 round 2 review, money lens).
 *
 * WHAT WAS WRONG. The owner decided "a flat $10 on a referred customer's
 * first paid Pro month". The code paid $10 on every referred Pro checkout
 * (subscribe, cancel, re-subscribe paid again; a lapsed subscriber returning
 * through a link paid again; an affiliate could refer themselves) and never
 * took it back on a dispute.
 *
 * WHAT HOLDS NOW (run, not read: the file applied twice to pglite from
 * Supabase's default grants):
 *   - a new customer's first Pro month earns the $10, once, on the balance;
 *   - the same customer again (by account or by address) records 0;
 *   - a buyer whose address is the affiliate's own records 0;
 *   - a dispute rejects a pending conversion and takes it off the balance; a
 *     paid one stays paid;
 *   - still one overload, a definer closed to the client roles.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const DIR = resolve(__dirname, "../../supabase/migrations");
const MIG = readFileSync(resolve(DIR, readdirSync(DIR).find((n) => n.startsWith("20261011211000_"))!), "utf8");

const STAND_INS = `
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE TABLE public.affiliates (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE, password_hash text NOT NULL,
    referral_code text NOT NULL UNIQUE, commission_amount integer NOT NULL DEFAULT 500, status text NOT NULL DEFAULT 'active',
    total_earnings integer NOT NULL DEFAULT 0, pending_payout integer NOT NULL DEFAULT 0, paid_out integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.affiliate_conversions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), affiliate_id uuid NOT NULL REFERENCES public.affiliates(id) ON DELETE CASCADE,
    stripe_session_id text NOT NULL UNIQUE, product_name text, sale_amount integer NOT NULL, commission_amount integer NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid', 'rejected')), created_at timestamptz NOT NULL DEFAULT now(), paid_at timestamptz);
  CREATE TABLE public.checkout_buyers (stripe_session_id text PRIMARY KEY, user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    checkout_function text NOT NULL, product_type text, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.product_deliveries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), stripe_session_id text NOT NULL, product_type text NOT NULL,
    product_name text, customer_email text NOT NULL, status text NOT NULL DEFAULT 'payment_received', amount_cents integer, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.payment_revocations (payment_intent_id text PRIMARY KEY, reason text NOT NULL, stripe_event_id text, stripe_session_id text,
    product_type text, email text, user_id uuid, subscription_id text, paid_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
  CREATE FUNCTION public.record_affiliate_conversion(p_referral_code text, p_stripe_session_id text, p_sale_amount integer, p_product_name text, p_commission_override integer DEFAULT NULL)
    RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN RETURN false; END; $$;
`;

const U1 = "00000000-0000-4000-8000-00000000af01";
let pg: PGlite;

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(STAND_INS);
  await pg.exec(MIG);
  await pg.exec(MIG);
}, 180_000);
afterAll(async () => { try { await pg.close(); } catch { /* best effort */ } });

beforeEach(async () => {
  await pg.exec(`
    DELETE FROM public.payment_revocations; DELETE FROM public.affiliate_conversions; DELETE FROM public.product_deliveries;
    DELETE FROM public.checkout_buyers; DELETE FROM public.affiliates; DELETE FROM auth.users;
    INSERT INTO auth.users (id) VALUES ('${U1}');
    INSERT INTO public.affiliates (email, password_hash, referral_code) VALUES ('affiliate@example.com', 'x', 'ref-1');
  `);
});

const record = async (session: string) => (await pg.query(`SELECT public.record_affiliate_conversion('ref-1', $1, 4500, 'Pro', 1000) AS ok`, [session])).rows[0];
const conversion = async (session: string) => (await pg.query<{ commission_amount: number; status: string }>(
  `SELECT commission_amount, status FROM public.affiliate_conversions WHERE stripe_session_id = $1`, [session])).rows[0];
const balance = async () => (await pg.query<{ pending_payout: number; total_earnings: number }>(`SELECT pending_payout, total_earnings FROM public.affiliates`)).rows[0];
const deliver = (session: string, email: string, ago = "0 days") =>
  pg.exec(`INSERT INTO public.product_deliveries (stripe_session_id, product_type, customer_email, status, created_at) VALUES ('${session}', 'pro_subscription', '${email}', 'delivered', now() - interval '${ago}')`);

describe("a referred customer's first paid Pro month earns once", () => {
  it("a new customer earns the $10", async () => {
    await deliver("cs_new", "new@example.com");
    await record("cs_new");
    expect(await conversion("cs_new")).toEqual({ commission_amount: 1000, status: "pending" });
    expect(await balance()).toEqual({ pending_payout: 1000, total_earnings: 1000 });
  });

  it("the same address subscribing again records 0, and the balance does not move", async () => {
    await deliver("cs_first", "back@example.com", "90 days");
    await deliver("cs_again", "Back@Example.com");
    await record("cs_again");
    expect((await conversion("cs_again")).commission_amount).toBe(0);
    expect(await balance()).toEqual({ pending_payout: 0, total_earnings: 0 });
  });

  it("the same account under a new address records 0", async () => {
    await deliver("cs_acct_first", "old@example.com", "90 days");
    await deliver("cs_acct_again", "new-address@example.com");
    await pg.exec(`INSERT INTO public.checkout_buyers (stripe_session_id, user_id, checkout_function, product_type) VALUES
      ('cs_acct_first', '${U1}', 'create-subscription-checkout', 'pro_subscription'),
      ('cs_acct_again', '${U1}', 'create-subscription-checkout', 'pro_subscription')`);
    await record("cs_acct_again");
    expect((await conversion("cs_acct_again")).commission_amount).toBe(0);
  });

  it("an affiliate buying through their own link records 0", async () => {
    await deliver("cs_self", "affiliate@example.com");
    await record("cs_self");
    expect((await conversion("cs_self")).commission_amount).toBe(0);
  });
});

describe("a disputed payment takes the commission back", () => {
  it("a pending conversion is rejected and leaves the balance; a paid one stays paid", async () => {
    await deliver("cs_disputed", "d@example.com");
    await deliver("cs_paid", "p@example.com");
    await record("cs_disputed");
    await record("cs_paid");
    await pg.exec(`UPDATE public.affiliate_conversions SET status = 'paid' WHERE stripe_session_id = 'cs_paid'`);
    await pg.exec(`INSERT INTO public.payment_revocations (payment_intent_id, reason, stripe_session_id) VALUES ('pi_1', 'disputed', 'cs_disputed'), ('pi_2', 'disputed', 'cs_paid')`);
    expect(await conversion("cs_disputed")).toEqual({ commission_amount: 1000, status: "rejected" });
    expect((await conversion("cs_paid")).status).toBe("paid");
    expect(await balance()).toEqual({ pending_payout: 1000, total_earnings: 1000 });
  });
});

describe("the function stays one, and closed", () => {
  it("one overload, a definer with a fixed search_path, refused to both client roles", async () => {
    const { rows } = await pg.query<{ n: number; d: boolean; a: boolean; u: boolean; cfg: string[] | null }>(
      `SELECT count(*) OVER () AS n, p.prosecdef AS d, has_function_privilege('anon', p.oid, 'EXECUTE') AS a,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS u, p.proconfig AS cfg
         FROM pg_proc p WHERE p.proname = 'record_affiliate_conversion'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ d: true, a: false, u: false });
    expect(rows[0].cfg?.some((c) => c.startsWith("search_path="))).toBe(true);
  });
});
