// @vitest-environment node
/**
 * AN AFFILIATE BUYING UNDER AN ALIAS OF THEIR OWN ADDRESS EARNS NOTHING
 * (audit 2026-10-31, S13-063; migration 20261103100000).
 *
 * WHAT WAS WRONG. The self-referral rule compared lower(btrim(address)), so an
 * affiliate registered as jane@gmail.com who bought Pro with their own code as
 * jane+pro@gmail.com or j.a.n.e@gmail.com read as a stranger and earned the
 * $10, though Gmail delivers all three to one mailbox.
 *
 * WHAT HOLDS NOW (run, not read: 20261011211000 and then this round's file
 * applied twice to pglite from Supabase's default grants):
 *   - a + tag, Gmail dots and googlemail.com all read as the affiliate's own
 *     mailbox and record 0; a stranger still earns, and the balance moves once;
 *   - dots outside Gmail are NOT dropped (Outlook's john.doe and johndoe are
 *     two people);
 *   - over a corpus of 360 labelled address pairs, every pair main called the
 *     same mailbox is still the same (never worse than main), every pair is
 *     judged as its provider delivers it, and the new key catches the aliases
 *     main missed;
 *   - both functions are closed to the client roles; record_affiliate_conversion
 *     stays one overload.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const DIR = resolve(__dirname, "../../supabase/migrations");
const byStamp = (stamp: string) => readFileSync(resolve(DIR, readdirSync(DIR).find((n) => n.startsWith(`${stamp}_`))!), "utf8");
const BEFORE = byStamp("20261011211000");
const MIG = byStamp("20261103100000");

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

let pg: PGlite;

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(STAND_INS);
  await pg.exec(BEFORE);
  await pg.exec(MIG);
  await pg.exec(MIG);
}, 180_000);
afterAll(async () => { try { await pg.close(); } catch { /* best effort */ } });

const AFFILIATE = "jane.doe@gmail.com";

beforeEach(async () => {
  await pg.exec(`
    DELETE FROM public.payment_revocations; DELETE FROM public.affiliate_conversions; DELETE FROM public.product_deliveries;
    DELETE FROM public.checkout_buyers; DELETE FROM public.affiliates;
    INSERT INTO public.affiliates (email, password_hash, referral_code) VALUES ('${AFFILIATE}', 'x', 'ref-alias');
  `);
});

const sale = async (session: string, email: string) => {
  await pg.query(
    `INSERT INTO public.product_deliveries (stripe_session_id, product_type, customer_email, status) VALUES ($1, 'pro_subscription', $2, 'delivered')`,
    [session, email],
  );
  await pg.query(`SELECT public.record_affiliate_conversion('ref-alias', $1, 4500, 'Pro', 1000)`, [session]);
  return (await pg.query<{ commission_amount: number }>(
    `SELECT commission_amount FROM public.affiliate_conversions WHERE stripe_session_id = $1`, [session])).rows[0].commission_amount;
};
const pending = async () => (await pg.query<{ p: number }>(`SELECT pending_payout AS p FROM public.affiliates`)).rows[0].p;

describe("the affiliate's own mailbox earns nothing under any alias", () => {
  for (const [what, buyer] of [
    ["a + tag", "jane.doe+pro@gmail.com"],
    ["Gmail dots dropped", "janedoe@gmail.com"],
    ["Gmail dots moved", "j.a.n.e.d.o.e@gmail.com"],
    ["googlemail.com, upper case, spaces and a tag", "  Jane.Doe+Test@GoogleMail.com "],
  ] as const) {
    it(`${what} (${buyer.trim()}) records 0`, async () => {
      expect(await sale(`cs_${what}`, buyer)).toBe(0);
      expect(await pending()).toBe(0);
    });
  }

  it("a stranger still earns the $10, once on the balance", async () => {
    expect(await sale("cs_stranger", "john.smith@gmail.com")).toBe(1000);
    expect(await pending()).toBe(1000);
  });

  it("dots outside Gmail are two people: an Outlook affiliate's dotless neighbour still earns", async () => {
    await pg.exec(`UPDATE public.affiliates SET email = 'john.doe@outlook.com'`);
    expect(await sale("cs_outlook_neighbour", "johndoe@outlook.com")).toBe(1000);
    expect(await sale("cs_outlook_tag", "john.doe+deals@outlook.com")).toBe(0);
  });
});

