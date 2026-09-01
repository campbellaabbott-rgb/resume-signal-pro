import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync } from "node:fs";
const db = new PGlite({ extensions: { pg_trgm } });
await db.exec(`
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, source text, company_token text, company text, title text,
    location text, country text, remote boolean, work_mode text, employment_type text,
    department text, category text, posted_at timestamptz, apply_url text, salary text,
    salary_min_annual numeric, salary_max_annual numeric, salary_period text, salary_currency text,
    experience_band text, min_years integer, last_seen timestamptz, description text,
    effective_posted timestamptz, missing_since timestamptz, agency boolean NOT NULL DEFAULT false,
    salary_rank_usd numeric, title_tsv tsvector, search_tsv tsvector
  );
  INSERT INTO public.job_board_postings (id, source, company, title, location, effective_posted, last_seen, title_tsv)
  VALUES ('a','greenhouse','Mercy','Registered Nurse','New York, NY', now(), now(), to_tsvector('english','Registered Nurse'));
`);
await db.exec(readFileSync("supabase/migrations/20260901090000_the_opt_out_stops_costing_the_ranking.sql","utf8"));
const before = await db.query(`SELECT count(*)::int n FROM public.fuzzy_title_search('nurse', (now() - interval '30 days'), 10, 'New York|NYC|Manhattan')`);
console.log("case1 BEFORE the fix (pipe list):", before.rows[0].n, "rows  <- 0 proves the reverted bug");
await db.exec(readFileSync("supabase/migrations/20260901200000_a_pipe_is_still_not_a_place.sql","utf8"));
const after = await db.query(`SELECT count(*)::int n FROM public.fuzzy_title_search('nurse', (now() - interval '30 days'), 10, 'New York|NYC|Manhattan')`);
console.log("case2 AFTER the fix (pipe list):", after.rows[0].n, "rows  <- >0 proves it is repaired");
const plain = await db.query(`SELECT count(*)::int n FROM public.fuzzy_title_search('nurse', (now() - interval '30 days'), 10, 'New York')`);
console.log("case3 single location still works:", plain.rows[0].n, "rows");
const miss = await db.query(`SELECT count(*)::int n FROM public.fuzzy_title_search('nurse', (now() - interval '30 days'), 10, 'Boston|Cambridge')`);
console.log("case4 non-matching location excludes:", miss.rows[0].n, "rows  <- must be 0");
const g = await db.query(`SELECT has_function_privilege('service_role', oid, 'EXECUTE') svc, has_function_privilege('anon', oid, 'EXECUTE') anon FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fuzzy_title_search'`);
console.log("case5 grants:", JSON.stringify(g.rows));
const dup = await db.query(`SELECT count(*)::int n FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='fuzzy_title_search'`);
console.log("case6 exactly one signature:", dup.rows[0].n);
