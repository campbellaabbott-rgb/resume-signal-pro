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
-- search_jobs, so I took the function's latest definition by MIGRATION
-- FILENAME ORDER and CREATE OR REPLACE'd it with that line changed. The
-- database's actual function has a FIFTEENTH parameter, p_sources, added for
-- the agent-sendable filter — and that version exists ONLY in the database. No
-- migration in this repo defines it. So my statement did not replace anything:
-- a different parameter list makes a NEW OVERLOAD, and PostgREST then has two
-- candidates and refuses to pick.
--
-- THE RULE I BROKE IS ALREADY WRITTEN DOWN, in the ops runbook, in these words:
-- "MIGRATION FILENAME ORDER DOES NOT TRACK WHAT IS DEPLOYED... ALWAYS confirm a
-- function's live shape (call the RPC, or read the cached row it feeds) before
-- rewriting it from a repo file." I read the repo and not the database. One
-- probe of the live function would have shown fifteen parameters.
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
