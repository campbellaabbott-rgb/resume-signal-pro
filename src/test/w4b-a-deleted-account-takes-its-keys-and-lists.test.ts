// @vitest-environment node
/**
 * A DELETED ACCOUNT TAKES ITS KEYS AND LISTS, A PROVEN MAILBOX COUNTS WHERE
 * PLANS ARE READ, AND SHORTLIST RECORDS NO SEX OR RACE (migrations
 * 20261011170000 and 20261011171000; S12-153, CP-047, CP-048, D9, D14).
 *
 * Run, not read: both files are applied to a real Postgres (pglite) from
 * Supabase's default grants, twice, the first time before R1's proof table
 * exists (wave 4 may apply first), then R1's 20261014110000, then again.
 *   - account_erase_personal_data revokes the account's keys and blanks their
 *     address; touches the address's rows only with a proof; then deletes the
 *     key requests, the pulse row, the leads and the unsubscribe token and
 *     adds a do-not-mail entry; never touches another account's key; is closed
 *     to the client roles;
 *   - account_mailbox_proven counts R1's proof row for the CURRENT address,
 *     and the site's reader (_shared/account-proof.ts) answers the same on the
 *     same database;
 *   - shortlist_demographics can no longer be written by a signed-in user.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { PgSupabase } from "./helpers/pglite-supabase";
import { accountProvenEmail } from "../../supabase/functions/_shared/account-proof";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const DIR = resolve(__dirname, "../../supabase/migrations");
const file = (prefix: string) => {
  const f = readdirSync(DIR).find((n) => n.startsWith(prefix));
  if (!f) throw new Error(`no migration ${prefix}`);
  return readFileSync(resolve(DIR, f), "utf8");
};
const ERASE = file("20261011170000_");
const SHORTLIST_CLOSED = file("20261011171000_");
const R1_PROOFS = file("20261014110000_");
const SHORTLIST = file("20260703120000_");

const STAND_INS = `
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE SCHEMA auth;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, encrypted_password varchar(255) DEFAULT '',
    email_confirmed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE auth.identities (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    provider text NOT NULL, identity_data jsonb NOT NULL DEFAULT '{}');
  CREATE TABLE auth.audit_log_entries (instance_id uuid, id uuid PRIMARY KEY, payload json, created_at timestamptz, ip_address varchar(64) NOT NULL DEFAULT '');
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

  CREATE TABLE public.api_keys (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key_hash text NOT NULL UNIQUE, key_prefix text NOT NULL,
    name text NOT NULL, owner_email text NOT NULL, tier text NOT NULL DEFAULT 'trial', rate_per_min int NOT NULL DEFAULT 60,
    daily_quota int NOT NULL DEFAULT 1000, created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz,
    revoked_at timestamptz, notes text, user_id uuid);
  CREATE TABLE public.api_key_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, mailbox text NOT NULL,
    token_hash text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
    issued_key_id uuid REFERENCES public.api_keys(id) ON DELETE SET NULL);
  CREATE TABLE public.market_pulse_subscribers (email text PRIMARY KEY, industry text NOT NULL DEFAULT 'general', subscribed_at timestamptz NOT NULL DEFAULT now(), unsubscribed_at timestamptz);
  CREATE TABLE public.free_scan_leads (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, industry text, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.email_unsubscribe_tokens (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), token text NOT NULL UNIQUE, email text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), used_at timestamptz);
  CREATE TABLE public.suppressed_emails (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE,
    reason text NOT NULL CHECK (reason IN ('unsubscribe', 'bounce', 'complaint')), metadata jsonb, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.mailbox_proof_settings (id boolean PRIMARY KEY DEFAULT true CHECK (id), confirmation_required_since timestamptz, updated_at timestamptz NOT NULL DEFAULT now());
  INSERT INTO public.mailbox_proof_settings (id) VALUES (true);
`;

/** PostgREST as the service role. */
class ServiceRoleDb extends PgSupabase {
  override async run(sql: string, params: unknown[] = []) {
    try {
      const rows = await this.db.transaction(async (tx) => {
        await tx.exec("SET LOCAL ROLE service_role");
        return (await tx.query<Record<string, unknown>>(sql, params)).rows;
      });
      return { rows, error: null };
    } catch (e) {
      const err = e as { code?: string; message?: string };
      return { rows: [] as Record<string, unknown>[], error: { code: err.code, message: String(err.message ?? e) } };
    }
  }
}

