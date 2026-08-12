-- THREE NUMBERS THE PAGE HAS NEVER BEEN ABLE TO STATE.
--
-- Explore renders twelve cards per answer and says nothing about what those
-- twelve were drawn FROM. "Companies that actually fill roles" over twelve
-- cards is indistinguishable from "twelve companies fill roles" — and this
-- codebase has already shipped a heading whose number its own contents
-- contradicted. A leaderboard without its denominator is a claim about the
-- population dressed as a list.
--
-- This adds:
--   1. get_repost_index()        — a churn warning that follows an employer
--                                  into every other answer, gated on a RATE.
--   2. get_explore_denominators() — per-field served counts, and the pool size
--                                  behind each collection.
--   3. refresh_explore_cache()   — rewired so the counts come from the SAME
--                                  call that produces the cards. No second
--                                  query that can drift from the first.

-- ── 1. the repost index ───────────────────────────────────────────────────
--
-- get_repost_churn_companies already names the twelve worst re-posters, but
-- that warning lives only under the "ghost jobs" chip. A reader who arrives at
-- "will actually hire me" or "states the pay" and clicks an employer that
-- re-lists the same role forty times gets no hint of it — the single most
-- decision-changing fact we hold about that employer is one chip away and
-- invisible.
--
-- THE GATE IS A RATE, NOT A RANK. repost_events is size-correlated: an
-- employer with 12,000 postings accumulates supersede events by existing.
-- Measured over the 300 highest-event employers before choosing this:
--
--     re-lists per affected role:  min 1.0  median 2.7  p75 4.5  p90 7.4
--
-- so 2.7 is TYPICAL and a gate near it would flag a third of the board — a
-- caution that appears everywhere is wallpaper, not a caution. Worse, the two
-- largest employers by raw events sit BELOW the median (ALTEN 769 events at
-- 2.6/role; BAYADA 594 at 2.2/role), so a "top N by events" gate would have
-- put a churn warning on two large employers with entirely ordinary behaviour
-- while missing BoxLunch & Hot Topic at 193.7 re-lists per role across three.
-- Ranking by size under a claim about conduct is the same defect just removed
-- from get_actively_hiring_companies, and it defames rather than misranks.
--
--     events >= 25 AND events/roles >= 5   ->  90 of the 810-employer pool
--
-- Eleven percent: a real minority. Both halves are needed — the rate alone
-- admits 2 roles re-listed 5 times each, which is noise; the volume floor
-- alone is the size gate this exists to avoid.
--
-- THE 180-DAY WINDOW is new. The `sup` CTE in get_repost_churn_companies has
-- no time bound at all, so an employer that churned once and reformed carries
-- the finding forever. It is a no-op today (the closure log starts 2026-07-14)
-- and becomes the difference between a measurement and a grudge later.
--
-- STILL-SERVING ONLY. `sup` reads job_board_closures, which has no serving
-- predicate — an employer whose roles all aged out would otherwise carry a
-- warning onto a card that cannot appear. The JOIN to live postings means the
-- index only ever describes employers a reader can actually reach.
--
-- ABSENCE IS NOT INNOCENCE, and the frontend contract that follows from that
-- is written here because this function is what makes it true: a miss means
-- "did not clear this gate", not "does not re-post". Nothing may render a
-- clean bill from this index.
CREATE OR REPLACE FUNCTION public.get_repost_index()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '90s'
AS $$
  WITH sup AS (
    SELECT company_token, title, count(*) AS n, min(closed_at) AS first_ev
    FROM public.job_board_closures
    WHERE superseded
      -- The window get_repost_churn_companies lacks. See above.
      AND closed_at >= now() - interval '180 days'
    GROUP BY company_token, title
  ),
  agg AS (
    SELECT company_token,
           sum(n)::int AS events,
           count(*)::int AS roles,
           GREATEST(EXTRACT(DAY FROM now() - min(first_ev))::int, 1) AS days
    FROM sup
    GROUP BY company_token
    HAVING sum(n) >= 25
       AND sum(n)::numeric / GREATEST(count(*), 1) >= 5
  ),
  live AS (
    SELECT company_token
    FROM public.job_board_postings
    WHERE missing_since IS NULL
      AND effective_posted >= now() - interval '30 days'
    GROUP BY company_token
  )
  SELECT COALESCE(
    jsonb_object_agg(a.company_token, jsonb_build_array(a.events, a.roles, a.days)),
    '{}'::jsonb)
  FROM agg a
  JOIN live l ON l.company_token = a.company_token;
$$;

-- Cron-only, like get_transparent_employers: two grouped scans, and its sole
-- caller is refresh_explore_cache. Anon reads it out of the cached row.
REVOKE ALL ON FUNCTION public.get_repost_index() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_repost_index() TO service_role;

