-- Per-search alert cadence. The board re-verifies feeds every 10-15 minutes,
-- but the ONLY outbound loop was the digest's global 6-day gate — so "watch
-- this company" and "alert me when this exists" produced, at best, an email
-- most of a week later. Each saved search now carries its own cadence:
--   weekly (default, matches the old behavior for existing rows)
--   daily  (set by the explicitly alert-flavored actions: the zero-result
--           "Alert me when this exists" CTA and watch-company)
-- The send function gates per-search (daily = 20h floor, weekly = 6d floor),
-- so nothing sends faster than the user's chosen rhythm and no existing
-- subscriber's cadence changes.
ALTER TABLE public.user_job_searches
  ADD COLUMN IF NOT EXISTS digest_cadence text NOT NULL DEFAULT 'weekly'
  CHECK (digest_cadence IN ('daily', 'weekly'));