const A = "00000000-0000-4000-8000-00000000aaa1";
const B = "00000000-0000-4000-8000-00000000bbb2";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const passwordJwt = (sub: string) => `${b64({ alg: "none" })}.${b64({ sub, role: "authenticated", aud: "authenticated", amr: [{ method: "password", timestamp: 1 }] })}.sig`;

let pg: PGlite;
let svc: ServiceRoleDb;
let proofsApplied = false;

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(STAND_INS);
  await pg.exec(SHORTLIST);
  // Before R1's proof table: wave 4 may apply first. Twice: safe to re-run.
  await pg.exec(ERASE);
  await pg.exec(ERASE);
  await pg.exec(SHORTLIST_CLOSED);
  await pg.exec(SHORTLIST_CLOSED);
  svc = new ServiceRoleDb(pg);
}, 180_000);

afterAll(async () => { try { await pg.close(); } catch { /* best effort */ } });

beforeEach(async () => {
  await pg.exec(`
    DELETE FROM public.api_key_requests; DELETE FROM public.api_keys; DELETE FROM public.market_pulse_subscribers;
    DELETE FROM public.free_scan_leads; DELETE FROM public.email_unsubscribe_tokens; DELETE FROM public.suppressed_emails;
    DELETE FROM auth.identities; DELETE FROM auth.users;
  `);
  if (proofsApplied) await pg.exec(`DELETE FROM public.account_mailbox_proofs;`);
  await pg.exec(`INSERT INTO auth.users (id, email) VALUES ('${A}', 'leaving@example.com'), ('${B}', 'staying@example.com');`);
  await pg.exec(`
    INSERT INTO public.api_keys (key_hash, key_prefix, name, owner_email, tier, user_id) VALUES
      ('h-a-connector', 'rb_live_a1', 'Claude', 'leaving@example.com', 'free', '${A}'),
      ('h-a-typed', 'rb_live_a2', 'dev key', 'Leaving@Example.com', 'free', NULL),
      ('h-b', 'rb_live_b1', 'B key', 'staying@example.com', 'free', '${B}');
    INSERT INTO public.api_key_requests (email, mailbox, token_hash, expires_at) VALUES ('leaving@example.com', 'leaving@example.com', 't1', now() + interval '1 day');
    INSERT INTO public.market_pulse_subscribers (email) VALUES ('leaving@example.com'), ('staying@example.com');
    INSERT INTO public.free_scan_leads (email) VALUES ('leaving@example.com');
    INSERT INTO public.email_unsubscribe_tokens (token, email) VALUES ('tok-a', 'leaving@example.com');
  `);
});

const keys = async () => (await pg.query<{ key_hash: string; revoked: boolean; owner_email: string | null }>(
  `SELECT key_hash, revoked_at IS NOT NULL AS revoked, owner_email FROM public.api_keys ORDER BY key_hash`)).rows;
const count = async (sql: string) => (await pg.query<{ n: number }>(sql)).rows[0].n;