/**
 * THE CORPUS. 360 labelled pairs, built from 40 local parts across the
 * providers buyers actually use. A pair's label is how its provider delivers
 * it: Gmail ignores dots and everything after '+', and reads googlemail.com as
 * gmail.com; Outlook, iCloud, Fastmail and Proton deliver '+' tags to the
 * base mailbox and treat dots as part of the name; a different name or a
 * different provider is a different mailbox.
 */
const LOCALS = [
  "jane.doe", "john.smith", "m.garcia", "li.wei", "priya.k", "a.b.carter", "olu.ade", "sam", "noor.h", "k.tanaka",
  "maria.rossi", "dev.patel", "chen.yu", "fatima.z", "lucas.m", "emma.j", "omar.f", "sofia.l", "ivan.p", "aisha.b",
  "tom.h", "nina.s", "raj.v", "hana.k", "leo.d", "zara.q", "ben.t", "mia.r", "ali.n", "eva.w",
  "joe.c", "ana.g", "max.o", "lea.f", "kai.y", "ivy.e", "dan.u", "amy.i", "gus.x", "ida.z",
];
type Pair = { a: string; b: string; same: boolean };
function corpus(): Pair[] {
  const out: Pair[] = [];
  LOCALS.forEach((l, i) => {
    const flat = l.replace(/\./g, "");
    const other = LOCALS[(i + 7) % LOCALS.length];
    out.push(
      { a: `${l}@gmail.com`, b: ` ${l.toUpperCase()}@Gmail.com `, same: true }, // main's own rule
      { a: `${l}@gmail.com`, b: `${l}+shop@gmail.com`, same: true },
      { a: `${l}@gmail.com`, b: `${flat}@gmail.com`, same: true },
      { a: `${flat}@googlemail.com`, b: `${l}+x@gmail.com`, same: true },
      { a: `${l}@outlook.com`, b: `${l}+promo@outlook.com`, same: true },
      { a: `${l}@icloud.com`, b: `${l.toUpperCase()}+a@iCloud.com`, same: true },
      { a: `${l}@outlook.com`, b: `${flat}@outlook.com`, same: flat === l }, // dots matter outside Gmail
      { a: `${l}@gmail.com`, b: `${l}@outlook.com`, same: false },
      { a: `${l}@gmail.com`, b: `${other}@gmail.com`, same: false },
    );
  });
  return out;
}

describe("over 360 labelled pairs the key is never worse than main", () => {
  it("main's matches all survive, every label holds, and the aliases main missed are caught", async () => {
    const pairs = corpus();
    expect(pairs.length).toBeGreaterThanOrEqual(300);
    const { rows } = await pg.query<{ i: number; same: boolean }>(
      `SELECT t.i, public.affiliate_address_key(t.a) = public.affiliate_address_key(t.b) AS same
         FROM unnest($1::text[], $2::text[]) WITH ORDINALITY AS t(a, b, i) ORDER BY t.i`,
      [pairs.map((p) => p.a), pairs.map((p) => p.b)],
    );
    const main = (p: Pair) => p.a.trim().toLowerCase() === p.b.trim().toLowerCase();
    const wrong = pairs.filter((p, k) => rows[k].same !== p.same);
    const lost = pairs.filter((p, k) => main(p) && !rows[k].same);
    expect(lost, "a pair main called one mailbox is now two").toEqual([]);
    expect(wrong, "a pair judged against how its provider delivers it").toEqual([]);
    const caughtByMain = pairs.filter((p) => p.same && main(p)).length;
    const caughtNow = pairs.filter((p, k) => p.same && rows[k].same).length;
    expect(caughtNow).toBeGreaterThan(caughtByMain);
  });
});

describe("both functions stay closed", () => {
  it("record_affiliate_conversion is one overload and a definer; neither function is callable by a client role", async () => {
    const { rows } = await pg.query<{ proname: string; d: boolean; a: boolean; u: boolean }>(
      `SELECT p.proname, p.prosecdef AS d, has_function_privilege('anon', p.oid, 'EXECUTE') AS a,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS u
         FROM pg_proc p WHERE p.proname IN ('record_affiliate_conversion', 'affiliate_address_key') ORDER BY p.proname`);
    expect(rows.map((r) => r.proname)).toEqual(["affiliate_address_key", "record_affiliate_conversion"]);
    for (const r of rows) expect(r).toMatchObject({ a: false, u: false });
    expect(rows[1].d).toBe(true);
  });
});
