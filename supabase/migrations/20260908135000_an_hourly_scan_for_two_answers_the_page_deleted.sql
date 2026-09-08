-- THE REFRESH IS STILL PAYING FOR THREE ANSWERS THE PAGE NO LONGER MAKES.
--
-- /explore stopped rendering `trending` and `newest` months ago -- they
-- derived a posting's age from first_seen, which is OUR DISCOVERY DATE and is
-- never a posting age, and their open_roles came from a snapshot writer that
-- applies neither serving predicate. The client stopped fetching them. What
-- nobody removed was the cron:
--
--   trending_v := (SELECT ... FROM public.get_trending_companies(12) x);
--   newest_v   := (SELECT ... FROM public.get_newest_companies(12) x);
--
-- Both still run every hour, both still occupy a wrapped block, both still
-- spend a stale_parts SLOT -- and that last one is not free. stale_parts is
-- the page's only staleness signal; a reader shown "trending is stale" about a
-- section that does not exist learns nothing and trusts the banner less.
--
-- The third is the size-segment collection, and it goes for a different
-- reason: it is WRONG, not merely unused. Its bands are cut on sum(on_board)
-- across an employer's feeds, while the card emits max(on_board) for the lead
-- feed -- so four feeds of 300 band as "1,000+ open roles" over a card
-- printing "300 on our board". The chip and section come off the page in the
-- same ship; the one number worth keeping (an employer's own advertised feed
-- total) already reaches section 1 through the guard that requires a READ DATE
-- beside it, which is the only form in which that number is honest.
--
-- WHAT REPLACES THEM. Two collections, both wrapped exactly like their
-- siblings:
--
--   relisting    -- get_relisting_employers, the re-listing section: employers
--                   ranked by events per NORMALISED title, with the board's own
--                   median and p90 re-measured in the same statement so no card
--                   ever quotes a baseline from a different definition.
--   ageout_basis -- get_ageout_basis, the DATE BASIS for the age-out count that
--                   /explore takes off get_company_fill_curve. No count: the
--                   curve owns that number, and a second copy would drift.
--
-- relisting's pool size comes off the ROWS THEMSELVES (board_pool_n, computed
-- over the whole pool inside the RPC) rather than by counting returned rows.
-- The sibling pattern -- call with 9000, count the rows, slice twelve -- makes
-- the count a count of the LIMIT the moment a pool outgrows it, and this RPC
-- caps its own limit at 50. One statement still yields both the cards and
-- their denominator, which is the invariant that pattern exists to protect.
--
-- get_repost_churn_companies IS DELIBERATELY STILL CALLED. The `reposters`
-- collection it feeds is what the new section replaces on the page, but the
-- page and this cron do not deploy together; keeping the key means the old
-- section keeps working right up until the new page lands, and its removal is
-- a separate commit that also has to move a guard. Deleting a collection the
-- deployed page still reads is how a section goes blank with nothing saying
-- so -- the failure 20260907020000 was written to stop.
--
-- Everything else is 20260907020000 verbatim: the same eight handler blocks in
-- the same order with both arms (WHEN OTHERS does NOT catch QUERY_CANCELED,
-- which is precisely what a statement_timeout raises), the same ::text casts
-- on every stale label (`stale || 'x'` is anyarray || anyunknown and would
-- raise INSIDE the handler), the same carry-forward of hiring_n out of the
-- previous payload, the same 15-minute ceiling, and the same unconditional
-- write at the end. The budget still bounds the sum of its callees: 240 + 25 +
-- 15 + 90 + 180 + 20 + 20 + 120 + 20 = 730s against a 900s ceiling, where
-- removing the three collections returned 60s and the two new ones spend 140s.

CREATE OR REPLACE FUNCTION public.refresh_explore_cache()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
SET statement_timeout = '15min'
AS $$
DECLARE
  prev jsonb := '{}'::jsonb;
  payload jsonb;
  stale text[] := '{}';
  transparent jsonb := '[]'::jsonb;
  transparent_status text := 'ok';
  hiring_rows jsonb := '[]'::jsonb;
  hiring_n int := 0;
  repost_rows jsonb := '[]'::jsonb;
  repost_pool_n int := 0;
  repost_idx jsonb := '{}'::jsonb;
  denom jsonb := '{}'::jsonb;
  totals jsonb;
  entry_v jsonb;
  salary_v jsonb;
  relisting_v jsonb := '[]'::jsonb;
  relisting_pool_n int := 0;
  ageout_basis_v jsonb := '{}'::jsonb;
