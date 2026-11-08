// @vitest-environment node
/**
 * A TWO-DOLLAR RECEIPT OPENS NO PAID GENERATOR ONCE ITS CLAIM IS NAMED
 * (S14 hotfix, lane spend, M-S14-057), run in a real Postgres (pglite).
 *
 * WHAT WAS WRONG. assertPaidSession accepted a purchase claim with no
 * product as a purchase of everything, and every claim written before
 * 20260827180000 has none: the id of a $2 scan pack, of a $5 Full Analysis,
 * or a link a buyer forwarded ran every paid generator.
 *
 * WHAT HOLDS NOW. 20261110140000 names every unnamed claim our own records
 * still name (the order row, the delivered content, the checkout start, the
 * Pro grant) when they agree on one product, and a live Full Analysis from
 * before create-checkout wrote a product by the shape of its sale. It never
 * names a claim the records disagree on, never writes 'full_analysis' beside
 * an address unless the content was delivered, and never touches a claim
 * that already names a product. It counts what it leaves unnamed. Then the
 * gate (paid-session.ts) reads the named claims: the scan pack's opens
 * nothing else, the package buyer's opens the package, and an older buyer
 * whose product no record holds is still let through.
 *
 * The claims table is built by its real migrations (20251216023523 and
 * 20260827180000); the four record tables are stand-ins with the columns the
 * migration reads; the lane starts from Supabase's default grants. The
 * file's own DO block runs here too, and raises if its end state is wrong.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PgSupabase } from "./helpers/pglite-supabase";
import { assertPaidSession, CLAIMS_NAMED_FROM } from "../../supabase/functions/_shared/paid-session";
import { priorRedemptionOf } from "../../supabase/functions/_shared/full-analysis";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const DIR = resolve(__dirname, "../../supabase/migrations");
const file = (stamp: string) => readFileSync(resolve(DIR, readdirSync(DIR).find((f) => f.startsWith(`${stamp}_`))!), "utf8");
const NAMING = file("20261110140000");

const BASE = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
`;
const RECORDS = `
  CREATE TABLE public.product_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(),
    stripe_session_id text NOT NULL, product_type text NOT NULL, status text NOT NULL DEFAULT 'payment_received');
  CREATE TABLE public.purchased_content (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), stripe_session_id text NOT NULL UNIQUE,
    customer_email text NOT NULL, product_type text NOT NULL, generated_content jsonb);
  CREATE TABLE public.checkout_starts (
    stripe_session_id text PRIMARY KEY, product_type text NOT NULL, checkout_function text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.pro_grants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, product_id text NOT NULL, product_type text,
    consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.job_board_meta (k text PRIMARY KEY, v jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now());
`;

const GRANT = "0c8f3a2e-5d4b-4e1a-9f6c-7b2d1e0a3c4f";
const LEGACY = "2026-06-01T00:00:00Z";
const AFTER_NAMING = "2026-09-10T00:00:00Z";

/** Every claim the migration must decide, with what it should end as. */
const CLAIMS: Array<{ id: string; product: string | null; ip: string | null; at: string; after: string | null; why: string }> = [
  { id: "cs_live_pkg", product: null, ip: null, at: LEGACY, after: "premium_package", why: "its order row names the package" },
  { id: "cs_live_scanpack_by_webhook", product: null, ip: null, at: LEGACY, after: "scan_pack", why: "its order row names a $2 scan pack" },
  { id: "cs_live_scanpack_by_verify", product: null, ip: "203.0.113.9", at: LEGACY, after: "scan_pack", why: "its checkout start names a scan pack; an address does not stop a name that is not the analysis" },
  { id: "cs_live_fa_delivered", product: null, ip: "unknown", at: LEGACY, after: "full_analysis", why: "the analysis was delivered for it" },
  { id: "cs_live_fa_addressed", product: null, ip: "198.51.100.1", at: LEGACY, after: null, why: "an address and no delivered content: analyze-resume's pre-fix mark, never named the analysis" },
  { id: "cs_live_fa_by_shape", product: null, ip: null, at: LEGACY, after: "full_analysis", why: "a live sale before 2026-07-01 whose order rows all say unknown: create-checkout's Full Analysis" },
  { id: "cs_live_unknown_late", product: null, ip: null, at: "2026-07-20T00:00:00Z", after: null, why: "an unknown order written after create-checkout named its product: not the shape" },
  { id: "cs_test_unknown", product: null, ip: null, at: LEGACY, after: null, why: "test mode is never named by its shape" },
  { id: "cs_live_disagree", product: null, ip: null, at: LEGACY, after: null, why: "the records name two products" },
  { id: "cs_live_refunded", product: "refunded", ip: null, at: LEGACY, after: "refunded", why: "a claim that names something, refunded included, is never touched" },
  { id: "cs_live_letter", product: "cover_letter", ip: null, at: AFTER_NAMING, after: "cover_letter", why: "already named" },
  { id: `pro_${GRANT}`, product: null, ip: null, at: LEGACY, after: "interview_coach", why: "its Pro grant names the product" },
  { id: "cs_live_nothing_known", product: null, ip: null, at: LEGACY, after: null, why: "no record says what it bought" },
  { id: "cs_live_unnamed_late", product: null, ip: null, at: AFTER_NAMING, after: null, why: "written after claims named their product, and no record names it" },
];

