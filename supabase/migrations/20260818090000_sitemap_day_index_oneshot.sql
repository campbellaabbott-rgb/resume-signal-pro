-- THE SITEMAP WAS TELLING GOOGLEBOT 503 — AND NOT BECAUSE OF THE OUTAGE.
--
-- Verified AFTER the database recovered (2026-08-18 01:10Z: REST answering in
-- 0.4s, board list 200, facets 200): every per-posting sitemap page still
-- returned 503 in ~9s to a Googlebot UA. robots.txt advertises this sitemap
-- index; its 30 entries all point at pages that fail. Repeated 5xx on an
-- advertised sitemap burns crawl budget and risks dropped URLs — this is the
-- job-page coverage, the largest crawlable surface the site has.
--
-- THE CAUSE IS A MISSING INDEX, not load. The page query is:
--
--   missing_since IS NULL AND posted_at >= day AND posted_at < day+1
--   ORDER BY id LIMIT 1000            (keyset: AND id > last)
--
-- The only posted_at index is (source, posted_at) — the leading column is
-- wrong for a bare date range, so every 1,000-row chunk scans the table and
-- dies on the statement timeout. The handler then, CORRECTLY, refuses to serve
-- a partial urlset (a confident 200 with missing URLs is the lie we removed on
-- 2026-07-27) — so the honest failure mode made the missing index loud.
--
-- (posted_at, id): the range scan lands on the day window, the sort-by-id of
-- one day's dated rows (~40k worst case) is cheap, and the keyset restarts
-- cost the same each chunk. Partial on the serving predicate; the range
-- implies posted_at IS NOT NULL, and excluding NULLs keeps the ~47k undated
-- rows out of the index.
--
-- Same one-shot cron delivery as 20260726060000, same reasoning: Lovable's
-- runner wraps migrations in a transaction (CONCURRENTLY refuses), the SQL
-- editor's timeout cancels long builds. Plain CREATE INDEX blocks writes for
-- the build, not reads — and today that cost is LITERALLY ZERO, because the
-- ingest is paused for the incident. There is no better moment to build it.
CREATE OR REPLACE FUNCTION public.build_sitemap_day_index_oneshot()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '600s'
AS $$
BEGIN
  -- Unschedule FIRST: a failed build must not thrash-retry a write-blocking
  -- operation every minute.
  PERFORM cron.unschedule('build-sitemap-day-index-oneshot');

  CREATE INDEX IF NOT EXISTS job_board_postings_sitemap_day_idx
    ON public.job_board_postings (posted_at, id)
    WHERE missing_since IS NULL AND posted_at IS NOT NULL;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
     AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'build-sitemap-day-index-oneshot') THEN
    PERFORM cron.schedule(
      'build-sitemap-day-index-oneshot',
      '* * * * *', -- next minute; the function unschedules itself on first run
      'SELECT public.build_sitemap_day_index_oneshot();'
    );
  END IF;
END $$;