COMMENT ON FUNCTION public.get_repost_index() IS
  'token -> [repost_events, reposted_roles, days] for employers whose re-list '
  'RATE clears 5 per affected role on at least 25 events, still serving roles, '
  'within 180 days. Gated on a rate because repost_events is size-correlated: '
  'the two largest employers by raw events re-list BELOW the median rate, so a '
  'top-N gate would warn about ordinary large employers and miss the worst. A '
  'miss means "did not clear this gate", never "does not re-post" — nothing may '
  'render a clean bill from it.';

-- ── 2. the denominators, and the field counts ─────────────────────────────
--
-- Two populations, deliberately counted under DIFFERENT predicates, because
-- they are read against different destinations:
--
--   `co`  mirrors the collections — company <> '', showcase_excluded removed —
--         because it is the pool the twelve cards were drawn from.
--
--   `fld` and `board` mirror THE SERVING PATH EXACTLY: missing_since IS NULL
--         and effective_posted within FRESH_WINDOW_DAYS, and nothing else.
--         job-board/index.ts:5529-5539 applies precisely these two and neither
--         of the others, so a field chip reading "4,246" opens a page counting
--         the same 4,246. Adding the company-level exclusions here would have
--         put a number on a chip that its own destination contradicts — the
--         defect this page has spent the week removing.
--
-- The 50-posting floor on fields is not cosmetic: a field with nine postings
-- across 24,931 employers is a categoriser artifact, and printing "9" next to
-- "Engineering" invites a reader to conclude the board is empty in their area
-- when it is the label that is thin.
CREATE OR REPLACE FUNCTION public.get_explore_denominators()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '3min'
AS $$
  WITH co AS (
    SELECT company_token,
           count(*)::int AS total,
           count(*) FILTER (WHERE salary IS NOT NULL)::int AS pay_n,
           count(*) FILTER (WHERE experience_band = 'entry')::int AS entry_n
    FROM public.job_board_postings
    WHERE company <> ''
      AND company_token NOT IN (SELECT company_token FROM public.showcase_excluded)
      AND missing_since IS NULL
      AND effective_posted >= now() - interval '30 days'
    GROUP BY company_token
  ),
  fld AS (
    SELECT category, count(*)::int AS n
    FROM public.job_board_postings
    WHERE missing_since IS NULL
      AND effective_posted >= now() - interval '30 days'
      AND category IS NOT NULL
    GROUP BY category
  ),
  board AS (
    SELECT count(*)::int AS postings_n,
           count(*) FILTER (WHERE salary IS NOT NULL)::int AS postings_pay_n
    FROM public.job_board_postings
    WHERE missing_since IS NULL
      AND effective_posted >= now() - interval '30 days'
  )
  -- strip_nulls + NULLIF(_, 0): a zero denominator is either a broken scan or a
  -- meaningless sentence ("12 of 0"), and in both cases the honest render is no
  -- sentence at all. The frontend gates on key presence, so a stripped key
  -- degrades to silence rather than to a zero.
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'fields',         (SELECT COALESCE(jsonb_object_agg(category, n), '{}'::jsonb)
                       FROM fld WHERE n >= 50),
    'employers_n',    (SELECT NULLIF(count(*), 0)::int FROM co),
    'entry_n',        (SELECT NULLIF(count(*), 0)::int FROM co WHERE entry_n >= 5),
    -- The pay pair CANNOT be read off get_transparent_employers' agg CTE: its
    -- HAVING combines >=20 roles AND >=80% stated, so counting rows there gives
    -- the numerator twice and a median around 90% rather than the board's real
    -- rate. The denominator has to be built from the >=20 condition ALONE.
    'pay_pool_n',     (SELECT NULLIF(count(*), 0)::int FROM co WHERE total >= 20),
    'pay_n',          (SELECT NULLIF(count(*), 0)::int FROM co
                       WHERE total >= 20 AND 100.0 * pay_n / GREATEST(total, 1) >= 80),
    'postings_n',     (SELECT NULLIF(postings_n, 0) FROM board),
    'postings_pay_n', (SELECT NULLIF(postings_pay_n, 0) FROM board)
  ));
$$;

REVOKE ALL ON FUNCTION public.get_explore_denominators() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_explore_denominators() TO service_role;

COMMENT ON FUNCTION public.get_explore_denominators() IS
  'Pool sizes behind each Explore collection, plus per-field served counts. '
  'fields/board apply ONLY the two serving predicates the job-board function '
  'applies (missing_since IS NULL, effective_posted within 30 days) so a field '
  'chip''s number matches the page it opens; `co` additionally excludes '
  'showcase_excluded and blank companies because that is the pool the cards '
  'were drawn from. pay_pool_n counts the >=20-roles condition ALONE — reading '
  'it off get_transparent_employers would apply the 80%% gate to the '
  'denominator too. Cron-only.';

