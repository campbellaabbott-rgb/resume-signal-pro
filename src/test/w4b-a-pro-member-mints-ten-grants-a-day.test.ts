// @vitest-environment node
//
// Node, not jsdom: the migration runs in pglite, from Supabase's default grants.
/**
 * A PRO MEMBER MINTS AT MOST TEN GRANTS A DAY AND SIXTY A MONTH, A CHECKOUT
 * CAN NAME ITS BUYER, AND A CANCELLED PLAN CAN SAY SO (20261011150000;
 * S12-067, owner decision D7, critical-path CP-022, S12-076).
 *
 * Run, not read: the migration itself, twice, with its own self-check (which
 * exercises the cap and rolls back), then the cap as the checkouts meet it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { agentDb, migration } from "./helpers/agent-db";

const M = "20261011150000_a_pro_member_mints_ten_grants_a_day_a_checkout_names_its_buyer_and_a_cancelled_plan_says_so.sql";
const A = "00000000-0000-4000-8000-0000000f0001";
const B = "00000000-0000-4000-8000-0000000f0002";
let db: PGlite;

const mint = (user: string | null, email = "a@example.com", ago = "0 seconds") =>
  db.exec(`INSERT INTO public.pro_grants (email, product_id, product_type, user_id, created_at)
           VALUES ('${email}', 'fullAnalysis', 'full_analysis', ${user ? `'${user}'` : "NULL"}, now() - interval '${ago}')`);
const refusal = async (fn: () => Promise<unknown>): Promise<string | null> => {
  try { await fn(); return null; } catch (e) { return e instanceof Error ? e.message : String(e); }
};

beforeAll(async () => {
  db = await agentDb({
    seed: `
      CREATE TABLE public.pro_subscribers (
        email text PRIMARY KEY, stripe_customer_id text, status text NOT NULL DEFAULT 'inactive',
        current_period_end timestamptz, updated_at timestamptz NOT NULL DEFAULT now(), user_id uuid);
      CREATE TABLE public.pro_grants (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, product_id text NOT NULL,
        product_type text, product_name text, credits integer, resume_session_id text, job_title text,
        job_company text, language text, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
        user_id uuid, revoked_at timestamptz);
      INSERT INTO auth.users (id, email) VALUES ('${A}', 'a@example.com'), ('${B}', 'b@example.com');`,
  });
  await db.exec(migration(M));
  // Safe twice: the staged runner re-stages files.
  await db.exec(migration(M));
}, 240_000);
afterAll(async () => { await db?.close(); });

describe("the cap (pro_grants_cap)", () => {
  it("ten grants in a day pass for one account; the eleventh is refused with the cap's own message", async () => {
    for (let i = 0; i < 10; i++) await mint(A);
    const msg = await refusal(() => mint(A));
    expect(msg).toMatch(/^pro_grant_cap: daily/);
    const n = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.pro_grants WHERE user_id = '${A}'`)).rows[0].n;
    expect(n).toBe(10);
  });

  it("another account is not counted against the first", async () => {
    await mint(B, "b@example.com");
    expect((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.pro_grants WHERE user_id = '${B}'`)).rows[0].n).toBe(1);
  });

  it("sixty in thirty days is the month's ceiling, whatever the day", async () => {
    const C = "00000000-0000-4000-8000-0000000f0003";
    for (let d = 1; d <= 6; d++) for (let i = 0; i < 10; i++) await mint(C, "c@example.com", `${d * 2} days`);
    expect(await refusal(() => mint(C, "c@example.com"))).toMatch(/^pro_grant_cap: monthly/);
  });

  it("grants older than the window do not count", async () => {
    const D = "00000000-0000-4000-8000-0000000f0004";
    for (let i = 0; i < 60; i++) await mint(D, "d@example.com", "31 days");
    expect(await refusal(() => mint(D, "d@example.com"))).toBeNull();
  });

  it("a grant with no account is counted by its address", async () => {
    for (let i = 0; i < 10; i++) await mint(null, "Legacy@Example.com");
    expect(await refusal(() => mint(null, "legacy@example.com"))).toMatch(/^pro_grant_cap: daily/);
  });

  it("no client role can execute the trigger function", async () => {
    const acl = await db.query<{ anon: boolean; authed: boolean }>(
      `SELECT has_function_privilege('anon', 'public.pro_grants_cap()', 'EXECUTE') AS anon,
              has_function_privilege('authenticated', 'public.pro_grants_cap()', 'EXECUTE') AS authed`);
    expect(acl.rows[0]).toEqual({ anon: false, authed: false });
  });
});

describe("checkout_buyers and the cancel flag", () => {
  it("checkout_buyers holds no privilege for a client role, from Supabase's default grants", async () => {
    const r = await db.query<Record<string, boolean>>(`SELECT
      has_table_privilege('anon', 'public.checkout_buyers', 'SELECT') AS a_sel,
      has_table_privilege('anon', 'public.checkout_buyers', 'INSERT') AS a_ins,
      has_table_privilege('authenticated', 'public.checkout_buyers', 'SELECT') AS u_sel,
      has_table_privilege('authenticated', 'public.checkout_buyers', 'UPDATE') AS u_upd,
      has_table_privilege('service_role', 'public.checkout_buyers', 'INSERT') AS s_ins`);
    expect(r.rows[0]).toEqual({ a_sel: false, a_ins: false, u_sel: false, u_upd: false, s_ins: true });
  });

  it("a buyer row keeps its payment record when the account is deleted (D9), and refuses a non-session id", async () => {
    await db.exec(`INSERT INTO public.checkout_buyers (stripe_session_id, user_id, checkout_function, product_type)
                   VALUES ('cs_test_buyerrow01', '${B}', 'create-checkout', 'full_analysis')`);
    await db.exec(`DELETE FROM auth.users WHERE id = '${B}'`);
    const row = (await db.query<{ user_id: string | null }>(`SELECT user_id FROM public.checkout_buyers WHERE stripe_session_id = 'cs_test_buyerrow01'`)).rows[0];
    expect(row).toEqual({ user_id: null });
    expect(await refusal(() => db.exec(`INSERT INTO public.checkout_buyers (stripe_session_id, checkout_function) VALUES ('pro_x', 'create-checkout')`))).not.toBeNull();
  });

  it("pro_subscribers can say a plan was cancelled at its period end", async () => {
    await db.exec(`INSERT INTO public.pro_subscribers (email, status, cancel_at_period_end) VALUES ('x@example.com', 'active', true)`);
    const r = await db.query<{ c: boolean }>(`SELECT cancel_at_period_end AS c FROM public.pro_subscribers WHERE email = 'x@example.com'`);
    expect(r.rows[0].c).toBe(true);
  });
});