async function seeded(): Promise<PGlite> {
  const pg = new PGlite();
  await pg.exec(BASE + file("20251216023523") + "\n" + file("20260827180000") + "\n" + RECORDS);
  for (const c of CLAIMS) {
    await pg.query("INSERT INTO public.used_stripe_sessions (session_id, product_type, ip_address, used_at) VALUES ($1, $2, $3, $4)", [c.id, c.product, c.ip, c.at]);
  }
  await pg.exec(`
    INSERT INTO public.product_deliveries (stripe_session_id, product_type, created_at) VALUES
      ('cs_live_pkg', 'premium_package', '2026-06-01'),
      ('cs_live_pkg', 'unknown', '2026-06-01'),
      ('cs_live_scanpack_by_webhook', 'scan_pack', '2026-06-01'),
      ('cs_live_fa_addressed', 'full_analysis', '2026-06-01'),
      ('cs_live_fa_by_shape', 'unknown', '2026-06-15'),
      ('cs_live_fa_by_shape', 'unknown', '2026-06-16'),
      ('cs_live_unknown_late', 'unknown', '2026-07-20'),
      ('cs_test_unknown', 'unknown', '2026-06-01'),
      ('cs_live_disagree', 'cover_letter', '2026-06-01'),
      ('cs_live_refunded', 'premium_package', '2026-06-01');
    INSERT INTO public.purchased_content (stripe_session_id, customer_email, product_type) VALUES
      ('cs_live_fa_delivered', 'a@example.com', 'full_analysis');
    INSERT INTO public.checkout_starts (stripe_session_id, product_type, checkout_function) VALUES
      ('cs_live_scanpack_by_verify', 'scan_pack', 'create-scan-pack-checkout'),
      ('cs_live_disagree', 'premium_package', 'create-product-checkout');
    INSERT INTO public.pro_grants (id, email, product_id, product_type) VALUES
      ('${GRANT}', 'm@example.com', 'prod_coach', 'interview_coach');
  `);
  return pg;
}

const apply = (pg: PGlite) => pg.exec(`BEGIN;\n${NAMING}\nCOMMIT;`);
const named = async (pg: PGlite) => Object.fromEntries((await pg.query<{ session_id: string; product_type: string | null }>(
  "SELECT session_id, product_type FROM public.used_stripe_sessions")).rows.map((r) => [r.session_id, r.product_type]));
const meta = async (pg: PGlite) => (await pg.query<{ v: Record<string, Record<string, unknown>> }>(
  "SELECT v FROM public.job_board_meta WHERE k = 'paid_session_names'")).rows[0]?.v;

/** The gate's lookup as PostgREST answers it: JSON on the wire, so a timestamp is an ISO string. */
const wire = (pg: PGlite) => {
  const client = new PgSupabase(pg);
  return {
    from: (t: string) => ({
      select: (cols: string) => ({
        eq: (k: string, v: unknown) => ({
          maybeSingle: async () => JSON.parse(JSON.stringify(await client.from(t).select(cols).eq(k, v).maybeSingle())),
        }),
      }),
    }),
  };
};

let pg: PGlite;
let before: Record<string, string | null>;

beforeAll(async () => {
  pg = await seeded();
  before = await named(pg);
}, 180_000);

afterAll(async () => { await pg?.close(); });

describe("before it applies", () => {
  it("a $2 scan pack's unnamed claim from before naming opens the premium package: the hole", async () => {
    expect(before.cs_live_scanpack_by_webhook).toBeNull();
    expect(await assertPaidSession(wire(pg), "cs_live_scanpack_by_webhook", ["premium_package"])).toBeNull();
  });
});

