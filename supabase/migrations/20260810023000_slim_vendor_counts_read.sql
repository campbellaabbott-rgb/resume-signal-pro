-- THE HOMEPAGE DOWNLOADS 3.2MB TO RENDER FIFTEEN SMALL NUMBERS.
--
-- Measured 2026-08-10: get_job_board_facets returns 1,622,548 bytes, of which
-- the vendor wall reads ~600 — sourcesFacet, openTotal, as_of. Everything else
-- is companiesFacet: ~24k employer rows the homepage discards unread. And the
-- wall mounts twice (hero strip + full block), so every landing pays the
-- payload twice: ~3.2MB and two ~1.2s transfers per visitor, for numbers that
-- fit in a tweet.
--
-- The facets RPC itself is not wrong — /jobs genuinely needs companiesFacet
-- for its company filter — the homepage was simply reading a firehose because
-- it was the only tap. This adds the right-sized tap: same cached row, same
-- 15-minute refresh writes it, minus the 1.6MB the caller never wanted.
--
-- Same serving-honesty contract as the wide read: sourcesFacet omits vendors
-- with no live postings (absence is never a measured zero), openTotal is the
-- same two-predicate serving-rule sum, and as_of says when the counts were
-- true. A cold cache returns the empty shape — sourcesFacet {}, openTotal
-- NULL — which the consumer already treats as "not measured", rendering names
-- without numbers rather than zeros.
CREATE OR REPLACE FUNCTION public.get_board_vendor_counts()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
-- Reading one row's three keys needs milliseconds; failing fast beats holding
-- a request open — the rule every cached read in this file family follows.
SET statement_timeout = '5s'
AS $$
  SELECT COALESCE(
    (SELECT jsonb_build_object(
       'sourcesFacet', COALESCE(v -> 'sourcesFacet', '{}'::jsonb),
       'openTotal',    v -> 'openTotal',
       'as_of',        v -> 'as_of',
       'cached',       true
     )
     FROM public.job_board_meta WHERE k = 'facets'),
    jsonb_build_object(
      'sourcesFacet', '{}'::jsonb, 'openTotal', NULL,
      'as_of', NULL, 'cached', false)
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_board_vendor_counts() TO anon, authenticated;

COMMENT ON FUNCTION public.get_board_vendor_counts() IS
  'Vendor-wall subset of the cached board facets: sourcesFacet + openTotal + '
  'as_of only. Exists because the homepage was downloading the full 1.6MB '
  'facets payload (twice) to read ~600 bytes of it. Same cache row, same '
  'serving rule, same absence-is-not-zero contract as get_job_board_facets.';
