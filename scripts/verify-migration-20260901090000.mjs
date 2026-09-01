// Reproducible verification for 20260901090000, run against a real Postgres
// in-process (PGlite) rather than asserted.
//
// WHY THIS FILE EXISTS AT ALL. Several migrations in this repo carry a claim
// that they were "pglite-verified three ways", and on 2026-09-01 that claim
// turned out to be unreproducible: @electric-sql/pglite had never been a
// dependency of this project, so nothing could have executed them here. The
// package is a devDependency now and the verification is a script anyone can
// re-run, because a verification you cannot repeat is a sentence, not a test.
//
//   node scripts/verify-migration-20260901090000.mjs
//
// Cases: the migration applies; the ranked function returns the disclosure
// column; the opt-out actually removes agency rows; the capped count respects
// it; re-applying leaves exactly one signature per function (a second
// overload is PGRST203 on every call); and DROP-discarded grants are restored
// with the definer posture intact — service_role executes, anon does not.
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync } from "node:fs";
const mig = readFileSync("supabase/migrations/20260901090000_the_opt_out_stops_costing_the_ranking.sql", "utf8");
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
    title_tsv tsvector, search_tsv tsvector, salary_rank_usd numeric, embedding text, embedded_desc boolean
  );
  INSERT INTO public.job_board_postings (id, source, company, title, agency, effective_posted, last_seen, title_tsv, search_tsv)
  VALUES
    ('a','greenhouse','Real Hospital','Registered Nurse', false, now(), now(), to_tsvector('english','Registered Nurse'), to_tsvector('english','Registered Nurse')),
    ('b','workable','Staffing Firm','Registered Nurse', true,  now(), now(), to_tsvector('english','Registered Nurse'), to_tsvector('english','Registered Nurse'));
`);
await db.exec(mig);
console.log("case1 migration applies: OK");

const q = `websearch_to_tsquery('english','nurse')`;
const cutoff = `(now() - interval '30 days')`;
const all = await db.query(`SELECT id, agency FROM public.search_jobs('nurse', ${cutoff}) ORDER BY id`);
console.log("case2 unfiltered rows:", all.rows.map(r => `${r.id}/agency=${r.agency}`).join(" "));

const filtered = await db.query(`SELECT id, agency FROM public.search_jobs('nurse', ${cutoff}, p_exclude_agencies => true) ORDER BY id`);
console.log("case3 excludeAgencies rows:", filtered.rows.map(r => `${r.id}/agency=${r.agency}`).join(" ") || "(none)");

const cAll = await db.query(`SELECT * FROM public.count_jobs_capped(${cutoff}, 'nurse')`);
const cFil = await db.query(`SELECT * FROM public.count_jobs_capped(${cutoff}, 'nurse', p_exclude_agencies => true)`);
console.log("case4 counts: unfiltered=", JSON.stringify(cAll.rows[0]), " filtered=", JSON.stringify(cFil.rows[0]));

// Idempotence: a re-apply must not leave two overloads standing.
await db.exec(mig);
const overloads = await db.query(`SELECT proname, count(*) n FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('search_jobs','count_jobs_capped') GROUP BY proname ORDER BY proname`);
console.log("case5 re-apply overload counts:", JSON.stringify(overloads.rows));
const g = await db.query(`SELECT proname, has_function_privilege('service_role', oid, 'EXECUTE') AS svc, has_function_privilege('anon', oid, 'EXECUTE') AS anon FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('search_jobs','count_jobs_capped','fuzzy_title_search') ORDER BY proname`);
console.log("case6 grants:", JSON.stringify(g.rows));
