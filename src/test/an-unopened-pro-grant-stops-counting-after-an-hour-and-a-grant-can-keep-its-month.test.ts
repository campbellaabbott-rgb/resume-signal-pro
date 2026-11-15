// @vitest-environment node
//
// Node, not jsdom: the migrations run in pglite, from Supabase's default grants.
/**
 * AN UNOPENED PRO GRANT STOPS COUNTING AGAINST THE DAY'S TEN AFTER AN HOUR
 * (20261112111000, S14X-079), AND A GRANT CAN KEEP THE MONTH THAT PAID FOR IT
 * (20261112110000, S14X-078).
 *
 * pro_grants_cap() counted every grant minted, so ten presses that were never
 * redeemed (a closed tab, a reload) used up the day while no model ran. It
 * now counts redeemed grants plus unredeemed ones younger than an hour.
 * Run, not read: the cap migration it replaces, then both files twice, with
 * their own self-checks; then the self-check is shown to refuse the old rule.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { agentDb, migration } from "./helpers/agent-db";

const M_CAP = "20261011150000_a_pro_member_mints_ten_grants_a_day_a_checkout_names_its_buyer_and_a_cancelled_plan_says_so.sql";
const M_WINDOW = "20261112110000_a_pro_grant_keeps_the_month_that_paid_for_it.sql";
const M_OPEN = "20261112111000_an_unopened_pro_grant_stops_counting_against_the_days_ten_after_an_hour.sql";
let db: PGlite;
let n = 0;
const user = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

const mint = (u: string | null, opts: { email?: string; ago?: string; consumed?: boolean } = {}) =>
  db.exec(`INSERT INTO public.pro_grants (email, product_id, product_type, user_id, created_at, consumed_at)
           VALUES ('${opts.email ?? "m@example.com"}', 'fullAnalysis', 'full_analysis', ${u ? `'${u}'` : "NULL"},
                   now() - interval '${opts.ago ?? "0 seconds"}', ${opts.consumed ? "now()" : "NULL"})`);
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
      ALTER TABLE public.pro_grants ENABLE ROW LEVEL SECURITY;`,
  });
  await db.exec(migration(M_CAP));
  for (const m of [M_WINDOW, M_OPEN, M_WINDOW, M_OPEN]) await db.exec(migration(m));
}, 240_000);
afterAll(async () => { await db?.close(); });

describe("the day's ten count what was redeemed (S14X-079)", () => {
  it("ten unopened grants older than an hour no longer refuse the eleventh", async () => {
    const u = user();
    for (let i = 0; i < 10; i++) await mint(u, { ago: "2 hours" });
    expect(await refusal(() => mint(u))).toBeNull();
  });

  it("ten redeemed grants still refuse the eleventh, with the cap's own message", async () => {
    const u = user();
    for (let i = 0; i < 10; i++) await mint(u, { ago: "2 hours", consumed: true });
    expect(await refusal(() => mint(u))).toMatch(/^pro_grant_cap: daily/);
  });

  it("ten fresh unopened presses are still bounded inside the hour", async () => {
    const u = user();
    for (let i = 0; i < 10; i++) await mint(u, { ago: "5 minutes" });
    expect(await refusal(() => mint(u))).toMatch(/^pro_grant_cap: daily/);
  });

  it("sixty redeemed in thirty days is still the month's ceiling", async () => {
    const u = user();
    for (let d = 1; d <= 6; d++) for (let i = 0; i < 10; i++) await mint(u, { ago: `${d * 2} days`, consumed: true });
    expect(await refusal(() => mint(u))).toMatch(/^pro_grant_cap: monthly/);
  });

  it("an address-keyed grant follows the same count", async () => {
    for (let i = 0; i < 10; i++) await mint(null, { email: "Legacy@Example.com", ago: "3 hours" });
    expect(await refusal(() => mint(null, { email: "legacy@example.com" }))).toBeNull();
    for (let i = 0; i < 10; i++) await mint(null, { email: "used@example.com", ago: "3 hours", consumed: true });
    expect(await refusal(() => mint(null, { email: "used@example.com" }))).toMatch(/^pro_grant_cap: daily/);
  });

  it("no client role can execute the trigger function", async () => {
    const acl = await db.query<{ anon: boolean; authed: boolean; svc: boolean }>(
      `SELECT has_function_privilege('anon', 'public.pro_grants_cap()', 'EXECUTE') AS anon,
              has_function_privilege('authenticated', 'public.pro_grants_cap()', 'EXECUTE') AS authed,
              has_function_privilege('service_role', 'public.pro_grants_cap()', 'EXECUTE') AS svc`);
    expect(acl.rows[0]).toEqual({ anon: false, authed: false, svc: true });
  });

  it("the self-check refuses a database whose cap still counts unopened grants", async () => {
    const check = migration(M_OPEN).slice(migration(M_OPEN).lastIndexOf("DO $$"));
    await db.exec(migration(M_CAP));
    expect(await refusal(() => db.exec(check))).toMatch(/ten unopened grants older than an hour still refused the eleventh/);
    await db.exec(migration(M_OPEN));
    expect(await refusal(() => db.exec(check))).toBeNull();
  });
});

describe("a grant can keep its month (S14X-078)", () => {
  it("pro_grants.redeem_until is a timestamptz that defaults to nothing", async () => {
    const r = await db.query<{ data_type: string; column_default: string | null }>(
      `SELECT data_type, column_default FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'pro_grants' AND column_name = 'redeem_until'`);
    expect(r.rows).toEqual([{ data_type: "timestamp with time zone", column_default: null }]);
  });

  it("the window's self-check refuses a table with row level security off", async () => {
    const check = migration(M_WINDOW).slice(migration(M_WINDOW).lastIndexOf("DO $$"));
    await db.exec("ALTER TABLE public.pro_grants DISABLE ROW LEVEL SECURITY");
    expect(await refusal(() => db.exec(check))).toMatch(/row level security off/);
    await db.exec("ALTER TABLE public.pro_grants ENABLE ROW LEVEL SECURITY");
    expect(await refusal(() => db.exec(check))).toBeNull();
  });
});
