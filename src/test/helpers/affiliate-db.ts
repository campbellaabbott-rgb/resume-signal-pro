/**
 * A pglite database holding the affiliate program as the migrations on main
 * leave it, for running the affiliate SQL rather than reading it.
 *
 * Built from Supabase's default grants (anon and authenticated get ALL on new
 * tables and EXECUTE on new functions unless a migration takes it back), with
 * pgcrypto in the `extensions` schema where Supabase keeps it, then the real
 * files in order: the affiliate tables and functions (20251221233709 and its
 * December fixes), the sign-in writers and the per-address write budget as
 * 20261004110000 defines them (sliced out of that file, which also touches
 * tables this harness does not hold), the payout requests (20261008124000,
 * 20261008126000) and the conversion rules (20261011211000, 20261103100000).
 * The tables those files meet but do not create (checkout_buyers,
 * product_deliveries, payment_revocations) are stand-ins with the columns
 * the affiliate code reads.
 *
 * `bootAffiliateDb({ round: true })` then applies this round's affiliate
 * files (stamps 20261112120000-20261112129999) found on disk, each twice, as
 * a re-run on the live database would.
 */
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { CRON_STAND_IN } from "./mail-door-db";

const MIG_DIR = resolve(__dirname, "../../../supabase/migrations");

export function affiliateMigration(stamp: string): string {
  const f = readdirSync(MIG_DIR).find((n) => n.startsWith(`${stamp}_`));
  if (!f) throw new Error(`no migration ${stamp}`);
  return readFileSync(resolve(MIG_DIR, f), "utf8");
}

/** This round's affiliate files on disk, in stamp order. */
export function roundAffiliateFiles(): string[] {
  return readdirSync(MIG_DIR)
    .filter((n) => /^2026111212\d{4}_/.test(n))
    .sort();
}

/** The text of `sql` from the first `from` marker up to (not including) `to`. */
function slice(sql: string, from: string, to: string): string {
  const a = sql.indexOf(from);
  const b = sql.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error(`affiliate-db: marker not found (${from.slice(0, 40)} .. ${to.slice(0, 40)})`);
  return sql.slice(a, b);
}

const DEFAULTS = `
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE SCHEMA extensions;
  CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
  GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
  CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
`;

const STAND_INS = `
  CREATE TABLE public.checkout_buyers (stripe_session_id text PRIMARY KEY, user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    checkout_function text NOT NULL, product_type text, created_at timestamptz NOT NULL DEFAULT now());
  ALTER TABLE public.checkout_buyers ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON public.checkout_buyers FROM PUBLIC, anon, authenticated;
  CREATE TABLE public.product_deliveries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), stripe_session_id text NOT NULL, product_type text NOT NULL,
    product_name text, customer_email text NOT NULL, status text NOT NULL DEFAULT 'payment_received', amount_cents integer,
    metadata jsonb, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.payment_revocations (payment_intent_id text PRIMARY KEY, reason text NOT NULL, stripe_event_id text, stripe_session_id text,
    product_type text, email text, user_id uuid, subscription_id text, paid_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
`;

export async function bootAffiliateDb(opts: { round?: boolean; cron?: boolean; only?: string[] } = {}): Promise<PGlite> {
  const db = new PGlite({ extensions: { pgcrypto } });
  // Supabase's roles see extensions on their search_path; so does this session.
  await db.exec(DEFAULTS);
  await db.exec("SET search_path = public, extensions;");
  if (opts.cron) await db.exec(CRON_STAND_IN);
  for (const stamp of ["20251221233709", "20251221235517", "20251222194101", "20251222195155"]) {
    await db.exec(affiliateMigration(stamp));
  }
  // 20260827131500 left record_affiliate_conversion one overload: the
  // December four-argument one is gone.
  await db.exec("DROP FUNCTION public.record_affiliate_conversion(text, text, text, integer);");
  const census = affiliateMigration("20261004110000");
  await db.exec(slice(census, "CREATE OR REPLACE FUNCTION public.request_client_address()", "-- ── 1c."));
  await db.exec(slice(census, "CREATE OR REPLACE FUNCTION public.track_affiliate_click(", "-- ── 1d."));
  await db.exec(STAND_INS);
  for (const stamp of ["20261008124000", "20261008126000", "20261011211000", "20261103100000"]) {
    await db.exec(affiliateMigration(stamp));
  }
  if (opts.round) await applyRound(db, opts.only);
  return db;
}

/** Apply this round's affiliate files on disk (or the stamps in `only`), each twice. */
export async function applyRound(db: PGlite, only?: string[]): Promise<void> {
  const files = roundAffiliateFiles().filter((f) => !only || only.some((s) => f.startsWith(s)));
  for (const f of files) {
    const sql = readFileSync(resolve(MIG_DIR, f), "utf8");
    await db.exec(sql);
    await db.exec(sql);
  }
}

/** Run the next statements as if PostgREST had received them from `ip`. */
export async function fromAddress(db: PGlite, ip: string | null): Promise<void> {
  const headers = ip === null ? "" : JSON.stringify({ "cf-connecting-ip": ip });
  await db.query("SELECT set_config('request.headers', $1, false)", [headers]);
}

export async function q<T = Record<string, unknown>>(db: PGlite, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

export async function one<T = Record<string, unknown>>(db: PGlite, sql: string, params: unknown[] = []): Promise<T> {
  const r = await q<T>(db, sql, params);
  return r[0];
}
