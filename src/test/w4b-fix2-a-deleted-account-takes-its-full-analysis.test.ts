// @vitest-environment node
/**
 * A DELETED ACCOUNT TAKES ITS FULL ANALYSIS, NOT ONLY THE POINTER TO IT
 * (migration 20261011212000; wave 4 round 2 recheck; D9, CP-048).
 *
 * WHAT WAS WRONG. 20261011210000 erased purchased_content for the account's
 * purchases and Pro inclusions, and the delete card says the documents made
 * for them are deleted. The Full Analysis, the one document still sold (and
 * the one Pro includes), lives in resume_analyses: it quotes the résumé and
 * its share id reads it for 90 days. purchased_content holds only the pointer
 * {"shareId": ...}, so deletion removed the pointer and kept the document.
 *
 * WHAT HOLDS NOW (run, not read: every migration that defines
 * account_erase_personal_data, in order, applied to pglite from Supabase's
 * default grants, the last one twice):
 *   - the analysis behind a bound session's pointer and behind the account's
 *     Pro grant's pointer is deleted, then the pointers, and the count is
 *     answered as analyses_deleted;
 *   - an address's analysis goes only with a proven address;
 *   - another person's analysis, an analysis no pointer names, and the
 *     payment record stay;
 *   - a pointer that is not an object, or has no shareId, deletes no analysis.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const DIR = resolve(__dirname, "../../supabase/migrations");
/** Every migration that (re)defines the function, in the order they apply. */
const ERASERS = readdirSync(DIR)
  .filter((n) => n.endsWith(".sql") && /FUNCTION public\.account_erase_personal_data\(/.test(readFileSync(resolve(DIR, n), "utf8")))
  .sort()
  .map((n) => readFileSync(resolve(DIR, n), "utf8"));

const STAND_INS = `
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE auth.identities (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, provider text NOT NULL, identity_data jsonb NOT NULL DEFAULT '{}');
  CREATE TABLE public.api_keys (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key_hash text NOT NULL UNIQUE, key_prefix text NOT NULL,
    name text NOT NULL, owner_email text NOT NULL, tier text NOT NULL DEFAULT 'trial', created_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz, user_id uuid);
  CREATE TABLE public.api_key_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL);
  CREATE TABLE public.market_pulse_subscribers (email text PRIMARY KEY);
  CREATE TABLE public.free_scan_leads (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL);
  CREATE TABLE public.email_unsubscribe_tokens (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE);
  CREATE TABLE public.suppressed_emails (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE, reason text NOT NULL, metadata jsonb);
  CREATE TABLE public.mailbox_proof_settings (id boolean PRIMARY KEY DEFAULT true, confirmation_required_since timestamptz);
  CREATE TABLE public.resume_analyses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), share_id text NOT NULL UNIQUE DEFAULT md5(random()::text),
    resume_text text NOT NULL, analysis_result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz DEFAULT now() + interval '90 days');
  CREATE TABLE public.purchased_content (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), stripe_session_id text NOT NULL UNIQUE,
    customer_email text NOT NULL, product_type text NOT NULL, product_name text, generated_content jsonb,
    created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz DEFAULT now() + interval '365 days');
  CREATE TABLE public.pro_grants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, product_id text NOT NULL,
    product_type text, product_name text, resume_session_id text, job_title text, job_company text, user_id uuid, revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.checkout_buyers (stripe_session_id text PRIMARY KEY, user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    checkout_function text NOT NULL, product_type text, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.product_deliveries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), stripe_session_id text, customer_email text, amount_cents int, metadata jsonb);
`;

const A = "00000000-0000-4000-8000-00000000dd11";
const B = "00000000-0000-4000-8000-00000000dd12";
let pg: PGlite;

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(STAND_INS);
  for (const sql of ERASERS) await pg.exec(sql);
  await pg.exec(ERASERS[ERASERS.length - 1]);
}, 180_000);

afterAll(async () => { try { await pg.close(); } catch { /* best effort */ } });

