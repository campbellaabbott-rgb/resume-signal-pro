-- Fit-threshold alerts: a saved search can require a minimum résumé-fit before the
-- digest emails you, so "notify me" becomes "notify me only about roles I actually
-- match". 0 = off (plain new-postings digest). Values mirror the board's fit tiers:
-- 10 = possible match (10%+ keyword coverage), 20 = strong match (20%+). The digest
-- scores new postings against the user's latest résumé and only alerts on passers.
ALTER TABLE public.user_job_searches
  ADD COLUMN IF NOT EXISTS fit_threshold integer NOT NULL DEFAULT 0;
