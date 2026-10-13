/**
 * A REAL POSTGRES FOR THE MATCH TESTS: the board's postings table as the search
 * RPCs see it, Supabase's default grants, and the shipped migrations.
 *
 * The four 20261016* files run here exactly as they ship. Supabase grants ALL
 * on every new table and EXECUTE on every new function to anon and
 * authenticated by default, and a GRANT never takes that away; the stand-in
 * starts from those defaults (agent-db.ts's rule), so a migration whose REVOKE
 * missed a role fails its own DO block here as it would live.
 *
 * geo_places gets a handful of places with real coordinates for the ring tests
 * (rounded from public gazetteers; enough to tell Columbus, OH from Columbus,
 * GA). The production rows come from GeoNames through
 * scripts/match/build-geo-seed.mjs.
 */
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../../../..");
const MIG = resolve(ROOT, "supabase/migrations");
export const migrationText = (prefix: string): string => {
  const f = readdirSync(MIG).find((x) => x.startsWith(prefix));
  if (!f) throw new Error(`no migration ${prefix}`);
  return readFileSync(resolve(MIG, f), "utf8");
};
export const MATCH_MIGRATIONS = ["20261016100000", "20261016101000", "20261016102000", "20261016103000"];

export const POSTINGS_TABLE = `
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, source text, company_token text, company text, title text,
    location text, country text, remote boolean, work_mode text, employment_type text,
    department text, category text, posted_at timestamptz, apply_url text, salary text,
    salary_min_annual numeric, salary_max_annual numeric, salary_period text, salary_currency text,
    experience_band text, min_years integer, last_seen timestamptz, description text,
    effective_posted timestamptz, missing_since timestamptz, agency boolean NOT NULL DEFAULT false,
    title_tsv tsvector GENERATED ALWAYS AS (
      setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(company, '')), 'B')) STORED,
    search_tsv tsvector GENERATED ALWAYS AS (
      setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(company, '')), 'B') ||
      setweight(to_tsvector('english', left(coalesce(description, ''), 4000)), 'D')) STORED,
    salary_rank_usd numeric
  );
  CREATE INDEX job_board_postings_location_trgm_idx ON public.job_board_postings USING gin (location gin_trgm_ops);
  CREATE INDEX job_board_postings_title_tsv_idx ON public.job_board_postings USING gin (title_tsv);
  CREATE INDEX job_board_postings_title_simple_fts_idx ON public.job_board_postings USING gin (to_tsvector('simple', title));
`;

/** The limiter and the board meter resume-match calls before any work (stand-ins with the live signatures). */
export const LIMITERS = `
  CREATE TABLE public.rate_limits (
    ip_address text NOT NULL, function_name text NOT NULL, request_count int DEFAULT 1,
    window_start timestamptz DEFAULT now(), PRIMARY KEY (ip_address, function_name)
  );
  CREATE TABLE public.match_test_blocked (bucket text PRIMARY KEY);
  CREATE FUNCTION public.job_board_anon_check(
    p_bucket text, p_kind text, p_country text, p_address_cap integer, p_build_cap integer, p_probe_cap integer,
    p_bare boolean DEFAULT false, p_net text DEFAULT NULL, p_pass text DEFAULT NULL, p_pass_id text DEFAULT NULL)
  RETURNS TABLE (is_allowed boolean, used_today integer, over_today integer, cap_today integer, country_rule boolean,
    enforcing boolean, network_rule boolean, pass_rule boolean)
  LANGUAGE sql AS $$
    SELECT NOT EXISTS (SELECT 1 FROM public.match_test_blocked b WHERE b.bucket = p_net), 1, 0, p_address_cap, false, true,
      EXISTS (SELECT 1 FROM public.match_test_blocked b WHERE b.bucket = p_net), false $$;
`;

/** [name, region, regionName, country, lat, lon, population] */
export const PLACES: Array<[string, string, string, string, number, number, number]> = [
  ["Columbus", "OH", "Ohio", "US", 39.9612, -82.9988, 905748],
  ["Westerville", "OH", "Ohio", "US", 40.1262, -82.9291, 39190],
  ["Dublin", "OH", "Ohio", "US", 40.0992, -83.1141, 49328],
  ["Grove City", "OH", "Ohio", "US", 39.8815, -83.093, 41252],
  ["Gahanna", "OH", "Ohio", "US", 40.0192, -82.8793, 35483],
  ["Delaware", "OH", "Ohio", "US", 40.2987, -83.068, 41302],
  ["Newark", "OH", "Ohio", "US", 40.0581, -82.4013, 49934],
  ["Columbus", "GA", "Georgia", "US", 32.461, -84.9877, 206922],
  ["Phenix City", "AL", "Alabama", "US", 32.4709, -85.0008, 38816],
  ["Dublin", "L", "Leinster", "IE", 53.3331, -6.2489, 1024027],
  ["Phoenix", "AZ", "Arizona", "US", 33.4484, -112.074, 1608139],
  ["Mesa", "AZ", "Arizona", "US", 33.4152, -111.8315, 504258],
  ["Tempe", "AZ", "Arizona", "US", 33.4255, -111.94, 180587],
  ["Detroit", "MI", "Michigan", "US", 42.3314, -83.0458, 639111],
  ["Windsor", "ON", "Ontario", "CA", 42.3149, -83.0364, 229660],
];

export async function bootMatchDb(opts: { migrations?: boolean; places?: boolean } = {}): Promise<PGlite> {
  const db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(POSTINGS_TABLE);
  await db.exec(LIMITERS);
  await db.exec(migrationText("20261009110000"));
  if (opts.migrations !== false) for (const m of MATCH_MIGRATIONS) await db.exec(migrationText(m));
  if (opts.places !== false && opts.migrations !== false) {
    let id = 1;
    for (const [name, region, regionName, country, lat, lon, pop] of PLACES) {
      await db.query(
        `INSERT INTO public.geo_places (geonameid, name, ascii_name, country, admin1_code, region, region_name, lat, lon, population)
         VALUES ($1, $2, $2, $3, $4, $4, $5, $6, $7, $8)`,
        [id++, name, country, region, regionName, lat, lon, pop],
      );
    }
  }
  return db;
}

export interface Posting {
  id: string; title: string; location: string | null; country: string | null;
  source?: string; company?: string; company_token?: string; remote?: boolean | null; work_mode?: string | null;
  description?: string | null; min_years?: number | null; experience_band?: string | null;
  ageDays?: number; missing?: boolean; posted_at?: string | null;
}

export async function addPostings(db: PGlite, rows: Posting[]): Promise<void> {
  for (const r of rows) {
    const age = r.ageDays ?? 2;
    await db.query(
      `INSERT INTO public.job_board_postings (id, source, company_token, company, title, location, country, remote, work_mode,
         description, min_years, experience_band, posted_at, effective_posted, last_seen, missing_since)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now() - make_interval(days => $13), now() - make_interval(days => $13), now(),
         CASE WHEN $14 THEN now() ELSE NULL END)`,
      [r.id, r.source ?? "greenhouse", r.company_token ?? (r.company ?? "acme").toLowerCase().replace(/\W+/g, ""), r.company ?? "Acme",
        r.title, r.location, r.country, r.remote ?? false, r.work_mode ?? null, r.description ?? null, r.min_years ?? null,
        r.experience_band ?? null, age, r.missing === true],
    );
  }
}