describe("20261110140000 names every claim our records name, and nothing else", () => {
  beforeAll(async () => { await apply(pg); }, 60_000);

  for (const c of CLAIMS) {
    it(`${c.id} ends ${c.after ?? "unnamed"}: ${c.why}`, async () => {
      expect((await named(pg))[c.id]).toBe(c.after);
    });
  }

  it("counts what it leaves unnamed, split by what the gate does with it", async () => {
    const v = await meta(pg);
    expect(v.migration).toBe("20261110140000");
    // Named: the eight above that end with a product. Unnamed: six. Of those,
    // three may be an older buyer's (no address, before naming, not test mode).
    expect(v.firstRun).toMatchObject({ named: 8, unnamedStillOpen: 3, unnamedRefused: 3 });
    expect(v.lastRun).toEqual(v.firstRun);
  });

  it("is safe to re-run: a second run names only a claim that has since gained a record, and keeps the first run's counts", async () => {
    const first = (await meta(pg)).firstRun;
    await pg.exec(`
      INSERT INTO public.used_stripe_sessions (session_id, product_type, ip_address, used_at) VALUES ('cs_live_found_later', NULL, NULL, '${LEGACY}');
      INSERT INTO public.product_deliveries (stripe_session_id, product_type, created_at) VALUES ('cs_live_found_later', 'graduate_gameplan', '2026-06-01');
    `);
    const was = await named(pg);
    await apply(pg);
    const now = await named(pg);
    expect(now.cs_live_found_later).toBe("graduate_gameplan");
    for (const [id, p] of Object.entries(was)) if (id !== "cs_live_found_later") expect(now[id], id).toBe(p);
    const v = await meta(pg);
    expect(v.firstRun).toEqual(first);
    expect(v.lastRun).toMatchObject({ named: 9, unnamedStillOpen: 3, unnamedRefused: 3 });
  });

  it("its self-check refuses an end state it should have named", async () => {
    // A copy whose UPDATEs are cut out leaves a named-by-records claim unnamed:
    // the DO block must raise rather than report success.
    const doBlock = NAMING.slice(NAMING.indexOf("DO $$"));
    const other = await seeded();
    await expect(other.exec(`BEGIN;\n${doBlock}\nCOMMIT;`)).rejects.toThrow(/still unnamed/);
    await other.close();
  });
});

describe("the gate reads the names", () => {
  it("the $2 scan pack's claim no longer opens the premium package, nor any generator", async () => {
    for (const id of ["cs_live_scanpack_by_webhook", "cs_live_scanpack_by_verify"]) {
      expect(await assertPaidSession(wire(pg), id, ["premium_package"]), id).toContain("does not include this tool");
      expect(await assertPaidSession(wire(pg), id, ["cover_letter"]), id).toContain("does not include this tool");
    }
  });

  it("a $5 Full Analysis's claim opens no generator", async () => {
    for (const id of ["cs_live_fa_delivered", "cs_live_fa_by_shape", "cs_live_fa_addressed"]) {
      expect(await assertPaidSession(wire(pg), id, ["premium_package"]), id).toContain("does not include this tool");
    }
  });

  it("each buyer still opens what they bought", async () => {
    expect(await assertPaidSession(wire(pg), "cs_live_pkg", ["premium_package"])).toBeNull();
    expect(await assertPaidSession(wire(pg), `pro_${GRANT}`, ["interview_coach"])).toBeNull();
    expect(await assertPaidSession(wire(pg), "cs_live_letter", ["cover_letter"])).toBeNull();
  });

  it("an older buyer no record can name is let through rather than locked out; a later or test-mode unnamed claim is not", async () => {
    expect(await assertPaidSession(wire(pg), "cs_live_nothing_known", ["premium_package"])).toBeNull();
    expect(await assertPaidSession(wire(pg), "cs_live_unnamed_late", ["premium_package"])).toContain("does not include this tool");
    expect(await assertPaidSession(wire(pg), "cs_test_unknown", ["premium_package"])).toContain("does not include this tool");
    expect(Date.parse(AFTER_NAMING)).toBeGreaterThan(Date.parse(CLAIMS_NAMED_FROM));
  });

  it("the analysis a legacy buyer paid for is still owed: the shape-named claim reads as paid and not yet analysed", async () => {
    const row = (await pg.query<{ product_type: string | null; ip_address: string | null }>(
      "SELECT product_type, ip_address FROM public.used_stripe_sessions WHERE session_id = 'cs_live_fa_by_shape'")).rows[0];
    expect(priorRedemptionOf(null, row)).toEqual({ state: "none" });
    // And the addressed mark stays what analyze-resume refuses.
    const mark = (await pg.query<{ product_type: string | null; ip_address: string | null }>(
      "SELECT product_type, ip_address FROM public.used_stripe_sessions WHERE session_id = 'cs_live_fa_addressed'")).rows[0];
    expect(priorRedemptionOf(null, mark).state).toBe("refused");
  });

  it("creates nothing a client could reach: no table or function beyond the ones it was given", async () => {
    const fns = await pg.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'");
    expect(fns.rows[0].n).toBe(0);
    const tables = await pg.query<{ t: string }>("SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' ORDER BY 1");
    expect(tables.rows.map((r) => r.t)).toEqual(["checkout_starts", "job_board_meta", "pro_grants", "product_deliveries", "purchased_content", "used_stripe_sessions"]);
  });
});
