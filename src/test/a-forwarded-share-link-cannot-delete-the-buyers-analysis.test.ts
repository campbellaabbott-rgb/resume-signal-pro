// @vitest-environment node
//
// Node, not jsdom: the SQL runs in pglite.
/**
 * A FORWARDED SHARE LINK CANNOT DELETE THE BUYER'S ANALYSIS (S13-079).
 *
 * delete_analysis_by_share_id(text) deleted the analysis behind any
 * well-formed share id, and the share id is the link a buyer forwards (and
 * the one the analysis mail carried). Migration 20261103130000 keeps the
 * signature the census names and asks for the share id with the purchase it
 * was made for, '<share id>:<purchase reference>', checked against the
 * redemption row analyze-resume writes (purchased_content, product_type
 * full_analysis, generated_content.shareId). Run here on a real Postgres,
 * twice (the file is safe to re-run), with Supabase's three client roles:
 *   - a share id alone raises and deletes nothing;
 *   - another purchase's reference answers false and deletes nothing;
 *   - the buyer's pair, a Stripe session or a Pro grant, deletes and answers true;
 *   - anon and authenticated still execute it (the success page calls it).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve(__dirname, "../../supabase/migrations");
const FILE = readdirSync(DIR).find((f) => f.startsWith("20261103130000_"));
const SHARE = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const LEGACY_SHARE = "0123456789abcdef01234567";
const BUYER = "cs_live_a1B2c3D4e5F6g7H8i9J0buyer";
const GRANT = "pro_11111111-2222-4333-8444-555555555555";
let db: PGlite;

const call = async (arg: string | null) => {
  try {
    const { rows } = await db.query<{ ok: boolean | null }>("SELECT public.delete_analysis_by_share_id($1) AS ok", [arg]);
    return { ok: rows[0].ok, error: null as string | null };
  } catch (e) {
    return { ok: null, error: String((e as Error).message) };
  }
};
const shares = async () => (await db.query<{ share_id: string }>("SELECT share_id FROM public.resume_analyses ORDER BY share_id")).rows.map((r) => r.share_id);

beforeAll(async () => {
  expect(FILE, "migration 20261103130000 is missing").toBeTruthy();
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.resume_analyses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), analysis_result jsonb NOT NULL, resume_text text,
      created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz DEFAULT now() + interval '90 days', share_id text NOT NULL UNIQUE);
    CREATE TABLE public.purchased_content (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), stripe_session_id text NOT NULL UNIQUE, customer_email text NOT NULL,
      product_type text NOT NULL, product_name text, generated_content jsonb, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz);
  `);
  const sql = readFileSync(resolve(DIR, FILE!), "utf8");
  await db.exec(sql);
  await db.exec(sql);
}, 60_000);
afterAll(async () => { await db?.close(); });

const seed = async () => {
  await db.exec("DELETE FROM public.resume_analyses; DELETE FROM public.purchased_content;");
  await db.query("INSERT INTO public.resume_analyses (analysis_result, share_id) VALUES ('{}', $1), ('{}', $2)", [SHARE, LEGACY_SHARE]);
  await db.query(
    "INSERT INTO public.purchased_content (stripe_session_id, customer_email, product_type, generated_content) VALUES ($1, 'b@example.com', 'full_analysis', $2), ($3, 'p@example.com', 'full_analysis', $4)",
    [BUYER, JSON.stringify({ shareId: SHARE }), GRANT, JSON.stringify({ shareId: LEGACY_SHARE })],
  );
};

describe("delete_analysis_by_share_id after 20261103130000", () => {
  it("a share id alone, the forwarded link, raises and deletes nothing", async () => {
    await seed();
    for (const bare of [SHARE, LEGACY_SHARE, `${SHARE}:`, `${SHARE}:not-a-purchase`, null]) {
      const r = await call(bare);
      expect(r.error, `${bare} was accepted`).toMatch(/Invalid share_id format/);
    }
    expect(await shares()).toEqual([LEGACY_SHARE, SHARE].sort());
  });

  it("another purchase's reference answers false and deletes nothing", async () => {
    await seed();
    expect(await call(`${SHARE}:${GRANT}`)).toEqual({ ok: false, error: null });
    expect(await call(`${LEGACY_SHARE}:${BUYER}`)).toEqual({ ok: false, error: null });
    await db.query("UPDATE public.purchased_content SET product_type = 'premium_package' WHERE stripe_session_id = $1", [BUYER]);
    expect(await call(`${SHARE}:${BUYER}`), "a redemption of another product counted").toEqual({ ok: false, error: null });
    expect(await shares()).toEqual([LEGACY_SHARE, SHARE].sort());
  });

  it("the buyer's pair deletes it, a Stripe session or a Pro grant", async () => {
    await seed();
    expect(await call(`${SHARE}:${BUYER}`)).toEqual({ ok: true, error: null });
    expect(await shares()).toEqual([LEGACY_SHARE]);
    expect(await call(`${LEGACY_SHARE}:${GRANT}`)).toEqual({ ok: true, error: null });
    expect(await shares()).toEqual([]);
    expect(await call(`${SHARE}:${BUYER}`), "a second delete found a row").toEqual({ ok: false, error: null });
  });

  it("the publishable key still reaches it, and only by the one signature", async () => {
    const { rows } = await db.query<{ anon: boolean; authed: boolean; svc: boolean; n: number }>(`
      SELECT has_function_privilege('anon', 'public.delete_analysis_by_share_id(text)', 'EXECUTE') AS anon,
             has_function_privilege('authenticated', 'public.delete_analysis_by_share_id(text)', 'EXECUTE') AS authed,
             has_function_privilege('service_role', 'public.delete_analysis_by_share_id(text)', 'EXECUTE') AS svc,
             (SELECT count(*)::int FROM pg_proc WHERE proname = 'delete_analysis_by_share_id') AS n`);
    expect(rows[0]).toEqual({ anon: true, authed: true, svc: true, n: 1 });
  });
});
