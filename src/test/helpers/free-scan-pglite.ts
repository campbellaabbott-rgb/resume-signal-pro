/**
 * THE TABLES THE FREE-SCAN-ENGINE MIGRATION READS, IN A REAL POSTGRES (pglite).
 *
 * Starts from Supabase's default grants (anon, authenticated and service_role
 * get ALL on new tables and EXECUTE on new functions), so a function the
 * migration means to close is proven closed against the defaults it ships
 * into. client_write_allowed is a stand-in that RECORDS each call, so a test
 * can prove a refused label returned before the address's budget was read.
 */
import { PGlite } from "@electric-sql/pglite";
import { migFile } from "./fixed-clock-sql";

export const FSE_MIGRATION = "20261112170000_a_scan_that_delivered_nothing_gives_its_day_back_and_a_stranger_names_no_new_industry.sql";

export async function freeScanDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    CREATE TABLE public.rate_limits (
      ip_address text NOT NULL, function_name text NOT NULL,
      request_count integer NOT NULL DEFAULT 1, window_start timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (ip_address, function_name));
    CREATE TABLE public.industry_corrections (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      original_industry text NOT NULL, corrected_industry text NOT NULL,
      original_confidence text, detection_source text, resume_text_length integer, server_signals text[],
      ai_suggested_industry text, visitor_id text, ip_country text,
      created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE public.scan_metrics (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      scan_type text, status text, duration_ms integer, cache_hit boolean DEFAULT false, ai_model text,
      error_code text, ip_country text, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE public.heartbeat_results (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), function_name text, status text,
      created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE public.client_write_calls (n serial PRIMARY KEY, bucket text);
    CREATE FUNCTION public.client_write_allowed(p_bucket text, p_a integer, p_b integer, p_c integer)
    RETURNS boolean LANGUAGE sql AS $$ INSERT INTO public.client_write_calls (bucket) VALUES (p_bucket) RETURNING true $$;
  `);
  return db;
}

/** freeScanDb with the lane's migration applied twice (it must re-run cleanly). */
export async function freeScanDbMigrated(): Promise<PGlite> {
  const db = await freeScanDb();
  const sql = migFile(FSE_MIGRATION);
  await db.exec(sql);
  await db.exec(sql);
  return db;
}

/** The one value a single-row, single-column query returns. */
export async function one<T>(db: PGlite, sql: string, params: unknown[] = []): Promise<T> {
  const r = await db.query<Record<string, T>>(sql, params);
  return Object.values(r.rows[0] ?? {})[0] as T;
}