-- ── 3. the refresh, rewired so counts cannot drift from cards ─────────────
--
-- hiring_n and repost_pool_n come from THE SAME CALL that produces the twelve
-- cards, sliced with a window function rather than counted by a second query.
-- A separate "how many qualify" query would duplicate the HAVING clauses of
-- both RPCs, and every duplicated predicate in this file's history has
-- eventually disagreed with its original — the >=100 open-roles floor, the
-- 7-day fill definition and the churn disqualification are three chances to
-- drift that this shape removes entirely.
--
-- Passing 2000/9000 costs nothing: neither function pre-truncates any more, so
-- both already compute every qualifying row and the LIMIT only decides how many
-- survive to the output.
CREATE OR REPLACE FUNCTION public.refresh_explore_cache()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
SET statement_timeout = '10min'
AS $$
DECLARE
  payload jsonb;
  transparent jsonb := '[]'::jsonb;
  transparent_status text := 'ok';
  hiring_rows jsonb := '[]'::jsonb;
  hiring_n int := 0;
  repost_rows jsonb := '[]'::jsonb;
  repost_pool_n int := 0;
  repost_idx jsonb := '{}'::jsonb;
  denom jsonb := '{}'::jsonb;
  totals jsonb;
BEGIN
  BEGIN
    transparent := COALESCE(public.get_transparent_employers(12), '[]'::jsonb);
    IF jsonb_typeof(transparent) <> 'array' THEN
      transparent_status := 'failed: expected array, got ' || jsonb_typeof(transparent);
      transparent := '[]'::jsonb;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    transparent := '[]'::jsonb;
    transparent_status := 'failed: ' || left(SQLERRM, 120);
    RAISE WARNING 'explore cache: transparent employers unavailable (%)', SQLERRM;
  END;

  BEGIN
    SELECT COALESCE(jsonb_agg(r.j ORDER BY r.rn) FILTER (WHERE r.rn <= 12), '[]'::jsonb),
           count(*)::int
      INTO hiring_rows, hiring_n
    FROM (SELECT to_jsonb(h) AS j, row_number() OVER () AS rn
          FROM public.get_actively_hiring_companies(2000) h) r;
  EXCEPTION WHEN OTHERS THEN
    hiring_rows := '[]'::jsonb; hiring_n := 0;
    RAISE WARNING 'explore cache: hiring unavailable (%)', SQLERRM;
  END;

  BEGIN
    SELECT COALESCE(jsonb_agg(r.j ORDER BY r.rn) FILTER (WHERE r.rn <= 12), '[]'::jsonb),
           count(*)::int
      INTO repost_rows, repost_pool_n
    FROM (SELECT to_jsonb(c) AS j, row_number() OVER () AS rn
          FROM public.get_repost_churn_companies(9000) c) r;
  EXCEPTION WHEN OTHERS THEN
    repost_rows := '[]'::jsonb; repost_pool_n := 0;
    RAISE WARNING 'explore cache: reposters unavailable (%)', SQLERRM;
  END;

  BEGIN
    repost_idx := COALESCE(public.get_repost_index(), '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    repost_idx := '{}'::jsonb;
    RAISE WARNING 'explore cache: repost index unavailable (%)', SQLERRM;
  END;

  BEGIN
    denom := COALESCE(public.get_explore_denominators(), '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    denom := '{}'::jsonb;
    RAISE WARNING 'explore cache: denominators unavailable (%)', SQLERRM;
  END;

  -- Same zero-is-silence rule as the SQL above: a failed block leaves its
  -- counter at 0, NULLIF strips it, and the frontend renders no sentence rather
  -- than "the 12 best of 0". A broken instrument must never read as a fact
  -- about the thing it measures.
  totals := (denom - 'fields') || jsonb_strip_nulls(jsonb_build_object(
    'hiring_n',        NULLIF(hiring_n, 0),
    'repost_pool_n',   NULLIF(repost_pool_n, 0),
    'repost_flagged_n', NULLIF((SELECT count(*)::int FROM jsonb_object_keys(repost_idx)), 0)
  ));

  payload := jsonb_build_object(
    'trending', (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_trending_companies(12) x),
    'newest',   (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_newest_companies(12) x),
    'entry',    (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_entry_level_companies(12) x),
    'hiring',   hiring_rows,
    'reposters', repost_rows,
    'salary',   (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_salary_benchmarks() x),
    'segments', (SELECT coalesce(public.get_size_segments(), '{}'::jsonb)),
    'transparent', transparent,
    'transparent_status', transparent_status,
    'repost_index', repost_idx,
    'fields', COALESCE(denom -> 'fields', '{}'::jsonb),
    'totals', totals,
    'computed_at', now()
  );
  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('explore_cache', payload, now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = EXCLUDED.updated_at;
END;
$$;

COMMENT ON FUNCTION public.refresh_explore_cache() IS
  'Hourly Explore cache. hiring/reposters are sliced to twelve from the SAME '
  'call that yields hiring_n / repost_pool_n, so a collection and its stated '
  'denominator can never disagree. Every optional block is wrapped: a failure '
  'leaves an empty collection and a stripped counter, never a zero rendered as '
  'a fact.';

NOTIFY pgrst, 'reload schema';