BEGIN
  SELECT COALESCE(v, '{}'::jsonb) INTO prev
    FROM public.job_board_meta WHERE k = 'explore_cache';

  BEGIN
    transparent := COALESCE(public.get_transparent_employers(12), '[]'::jsonb);
    IF jsonb_typeof(transparent) <> 'array' THEN
      transparent_status := 'failed: expected array, got ' || jsonb_typeof(transparent);
      transparent := '[]'::jsonb;
    END IF;
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    transparent := '[]'::jsonb;
    transparent_status := 'failed: ' || left(SQLERRM, 120);
    RAISE WARNING 'explore cache: transparent employers unavailable (%)', SQLERRM;
    WHEN OTHERS THEN
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
  EXCEPTION
    -- CARRY FORWARD AND SAY SO. `::text` on the append is load-bearing:
    -- `stale || 'hiring'` is `anyarray || anyunknown` and the handler would die
    -- inside its own EXCEPTION block, which is the worst place in this function
    -- to raise. hiring_n comes back out of the previous payload rather than
    -- being zeroed, because NULLIF(hiring_n, 0) strips the key and the page
    -- renders its denominator sentence only when the key is present -- so a
    -- zero here deletes the sentence that explains the twelve cards being
    -- served from the last good run.
    WHEN QUERY_CANCELED THEN
    stale := stale || 'hiring'::text;
    hiring_rows := COALESCE(prev -> 'hiring', '[]'::jsonb);
    hiring_n := COALESCE((prev #>> '{totals,hiring_n}')::int, 0);
    RAISE WARNING 'explore cache: hiring unavailable (%)', SQLERRM;
    WHEN OTHERS THEN
    stale := stale || 'hiring'::text;
    hiring_rows := COALESCE(prev -> 'hiring', '[]'::jsonb);
    hiring_n := COALESCE((prev #>> '{totals,hiring_n}')::int, 0);
    RAISE WARNING 'explore cache: hiring unavailable (%)', SQLERRM;
  END;

  BEGIN
    SELECT COALESCE(jsonb_agg(r.j ORDER BY r.rn) FILTER (WHERE r.rn <= 12), '[]'::jsonb),
           count(*)::int
      INTO repost_rows, repost_pool_n
    FROM (SELECT to_jsonb(c) AS j, row_number() OVER () AS rn
          FROM public.get_repost_churn_companies(9000) c) r;
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    repost_rows := '[]'::jsonb; repost_pool_n := 0;
    RAISE WARNING 'explore cache: reposters unavailable (%)', SQLERRM;
    WHEN OTHERS THEN
    repost_rows := '[]'::jsonb; repost_pool_n := 0;
    RAISE WARNING 'explore cache: reposters unavailable (%)', SQLERRM;
  END;

  -- THE NEW RE-LISTING COLLECTION. Its pool count rides on the rows: every
  -- returned row carries board_pool_n, computed inside the RPC over the whole
  -- pool the twelve were chosen from, so the cards and their denominator come
  -- from one statement without the caller having to ask for nine thousand rows
  -- and count them.
  BEGIN
    SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb), max(x.board_pool_n)
      INTO relisting_v, relisting_pool_n
    FROM public.get_relisting_employers(12) x;
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'relisting'::text;
    relisting_v := COALESCE(prev -> 'relisting', '[]'::jsonb);
    relisting_pool_n := COALESCE((prev #>> '{totals,relisting_pool_n}')::int, 0);
    RAISE WARNING 'explore cache: relisting unavailable (%)', SQLERRM;
    WHEN OTHERS THEN
    stale := stale || 'relisting'::text;
    relisting_v := COALESCE(prev -> 'relisting', '[]'::jsonb);
    relisting_pool_n := COALESCE((prev #>> '{totals,relisting_pool_n}')::int, 0);
    RAISE WARNING 'explore cache: relisting unavailable (%)', SQLERRM;
  END;

  BEGIN
    repost_idx := COALESCE(public.get_repost_index(), '{}'::jsonb);
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    repost_idx := '{}'::jsonb;
    RAISE WARNING 'explore cache: repost index unavailable (%)', SQLERRM;
    WHEN OTHERS THEN
    repost_idx := '{}'::jsonb;
    RAISE WARNING 'explore cache: repost index unavailable (%)', SQLERRM;
  END;

  BEGIN
    denom := COALESCE(public.get_explore_denominators(), '{}'::jsonb);
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    denom := '{}'::jsonb;
    RAISE WARNING 'explore cache: denominators unavailable (%)', SQLERRM;
    WHEN OTHERS THEN
    denom := '{}'::jsonb;
    RAISE WARNING 'explore cache: denominators unavailable (%)', SQLERRM;
  END;

  BEGIN
    entry_v := (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_entry_level_companies(12) x);
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'entry'::text;
    entry_v := COALESCE(prev -> 'entry', '[]'::jsonb);
    WHEN OTHERS THEN
    stale := stale || 'entry'::text;
    entry_v := COALESCE(prev -> 'entry', '[]'::jsonb);
  END;
  BEGIN
    salary_v := (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_salary_benchmarks() x);
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'salary'::text;
    salary_v := COALESCE(prev -> 'salary', '[]'::jsonb);
    WHEN OTHERS THEN
    stale := stale || 'salary'::text;
    salary_v := COALESCE(prev -> 'salary', '[]'::jsonb);
  END;

  -- THE AGE-OUT DATE BASIS, and only the basis. get_company_fill_curve owns
  -- ageouts_90d; this says how much ledger that 90-day name actually has
  -- behind it, so a card cannot imply ninety days of watching we did not do.
  BEGIN
    ageout_basis_v := COALESCE(public.get_ageout_basis(), '{}'::jsonb);
  EXCEPTION
    WHEN QUERY_CANCELED THEN
    stale := stale || 'ageout_basis'::text;
    ageout_basis_v := COALESCE(prev -> 'ageout_basis', '{}'::jsonb);
    RAISE WARNING 'explore cache: age-out basis unavailable (%)', SQLERRM;
    WHEN OTHERS THEN
    stale := stale || 'ageout_basis'::text;
    ageout_basis_v := COALESCE(prev -> 'ageout_basis', '{}'::jsonb);
    RAISE WARNING 'explore cache: age-out basis unavailable (%)', SQLERRM;
  END;

  totals := (denom - 'fields') || jsonb_strip_nulls(jsonb_build_object(
    'hiring_n',        NULLIF(hiring_n, 0),
    'repost_pool_n',   NULLIF(repost_pool_n, 0),
    'repost_flagged_n', NULLIF((SELECT count(*)::int FROM jsonb_object_keys(repost_idx)), 0),
    'relisting_pool_n', NULLIF(relisting_pool_n, 0)
  ));

  payload := jsonb_build_object(
    'entry',    entry_v,
    'hiring',   hiring_rows,
    'reposters', repost_rows,
    'relisting', relisting_v,
    'ageout_basis', ageout_basis_v,
    'salary',   salary_v,
    'transparent', transparent,
    'transparent_status', transparent_status,
    'repost_index', repost_idx,
    'fields', COALESCE(denom -> 'fields', '{}'::jsonb),
    'totals', totals,
    'stale_parts', to_jsonb(stale),
    'computed_at', now()
  );
  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('explore_cache', payload, now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = EXCLUDED.updated_at;
END;
$$;

COMMENT ON FUNCTION public.refresh_explore_cache() IS
  'Hourly Explore cache. EVERY section is optional: a failing callee costs '
  'one stale section (previous value carried, named in stale_parts), never '
  'the hour''s write. KEYS: entry, hiring, reposters, relisting, ageout_basis, '
  'salary, transparent (+transparent_status), repost_index, fields, totals, '
  'stale_parts, computed_at. hiring/reposters are sliced to twelve from the '
  'SAME call that yields hiring_n/repost_pool_n, and relisting takes its '
  'relisting_pool_n off the returned rows'' own board_pool_n, so in every case '
  'a collection and its stated denominator come from one statement. REMOVED '
  '2026-09-08: trending and newest (the page deleted them for deriving a '
  'posting age from our discovery date, and the cron kept computing them and '
  'spending stale_parts slots on sections that do not exist) and segments (its '
  'bands are cut on the SUM of an employer''s feeds while its card prints the '
  'MAX, so four feeds of 300 banded as 1,000+ open roles). The stale labels for '
  'those three are gone with them; ''relisting'' and ''ageout_basis'' are new. '
  'reposters is retained on purpose until the page that replaces it ships. '
  'BUDGET: 15min, which must stay at or above the sum of the callees'' own '
  'ceilings -- a callee''s SET overrides the caller''s, so nothing but this '
  'value bounds their total, and exceeding it rolls back the write and loses '
  'every collection including the healthy ones.';

-- THE SEGMENT AGGREGATE ALSO HAS A DOOR BESIDE THE CRON.
--
-- Dropping it from this refresh removes it from the page's PRIMARY path, but
-- /explore also calls it live as anon when the cache read fails, so an
-- anonymous caller can still start a thirty-second full-corpus aggregate whose
-- published shape is known wrong -- bands cut on the SUM of an employer's
-- feeds beside a card printing the MAX of them. A retracted answer that anyone
-- can still ask for is not retracted; it is unrendered.
--
-- REVOKED, NOT DROPPED, and both halves are deliberate. A DROP would be
-- irreversible in a migration and would strand the four guards that describe
-- this function's body; a revoke leaves the definition readable, is undone by
-- a single GRANT, and stops the last path that reaches it. The page's own
-- fallback catches the failure and hides the section, which is the same
-- outcome the ship intends.
--
-- FROM THE CATALOG, never by a hand-typed signature -- this database carries
-- functions the migrations do not describe, so a named REVOKE can miss an
-- overload and leave it open. That is also why the name appears here only as a
-- proname literal: a guard in company-display-names.test.ts locates this
-- function by searching every migration for its qualified spelling and then
-- expects a body to follow it, so writing that spelling in a file with no
-- definition in it would fail a guard about a function this file does not
-- change.
DO $revoke$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public' AND p.proname = 'get_size_segments'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    n := n + 1;
  END LOOP;
  IF n = 0 THEN
    RAISE NOTICE 'no segment aggregate found to revoke; nothing to do';
  ELSE
    RAISE NOTICE 'revoked anon EXECUTE on % segment aggregate overload(s)', n;
  END IF;
END
$revoke$;

NOTIFY pgrst, 'reload schema';
