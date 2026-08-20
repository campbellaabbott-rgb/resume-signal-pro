-- I BROKE RANKED SEARCH BY REWRITING A FUNCTION FROM A STALE REPO FILE.
--
-- LIVE RIGHT NOW: both search_jobs and count_jobs_capped return
-- PGRST203 "Could not choose the best candidate function". Every ranked search
-- errors and falls through to the recency ILIKE path, and every capped count
-- fails. The board still returns rows — which is why the earlier verification
-- looked fine — but the search ENGINE is bypassed, and with it the fuzzy and
-- semantic rescue tiers that live on that path. Measured symptom: "enginer",
-- "acountant" and "nures" all return ZERO with total null, while
-- fuzzy_title_search answers those same typos correctly in isolation
-- ("enginer" -> Engineer, "acountant" -> Accountant).
--
-- WHAT I DID. The metro-alias migration needed to edit one line inside
-- search_jobs, so I searched the migrations for the create-or-replace spelling
-- of that function, took the newest hit, and re-issued it with the line
-- changed. That newest hit was a FOURTEEN-parameter definition from July 29.
--
-- THE DEPLOYED FUNCTION HAS FIFTEEN PARAMETERS. p_sources was added on
-- August 7 by 20260807064219 for the agent-sendable filter. I first recorded
-- here that no migration in this repo declared it; THAT WAS WRONG, and the
-- truth is worse. It is declared, in the repo, in a file I had read — but that
-- file spells the statement "CREATE FUNCTION", not "CREATE OR REPLACE
-- FUNCTION", deliberately, because it is creating a new signature rather than
-- replacing one. My search matched only the create-or-replace spelling, so the
-- ONE migration that defines the live shape was invisible to it, and the newest
-- visible definition was six weeks stale. The defect was in my grep.
--
-- A different parameter list does not replace a function, it OVERLOADS it. So
-- PostgREST had two candidates and refused to choose.
--
-- THE AUGUST 7 MIGRATION SAYS SO IN ITS OWN HEADER, and dropped the
-- fourteen-parameter version on purpose for exactly this reason:
--
--     "DROP + CREATE, not CREATE OR REPLACE: adding a parameter would
--      otherwise create an OVERLOAD, and a PostgREST call that omits every
--      optional param then matches both signatures and 400s as ambiguous."
--
-- I put back the thing it had removed, and re-created the failure it had
-- already reasoned its way out of.
--
-- THE RULE IS ALSO IN THE OPS RUNBOOK: "MIGRATION FILENAME ORDER DOES NOT TRACK
-- WHAT IS DEPLOYED... ALWAYS confirm a function's live shape before rewriting
-- it from a repo file." One probe of the live function would have shown fifteen
-- parameters. I read the repo instead, and read it with the wrong pattern.
--
-- WHY THIS IS SAFE, verified rather than assumed: p_sources is declared
-- "text[] DEFAULT NULL", and the body guards it with "IF p_sources IS NOT NULL
-- THEN". So once the fourteen-parameter overload is gone, the edge function's
-- fourteen-argument call binds to the fifteen-parameter function with
-- p_sources defaulting to NULL, which applies no source filter. Confirmed
-- against production before shipping: an explicit fifteen-argument call with a
-- real p_fresh_cutoff returns rows, and p_sources => NULL does not filter them.
-- (An empty ARRAY does filter everything out, but sendableSourcesParam omits
-- the key entirely rather than sending [], so that path is unreachable.)
--
-- THE FIX IS TO DROP WHAT I ADDED, NOT TO REWRITE ANYTHING. The 15-parameter
-- versions are intact and correct; removing my overloads leaves exactly one
-- candidate and search resolves again. I deliberately do NOT attempt to
-- recreate the real definitions here — I do not have their bodies, and guessing
-- at the body of a working function is what caused this.
--
-- The metro-alias location fix is REVERTED with them, on purpose. It has to be
-- re-applied to the fifteen-parameter definition, which means first reading
-- that definition out of the database (pg_get_functiondef) rather than out of
-- this repo. Losing the improvement for a day is much cheaper than leaving
-- search degraded while I chase it.
--
-- Signatures are spelled out in full because that is what identifies an
-- overload; dropping "search_jobs" by name alone would be ambiguous in exactly
-- the way that caused this.

DROP FUNCTION IF EXISTS public.search_jobs(
  p_q text,
  p_fresh_cutoff timestamptz,
  p_location text,
  p_remote boolean,
  p_country text,
  p_category text,
  p_experience text[],
  p_salary_floor numeric,
  p_companies text[],
  p_posted_after timestamptz,
  p_max_age_days integer,
  p_work_mode text,
  p_limit integer,
  p_offset integer
);

DROP FUNCTION IF EXISTS public.count_jobs_capped(
  p_fresh_cutoff timestamptz,
  p_q text,
  p_location text,
  p_remote boolean,
  p_country text,
  p_category text,
  p_experience text[],
  p_salary_floor numeric,
  p_companies text[],
  p_posted_after timestamptz,
  p_max_age_days integer,
  p_work_mode text,
  p_cap integer
);