beforeEach(async () => {
  await pg.exec(`
    DELETE FROM public.resume_analyses; DELETE FROM public.purchased_content; DELETE FROM public.pro_grants; DELETE FROM public.checkout_buyers;
    DELETE FROM public.product_deliveries; DELETE FROM public.suppressed_emails; DELETE FROM auth.users;
    INSERT INTO auth.users (id, email) VALUES ('${A}', 'leaving@example.com'), ('${B}', 'staying@example.com');
    INSERT INTO public.checkout_buyers (stripe_session_id, user_id, checkout_function) VALUES
      ('cs_bound_a', '${A}', 'create-checkout'), ('cs_bound_b', '${B}', 'create-checkout');
    INSERT INTO public.resume_analyses (share_id, resume_text, analysis_result) VALUES
      ('share-bound-a', '[x]', '{}'), ('share-grant-a', '[x]', '{}'), ('share-by-address', '[x]', '{}'),
      ('share-bound-b', '[x]', '{}'), ('share-free', '[x]', '{}');
    INSERT INTO public.product_deliveries (stripe_session_id, customer_email, amount_cents, metadata)
      VALUES ('cs_bound_a', 'typed@example.com', 500, '{"share_id": "share-bound-a"}');
  `);
  const grantA = (await pg.query<{ id: string }>(
    `INSERT INTO public.pro_grants (email, user_id, product_id) VALUES ('leaving@example.com', '${A}', 'fullAnalysis') RETURNING id`,
  )).rows[0].id;
  await pg.exec(`
    INSERT INTO public.pro_grants (email, user_id, product_id) VALUES ('staying@example.com', '${B}', 'fullAnalysis');
    INSERT INTO public.purchased_content (stripe_session_id, customer_email, product_type, generated_content) VALUES
      ('cs_bound_a', 'typed@example.com', 'full_analysis', '{"shareId": "share-bound-a"}'),
      ('pro_${grantA}', 'leaving@example.com', 'full_analysis', '{"shareId": "share-grant-a"}'),
      ('cs_by_address', 'Leaving@Example.com', 'full_analysis', '{"shareId": "share-by-address"}'),
      ('cs_letter_by_address', 'leaving@example.com', 'cover_letter', '"a letter stored as a string"'),
      ('cs_list_by_address', 'leaving@example.com', 'cover_letter', '["not", "an", "object"]'),
      ('cs_bound_b', 'staying@example.com', 'full_analysis', '{"shareId": "share-bound-b"}');
  `);
});

const analyses = async () => (await pg.query<{ s: string }>(`SELECT share_id AS s FROM public.resume_analyses ORDER BY 1`)).rows.map((r) => r.s);
const erase = async (proven: boolean) => (await pg.query<{ r: Record<string, unknown> }>(
  `SELECT public.account_erase_personal_data($1, 'leaving@example.com', $2) AS r`, [A, proven])).rows[0].r;

describe("account_erase_personal_data takes the Full Analysis behind each pointer", () => {
  it("applies the function's migrations in order, the recheck's last", () => {
    expect(ERASERS.length).toBeGreaterThanOrEqual(3);
  });

  it("without a proof: the bound session's and the Pro grant's analyses go; the address's stays", async () => {
    const r = await erase(false);
    expect(r).toMatchObject({ analyses_deleted: 2, documents_deleted: 2, by_address: false });
    expect(await analyses()).toEqual(["share-bound-b", "share-by-address", "share-free"]);
  });

  it("with a proof: the address's analysis goes too; another person's, an unclaimed one and the payment record stay", async () => {
    const r = await erase(true);
    expect(r).toMatchObject({ analyses_deleted: 3, documents_deleted: 5, by_address: true });
    expect(await analyses()).toEqual(["share-bound-b", "share-free"]);
    const { rows } = await pg.query<{ s: string }>(`SELECT stripe_session_id AS s FROM public.purchased_content ORDER BY 1`);
    expect(rows.map((x) => x.s)).toEqual(["cs_bound_b"]);
    expect((await pg.query(`SELECT count(*)::int AS n FROM public.product_deliveries`)).rows[0]).toEqual({ n: 1 });
  });

  it("is still a definer with a fixed search_path, refused to both client roles", async () => {
    const { rows } = await pg.query<{ d: boolean; cfg: string[] | null; a: boolean; u: boolean; s: boolean }>(
      `SELECT p.prosecdef AS d, p.proconfig AS cfg, has_function_privilege('anon', p.oid, 'EXECUTE') AS a,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS u, has_function_privilege('service_role', p.oid, 'EXECUTE') AS s
         FROM pg_proc p WHERE p.oid = 'public.account_erase_personal_data(uuid,text,boolean)'::regprocedure`);
    expect(rows[0]).toMatchObject({ d: true, a: false, u: false, s: true });
    expect(rows[0].cfg?.some((c) => c.startsWith("search_path="))).toBe(true);
  });
});
