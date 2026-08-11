-- TWELVE PERFECT SCORES ON TWELVE BOARDS NOBODY HAS HEARD OF.
--
-- "Transparent about pay" finally renders, and this is what it renders.
-- Measured live today, the whole list:
--
--   100% of 267 roles  Aisle And Abroad      100% of  59  1-800-GOT-JUNK?
--   100% of 219        Fluidstack            100% of  59  Helpr
--   100% of  70        Finni Health          100% of  58  MeBe
--   100% of  69        Mon Chasseur Immo     100% of  54  SpotOn
--   100% of  62        Cordaan               100% of  52  Jerry.ai
--   100% of  61        Spear                 100% of  52  Weekdayworks
--
-- Every single one is exactly 100%, and the largest board in the list is 267
-- roles. That is not a coincidence, it is the ORDER BY:
--
--   ORDER BY (100.0 * pay_n / GREATEST(total, 1)) DESC, total DESC
--
-- Ranking by PERCENTAGE with LIMIT 12 means the twelve slots are exhausted by
-- perfect scores before a single large employer is considered. A company
-- stating pay on 95% of 4,000 roles — far more transparency, far more useful to
-- a reader — cannot place, because 100%-of-52 outranks it and there are
-- hundreds of those. The section's premise is "a badge no one can buy", and the
-- badge is currently unwinnable by anyone a job seeker has heard of.
--
-- THE CLAIM DOES NOT CHANGE. The >=80% gate and the >=20-posting floor stay
-- exactly as they are, so every employer listed still genuinely states pay on at
-- least 80% of its served roles — the sentence on the card remains true word for
-- word. Only the ORDER BY changes, from percentage to pay_n: among everyone who
-- clears the bar, show the ones stating pay on the MOST roles. That is also the
-- more honest reading of "transparent about pay", since 3,800 roles with stated
-- pay is more transparency than 52, not less.
--
-- Deliberately NOT done: lowering the 80% gate to let big names in. That would
-- change what the badge means in order to improve who wears it, which is the
-- opposite of the point.
--
-- Cron-only and revoked from anon, unchanged from 20260810200000.
CREATE OR REPLACE FUNCTION public.get_transparent_employers(p_limit int DEFAULT 12)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '4min'
AS $$
  WITH agg AS (
    SELECT company_token,
           max(company) AS company,
           count(*)::int AS total,
           count(*) FILTER (WHERE salary IS NOT NULL)::int AS pay_n
    FROM public.job_board_postings
    WHERE company <> ''
      AND company_token NOT IN (SELECT company_token FROM public.showcase_excluded)
      AND missing_since IS NULL
      AND effective_posted >= now() - interval '30 days'
    GROUP BY company_token
    HAVING count(*) >= 20
       AND 100.0 * count(*) FILTER (WHERE salary IS NOT NULL) / count(*) >= 80
  ),
  top AS (
    SELECT * FROM agg
    -- pay_n, not percentage. Among everyone clearing the same >=80% bar, rank by
    -- how many roles actually state pay.
    ORDER BY pay_n DESC, total DESC
    LIMIT LEAST(GREATEST(p_limit, 1), 50)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'company', t.company,
           'company_token', t.company_token,
           'open_roles', t.total,
           'pay_pct', round(100.0 * t.pay_n / GREATEST(t.total, 1), 0),
           'median_usd_floor', m.med)
         -- The aggregate's ORDER BY must match `top`'s, or the twelve chosen
         -- rows would be re-sorted into a different order than the one they
         -- were chosen by — a list ranked by one rule and cut by another.
         ORDER BY t.pay_n DESC, t.total DESC),
         '[]'::jsonb)
  FROM top t
  LEFT JOIN LATERAL (
    SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY p.salary_min_annual))::numeric, 0) AS med
    FROM public.job_board_postings p
    WHERE p.company_token = t.company_token
      AND p.missing_since IS NULL
      AND p.effective_posted >= now() - interval '30 days'
      AND p.salary_currency = 'USD'
      AND p.salary_min_annual > 0
  ) m ON true;
$$;

REVOKE ALL ON FUNCTION public.get_transparent_employers(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_transparent_employers(int) TO service_role;

COMMENT ON FUNCTION public.get_transparent_employers(int) IS
  'Employers stating pay on >=80% of at least 20 SERVED postings, ranked by the '
  'NUMBER of roles stating pay rather than by percentage. Ranking by percentage '
  'gave all 12 slots to 100%-of-~50-role boards, so no employer a reader '
  'recognises could ever place. The >=80% gate is unchanged: every listed '
  'employer still earns the badge on its own merits. Cron-only, revoked from '
  'anon — it needs minutes and held a worker per page view until 20260810180000.';

NOTIFY pgrst, 'reload schema';