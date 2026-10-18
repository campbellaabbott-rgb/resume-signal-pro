// @vitest-environment node
/**
 * A DELETED ACCOUNT TAKES THE DOCUMENTS MADE FOR IT AND ITS PRO GRANTS
 * (migration 20261011210000; wave 4 round 2 review, security lens; D9,
 * CP-048).
 *
 * WHAT WAS WRONG. delete-account answers kept: ["payment_records"] and the
 * delete card says the same, but account_erase_personal_data (20261011170000)
 * never touched purchased_content (the letters, packages and reports made
 * from the person's résumé, keyed by customer_email, kept 365 days, no
 * user_id, no foreign key) or pro_grants (address, résumé session, job).
 *
 * WHAT HOLDS NOW (run, not read: both files applied to pglite from Supabase's
 * default grants, the new one twice):
 *   - the documents for sessions checkout_buyers binds to the account and for
 *     the account's Pro grants ('pro_' + grant id) are deleted, and the grants;
 *   - the address's documents and grants go only with a proven address;
 *   - payment records (product_deliveries) and another person's document stay;
 *   - the function is still a definer with a fixed search_path, refused to
 *     both client roles.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const DIR = resolve(__dirname, "../../supabase/migrations");
const file = (prefix: string) => {
  const f = readdirSync(DIR).find((n) => n.startsWith(prefix));
  if (!f) throw new Error(`no migration ${prefix}`);
  return readFileSync(resolve(DIR, f), "utf8");
};
const ERASE = file("20261011170000_");
const ERASE_DOCS = file("20261011210000_");

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
  CREATE TABLE public.purchased_content (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), stripe_session_id text NOT NULL UNIQUE,
    customer_email text NOT NULL, product_type text NOT NULL, product_name text, generated_content jsonb,
    created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz DEFAULT now() + interval '365 days');
  CREATE TABLE public.pro_grants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, product_id text NOT NULL,
    product_type text, product_name text, resume_session_id text, job_title text, job_company text, user_id uuid, revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.checkout_buyers (stripe_session_id text PRIMARY KEY, user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    checkout_function text NOT NULL, product_type text, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.product_deliveries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), stripe_session_id text, customer_email text, amount_cents int);
`;

const A = "00000000-0000-4000-8000-00000000dd01";
const B = "00000000-0000-4000-8000-00000000dd02";
let pg: PGlite;

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(STAND_INS);
  await pg.exec(ERASE);
  await pg.exec(ERASE_DOCS);
  await pg.exec(ERASE_DOCS);
}, 180_000);

afterAll(async () => { try { await pg.close(); } catch { /* best effort */ } });

let grantA = "";
beforeEach(async () => {
  await pg.exec(`
    DELETE FROM public.purchased_content; DELETE FROM public.pro_grants; DELETE FROM public.checkout_buyers;
    DELETE FROM public.product_deliveries; DELETE FROM public.suppressed_emails; DELETE FROM auth.users;
    INSERT INTO auth.users (id, email) VALUES ('${A}', 'leaving@example.com'), ('${B}', 'staying@example.com');
    INSERT INTO public.checkout_buyers (stripe_session_id, user_id, checkout_function) VALUES
      ('cs_bound_a', '${A}', 'create-checkout'), ('cs_bound_b', '${B}', 'create-checkout');
    INSERT INTO public.product_deliveries (stripe_session_id, customer_email, amount_cents) VALUES ('cs_bound_a', 'typed@example.com', 500);
  `);
  grantA = (await pg.query<{ id: string }>(
    `INSERT INTO public.pro_grants (email, user_id, product_id, resume_session_id, job_title) VALUES ('leaving@example.com', '${A}', 'fullAnalysis', 'sess-1', 'Nurse') RETURNING id`,
  )).rows[0].id;
  await pg.exec(`
    INSERT INTO public.pro_grants (email, user_id, product_id) VALUES ('Leaving@example.com', NULL, 'fullAnalysis'), ('staying@example.com', '${B}', 'fullAnalysis');
    INSERT INTO public.purchased_content (stripe_session_id, customer_email, product_type) VALUES
      ('cs_bound_a', 'typed@example.com', 'full_analysis'),
      ('pro_${grantA}', 'leaving@example.com', 'full_analysis'),
      ('cs_by_address', 'Leaving@Example.com', 'cover_letter'),
      ('cs_bound_b', 'staying@example.com', 'full_analysis');
  `);
});

const sessions = async () => (await pg.query<{ s: string }>(`SELECT stripe_session_id AS s FROM public.purchased_content ORDER BY 1`)).rows.map((r) => r.s);
const grants = async () => (await pg.query<{ e: string }>(`SELECT lower(email) AS e FROM public.pro_grants ORDER BY 1`)).rows.map((r) => r.e);
const erase = async (proven: boolean) => (await pg.query<{ r: Record<string, unknown> }>(
  `SELECT public.account_erase_personal_data($1, 'leaving@example.com', $2) AS r`, [A, proven])).rows[0].r;

describe("account_erase_personal_data takes the documents and the grants", () => {
  it("without a proof: the bound document, the grant's document and the account's grant go; the address's stay", async () => {
    const r = await erase(false);
    expect(r).toMatchObject({ documents_deleted: 2, pro_grants_deleted: 1, by_address: false });
    expect(await sessions()).toEqual(["cs_bound_b", "cs_by_address"]);
    expect(await grants()).toEqual(["leaving@example.com", "staying@example.com"]);
  });

  it("with a proof: the address's documents and grants go too; another person's and the payment record stay", async () => {
    const r = await erase(true);
    expect(r).toMatchObject({ documents_deleted: 3, pro_grants_deleted: 2, by_address: true });
    expect(await sessions()).toEqual(["cs_bound_b"]);
    expect(await grants()).toEqual(["staying@example.com"]);
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