describe("account_erase_personal_data", () => {
  it("without a proof: the account's own key is revoked and blanked, the address's rows are untouched", async () => {
    const r = await svc.rpc("account_erase_personal_data", { p_user_id: A, p_email: "leaving@example.com", p_email_proven: false });
    expect(r.error).toBeNull();
    expect(r.data).toMatchObject({ keys_revoked: 1, by_address: false });
    expect(await keys()).toEqual([
      { key_hash: "h-a-connector", revoked: true, owner_email: null },
      { key_hash: "h-a-typed", revoked: false, owner_email: "Leaving@Example.com" },
      { key_hash: "h-b", revoked: false, owner_email: "staying@example.com" },
    ]);
    expect(await count(`SELECT count(*)::int AS n FROM public.market_pulse_subscribers WHERE email = 'leaving@example.com'`)).toBe(1);
    expect(await count(`SELECT count(*)::int AS n FROM public.suppressed_emails`)).toBe(0);
  });

  it("with a proof: the address's keys, key requests, pulse row, leads and token go, and queued mail is stopped", async () => {
    const r = await svc.rpc("account_erase_personal_data", { p_user_id: A, p_email: "Leaving@example.com", p_email_proven: true });
    expect(r.data).toMatchObject({ keys_revoked: 2, by_address: true, key_requests_deleted: 1, pulse_rows_deleted: 1, lead_rows_deleted: 1, unsubscribe_tokens_deleted: 1, do_not_mail_added: true });
    expect((await keys()).filter((k) => k.key_hash.startsWith("h-a")).every((k) => k.revoked && k.owner_email === null)).toBe(true);
    expect((await keys()).find((k) => k.key_hash === "h-b")).toEqual({ key_hash: "h-b", revoked: false, owner_email: "staying@example.com" });
    expect(await count(`SELECT count(*)::int AS n FROM public.market_pulse_subscribers`)).toBe(1);
    expect((await pg.query(`SELECT email, reason FROM public.suppressed_emails`)).rows).toEqual([{ email: "leaving@example.com", reason: "unsubscribe" }]);
    // Again: nothing left to do, and no error.
    const again = await svc.rpc("account_erase_personal_data", { p_user_id: A, p_email: "leaving@example.com", p_email_proven: true });
    expect(again.error).toBeNull();
    expect(again.data).toMatchObject({ key_requests_deleted: 0, do_not_mail_added: false });
  });

  it("is a definer with a fixed search_path, refused to both client roles", async () => {
    for (const fn of ["account_erase_personal_data(uuid,text,boolean)", "account_mailbox_proven(uuid)"]) {
      const { rows } = await pg.query<{ d: boolean; cfg: string[] | null; a: boolean; u: boolean; s: boolean }>(
        `SELECT p.prosecdef AS d, p.proconfig AS cfg, has_function_privilege('anon', p.oid, 'EXECUTE') AS a,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') AS u, has_function_privilege('service_role', p.oid, 'EXECUTE') AS s
           FROM pg_proc p WHERE p.oid = $1::regprocedure`, [`public.${fn}`]);
      expect(rows[0], fn).toMatchObject({ d: true, a: false, u: false, s: true });
      expect(rows[0].cfg?.some((c) => c.startsWith("search_path=")), fn).toBe(true);
    }
  });
});

describe("account_mailbox_proven and the site's reader read one rule", () => {
  const sql = async (uid: string) => (await pg.query<{ p: boolean }>(`SELECT public.account_mailbox_proven($1) AS p`, [uid])).rows[0].p;
  // A fresh client per question: the harness caches a table's columns, and the table appears mid-describe.
  const site = async (uid: string, email: string) => accountProvenEmail({ id: uid, email }, passwordJwt(uid), { db: new ServiceRoleDb(pg), supabaseUrl: "" });

  it("before R1's table exists: no proof, and no error", async () => {
    expect(await sql(A)).toBe(false);
    expect(await site(A, "leaving@example.com")).toBeNull();
  });

  it("after it: a proof row for the current address counts in both; one for an old address counts in neither", async () => {
    await pg.exec(R1_PROOFS);
    await pg.exec(ERASE);
    proofsApplied = true;
    await pg.exec(`INSERT INTO public.account_mailbox_proofs (user_id, email, method, amr_at) VALUES ('${A}', 'leaving@example.com', 'otp', now()), ('${B}', 'old@example.com', 'otp', now())`);
    expect(await sql(A)).toBe(true);
    expect(await site(A, "leaving@example.com")).toBe("leaving@example.com");
    expect(await sql(B)).toBe(false);
    expect(await site(B, "staying@example.com")).toBeNull();
  });

  it("a Google identity that verified the address still counts, unchanged", async () => {
    await pg.exec(`INSERT INTO auth.identities (user_id, provider, identity_data) VALUES ('${B}', 'google', '{"email":"staying@example.com","email_verified":true}')`);
    expect(await sql(B)).toBe(true);
  });
});

describe("shortlist_demographics is closed to new data", () => {
  it("a signed-in owner can no longer insert or update a candidate's sex or race", async () => {
    await expect(pg.transaction(async (tx) => {
      await tx.exec("SET LOCAL ROLE authenticated");
      await tx.query(`INSERT INTO public.shortlist_demographics (candidate_id, owner_id, sex) VALUES (gen_random_uuid(), '${A}', 'Female')`);
    })).rejects.toThrow(/permission denied/);
    const { rows } = await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_policies WHERE tablename = 'shortlist_demographics' AND cmd IN ('INSERT','UPDATE')`);
    expect(rows[0].n).toBe(0);
  });
});
