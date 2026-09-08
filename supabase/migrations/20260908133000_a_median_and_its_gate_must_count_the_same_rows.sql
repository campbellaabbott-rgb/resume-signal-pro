-- THE PAY MEDIAN WAS GATED ON A POPULATION IT WAS NOT DRAWN FROM.
--
-- The transparency card prints two numbers: the share of an employer's served
-- roles that state pay, and a median USD salary floor. They come from two
-- different sets of rows, and only one of them was ever counted.
--
--   `agg`    counts EVERY served posting of the employer (open_roles), and the
--            80% badge is computed over that.
--   the median LATERAL counts only postings with salary_currency = 'USD' and
--            salary_min_annual > 0 -- a strict subset, and on a board where
--            most pay strings are ranges, hourly rates or non-USD, sometimes a
--            tiny one.
--
-- The row carried no count of the second set, so /explore gated the median on
-- the first: `open_roles >= 20`. An employer with 400 served roles, 340 of them
-- stating pay, and THREE parsed USD annual floors passed that gate and
-- published a median of three salaries as a fact about its pay. Same shape as
-- `closed_90d: 41` printed beside `median_days_to_close: null` on 2026-09-06 --
-- a statistic and its sample-size gate computed over different populations --
-- which is a rule this codebase has already written down and then broken.
--
-- THE FIX IS THE COUNT, NOT A NEW THRESHOLD. usd_n is returned from the same
-- LATERAL that computes the median, so the gate and the statistic are the same
-- rows by construction and cannot drift. The threshold is 20, which is not a
-- new constant: it is this function's own >=20 floor, applied for the first
-- time to the population the median actually comes from. And the gate is
-- applied HERE as well as in the page: median_usd_floor is NULL below the
-- floor, so a caller that forgets the check cannot print a median of three.
-- (usd_n itself is always returned, because "we hold 3 parsed salaries" is a
-- true and useful sentence; "the median of them is $X" is not.)
--
-- *** THE ORDER BY IS NOT TOUCHED, AND THAT IS A DECISION, NOT AN OVERSIGHT.
-- Ranking this list by pay_pct was tried and measured on 2026-08-11 and
-- reverted, with the live list recorded in 20260811203000's header: under
-- LIMIT 12, percentage ranking returned twelve boards at exactly 100%, the
-- largest of them 267 roles, so no employer a reader has heard of could ever
-- place. Rate-ranking is compulsory where the HEADING MAKES A COMPARATIVE
-- CLAIM ABOUT CONDUCT -- which is why the re-listing section that ships beside
-- this one ranks on a rate and refuses a raw count. It is optional here,
-- because every row has already cleared a stated bar (>=80% of >=20 served
-- roles) and prints its own ratio on the card: the reader is shown the rate
-- whichever order the twelve arrive in. Re-proposing pay_pct ranking needs new
-- evidence, not a fresh opinion. ***
--
-- Everything else -- the 80% gate, the >=20 posting floor, both serving
-- predicates in both places, the cron-only grants, the 4-minute budget and the
-- aggregate's ORDER BY matching the one the twelve were chosen by -- is
-- byte-for-byte what 20260811234358 applied. Guards pin several of those
-- spellings, and more to the point the badge must keep meaning exactly what it
-- meant yesterday.

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
    -- how many roles actually state pay. See the header before changing this.
    ORDER BY pay_n DESC, total DESC
    LIMIT LEAST(GREATEST(p_limit, 1), 50)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'company', t.company,
           'company_token', t.company_token,
           'open_roles', t.total,
           'pay_pct', round(100.0 * t.pay_n / GREATEST(t.total, 1), 0),
           -- The gate and the statistic, from one subquery over one set of
           -- rows. NULL below the floor: a median of three salaries is not a
           -- smaller fact, it is a different one.
           'median_usd_floor', CASE WHEN m.usd_n >= 20 THEN m.med END,
           'usd_n', m.usd_n)
         -- The aggregate's ORDER BY must match `top`'s, or the twelve chosen
         -- rows would be re-sorted into a different order than the one they
         -- were chosen by — a list ranked by one rule and cut by another.
         ORDER BY t.pay_n DESC, t.total DESC),
         '[]'::jsonb)
  FROM top t
  LEFT JOIN LATERAL (
    SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY p.salary_min_annual))::numeric, 0) AS med,
           count(*)::int AS usd_n
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
  'recognises could ever place; that revert was measured on 2026-08-11 and the '
  'live list is in 20260811203000''s header. The >=80% gate is unchanged: every '
  'listed employer still earns the badge on its own merits. Cron-only, revoked '
  'from anon — it needs minutes and held a worker per page view until '
  '20260810180000. KEYS: company, company_token; open_roles = served postings '
  '(missing_since IS NULL and effective_posted within 30 days, the two '
  'predicates the board itself applies), a POINT-IN-TIME count of what we hold '
  'and never a claim about what the employer has open; pay_pct = the share of '
  'those stating any pay at all, in any currency or period; usd_n = how many of '
  'them carry a PARSED USD ANNUAL FLOOR, which is a strict subset and is '
  'frequently far smaller; median_usd_floor = the median of that subset, in USD, '
  'and it is the median of the RANGE FLOOR (salary_min_annual), not of pay. '
  'THE MEDIAN AND ITS GATE COUNT THE SAME ROWS: median_usd_floor is NULL '
  'whenever usd_n < 20, computed in the same subquery as the median, because '
  'the page previously gated it on open_roles -- a population up to two orders '
  'of magnitude larger -- and could publish a median of three salaries beside a '
  'four-hundred-role board. usd_n is returned even when the median is withheld, '
  'so a caller can say how thin the record is instead of saying nothing.';

NOTIFY pgrst, 'reload schema';
