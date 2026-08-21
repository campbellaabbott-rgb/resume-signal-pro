-- I EXPOSED WHAT VISITORS TYPED INTO THE SEARCH BOX. LIVE, FOR ABOUT AN HOUR.
--
-- MEASURED with the anon key immediately after the deploy:
--   POST /rest/v1/rpc/get_top_search_misses {"p_days":7,"p_limit":5}
--   -> [{"q":"electrician","searches":1,...},{"q":"nurse","searches":1,...}]
-- That function returns RAW QUERY TEXT. The anon key ships inside the frontend
-- bundle, so this was readable by anyone. People type their own names, their
-- employers, their towns and their medical situations into a job search box.
--
-- WHY THE REVOKE DID NOT WORK, which is the whole lesson: I wrote
--   REVOKE ALL ON FUNCTION ... FROM PUBLIC;
--   GRANT EXECUTE ON FUNCTION ... TO service_role;
-- and believed that closed it. It does not. PUBLIC and anon are NOT the same
-- grantee. Supabase grants EXECUTE on public-schema functions to the `anon` and
-- `authenticated` roles directly, so revoking the PUBLIC pseudo-role leaves
-- anon's own grant untouched. The function was DEFINER, so it then read straight
-- through the RLS lock on tables I had just deliberately locked.
--
-- The repo already knew this. The definer-exposure audit recorded "a GRANT
-- doesn't restrict" after finding 107 of 121 definer functions anon-callable,
-- one of which granted paid credits. I wrote the same bug from the other
-- direction — assuming a REVOKE restricts — on the same day.
--
-- WHAT WAS NOT EXPOSED, verified rather than assumed: both raw tables answered
-- HTTP 200 with [] to the anon key, so RLS-with-no-policy held on
-- job_board_search_events and job_board_search_clicks. The leak was only through
-- the DEFINER function, which is precisely how a DEFINER function leaks — by
-- being the one thing that bypasses the lock you just put on.
--
-- A SECOND EXPOSURE, FOUND BY THE GUARD WRITTEN FOR THE FIRST, and it is not
-- mine. public.log_seniority_correction is SECURITY DEFINER, carries the same
-- REVOKE-FROM-PUBLIC-only pattern, and IS anon-callable — probed safely by
-- passing an invalid level, which the function rejects before writing:
--   POST /rest/v1/rpc/log_seniority_correction {"p_detected_level":"__perm_probe__",...}
--   -> false          (executed; a denial would have been 42501)
-- With VALID levels an anonymous caller can write arbitrary rows into the
-- seniority-corrections log, which is a feedback signal for the classifier.
-- That is a poisoning vector, so it is closed here too.
--
-- AND THE DATE THEORY IS WRONG, recorded because it was my first explanation
-- and it would have caused me to skip this one. The four email-queue functions
-- (2026-07-02) carry the identical pattern and ARE protected —
-- read_email_batch answers 42501 to anon. log_seniority_correction is from
-- 2026-07-04 and is NOT. Two days apart, same pattern, opposite outcomes. So
-- there is no rule of thumb about which functions are safe: the PUBLIC-only
-- revoke works or does not work depending on grants this SQL cannot see, and
-- the only way to know is to call the function with the anon key.
--
-- BOTH aggregates are closed to anon here, not just the one that leaked.
-- get_search_quality returns only counts and rates, but it also reveals traffic
-- volume, and there is no reason for it to be public: the job-board edge
-- function reads it through its SERVICE-ROLE client for the "searchQuality"
-- action, which is unaffected by these revokes and remains the way to check that
-- the telemetry is recording.

REVOKE EXECUTE ON FUNCTION public.get_top_search_misses(integer, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_search_quality(integer) FROM anon, authenticated;

-- Not mine, found by the guard, verified open by probe. Anon must not be able
-- to write corrections that tune a classifier.
REVOKE EXECUTE ON FUNCTION public.log_seniority_correction(text, text, text, text, int, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.log_seniority_correction(text, text, text, text, int, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_seniority_correction(text, text, text, text, int, text) TO service_role;

-- Named explicitly rather than relying on the default-privileges machinery, so
-- a future ALTER DEFAULT PRIVILEGES cannot quietly re-grant them.
REVOKE ALL ON FUNCTION public.get_top_search_misses(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_search_quality(integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_top_search_misses(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_search_quality(integer) TO service_role;
