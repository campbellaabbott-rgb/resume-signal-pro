-- "Companies that actually fill roles" showed fabricated-looking data, proven live:
--   * Lever SANDBOX tenants ranked as top hirers ("Lever Test 23: 631 filled",
--     "Lever Demo 2", "Lever Implementation Training Environment") — test
--     boards, not companies. Already removed from sources.ts; their residual
--     postings/closures still pollute every list.
--   * The "/90d" framing is false: the closure log's oldest event is 2026-07-14
--     (7 days old). There is no 90 days of measurement.
--   * Counts are repost CHURN, not fills: BoxLunch "2512 filled" measured as
--     closures with median tenure 3.0d, max 3.0d, 0% >= 7d — a feed cycling
--     roles every ~3 days. A 3-day listing that vanishes is not a filled role.
-- And "Just added to the board" broke with the 2026-07-11 first_seen mass-reset
-- (min(first_seen) makes EVERY board look just-added).
--
-- Rebuild both on signals that carry real meaning:
--   * FILLS: closures where the role stayed posted >= 7 days and then came down
--     (tenure from the company's own posted_at when stated, else first_seen),
--     non-superseded, sandbox tenants excluded, window = last 30 days, and the
--     company must still have open roles (a dead board is not "actively hiring").
--     tracking_days (global, capped at the window) is returned so the UI can say
--     "in Nd of tracking" instead of claiming a window we haven't measured.
--   * JUST ADDED: boards that appear in the daily company snapshots
--     (20260721190000) AFTER our first-ever snapshot — genuine appearance, immune
--     to the first_seen reset. Empty until snapshots accrue; no fabricated list.

-- One-time purge of the Lever sandbox tenants everywhere (already out of
-- sources.ts, so nothing re-ingests them; SandboxAQ is a REAL company and is
-- deliberately NOT touched — match exact tokens only, never name patterns).
DELETE FROM public.job_board_postings  WHERE company_token IN ('levertest','leverdemo','leverdemo-8');
DELETE FROM public.job_board_closures  WHERE company_token IN ('levertest','leverdemo','leverdemo-8');
DELETE FROM public.job_board_company_snapshots WHERE company_token IN ('levertest','leverdemo','leverdemo-8');

-- Return type gains tracking_days → must drop first (CREATE OR REPLACE cannot
-- change OUT columns). Column name closed_90d is kept for frontend compat; its
-- meaning is now "genuine fills inside the tracked window".
DROP FUNCTION IF EXISTS public.get_actively_hiring_companies(int);
CREATE FUNCTION public.get_actively_hiring_companies(p_limit int DEFAULT 20)
RETURNS TABLE (company text, company_token text, closed_90d bigint, open_roles bigint, tracking_days int)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '15s'
AS $$
  WITH span AS (
    SELECT LEAST(GREATEST(EXTRACT(DAY FROM now() - min(closed_at))::int, 1), 30) AS days
    FROM public.job_board_closures
  ),
  fills AS (
    SELECT c.company_token, max(c.company) AS company, count(*) AS filled
    FROM public.job_board_closures c
    WHERE c.closed_at > now() - interval '30 days'
      AND NOT c.superseded
      AND c.company <> ''
      AND c.company_token NOT IN ('levertest','leverdemo','leverdemo-8')
      AND c.closed_at - COALESCE(c.posted_at, c.first_seen) >= interval '7 days'
    GROUP BY c.company_token
    HAVING count(*) >= 3
    ORDER BY count(*) DESC
    LIMIT GREATEST(p_limit, 1) * 3   -- headroom: some drop below on the open-roles gate
  )
  SELECT f.company, f.company_token, f.filled AS closed_90d, o.n AS open_roles,
         (SELECT days FROM span) AS tracking_days
  FROM fills f
  JOIN LATERAL (
    SELECT count(*) AS n FROM public.job_board_postings p WHERE p.company_token = f.company_token
  ) o ON true
  WHERE o.n > 0
  ORDER BY f.filled DESC, o.n DESC
  LIMIT GREATEST(p_limit, 1);
$$;
GRANT EXECUTE ON FUNCTION public.get_actively_hiring_companies(int) TO anon, authenticated;

-- "Just added": first appearance in the snapshot history, excluding anything
-- present in our first-ever snapshot (those aren't new — we just started
-- watching). Signature unchanged; first_added = the snapshot date the board
-- first appeared (a date we OBSERVED, not a vendor claim).
CREATE OR REPLACE FUNCTION public.get_newest_companies(p_limit int DEFAULT 12)
RETURNS TABLE (company text, company_token text, open_roles bigint, first_added timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '15s'
AS $$
  WITH bounds AS (
    SELECT min(snapshot_date) AS first_day, max(snapshot_date) AS last_day
    FROM public.job_board_company_snapshots
  ),
  appearances AS (
    SELECT company_token, min(snapshot_date) AS appeared
    FROM public.job_board_company_snapshots
    GROUP BY company_token
  )
  SELECT s.company, s.company_token, s.open_roles::bigint, a.appeared::timestamptz AS first_added
  FROM appearances a
  JOIN public.job_board_company_snapshots s
    ON s.company_token = a.company_token
   AND s.snapshot_date = (SELECT last_day FROM bounds)
  WHERE a.appeared > (SELECT first_day FROM bounds)
    AND a.appeared >= (SELECT last_day FROM bounds) - 14
    AND s.open_roles >= 3
  ORDER BY a.appeared DESC, s.open_roles DESC
  LIMIT GREATEST(p_limit, 1);
$$;
GRANT EXECUTE ON FUNCTION public.get_newest_companies(int) TO anon, authenticated;

-- Cache builder: both collections now read the rebuilt RPCs (single source of
-- truth — no drifting inline copies).
CREATE OR REPLACE FUNCTION public.refresh_explore_cache()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE payload jsonb;
BEGIN
  payload := jsonb_build_object(
    'trending', (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_trending_companies(12) x),
    'newest',   (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_newest_companies(12) x),
    'entry',    (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_entry_level_companies(12) x),
    'hiring',   (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_actively_hiring_companies(12) x),
    'salary',   (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_salary_benchmarks() x),
    'computed_at', now()
  );
  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('explore_cache', payload, now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = EXCLUDED.updated_at;
END;
$$;

-- Rebuild the cache now so the corrected collections show immediately.
-- Guarded so it can never fail the migration.
DO $$
BEGIN
  SET LOCAL statement_timeout = '40s';
  PERFORM public.refresh_explore_cache();
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
