-- Orphan sweep: the re-apply round purged globalelitecareers, but the OLD .4
-- bundle's bootstrap lane re-ingested 1,815 rows in the minutes between the
-- migration purge and the .5 function swap (closures stayed at 0 - the
-- windowed/catalog change held). With .5 live the board cannot re-ingest, but
-- without a catalog entry it is never fetched, so nothing would ever prune
-- these rows; they'd linger in search for up to 30 days. Delete them now.
-- Also: oldmutual -> Old Mutual (slug spells it), surfaced by live trending.

DELETE FROM public.job_board_postings WHERE company_token = 'globalelitecareers';
DELETE FROM public.job_board_closures WHERE company_token = 'globalelitecareers';
DELETE FROM public.job_board_company_snapshots WHERE company_token = 'globalelitecareers';

INSERT INTO public.company_name_overrides (slug, display_name) VALUES ('oldmutual','Old Mutual')
ON CONFLICT (slug) DO UPDATE SET display_name = EXCLUDED.display_name;
UPDATE public.job_board_postings p SET company = 'Old Mutual'
 WHERE split_part(p.company_token,'~',1) = 'oldmutual' AND p.company <> 'Old Mutual';
UPDATE public.job_board_closures c SET company = 'Old Mutual'
 WHERE split_part(c.company_token,'~',1) = 'oldmutual' AND c.company <> 'Old Mutual';
UPDATE public.job_board_company_snapshots s SET company = 'Old Mutual'
 WHERE split_part(s.company_token,'~',1) = 'oldmutual' AND s.company <> 'Old Mutual';

DO $$
BEGIN
  SET LOCAL statement_timeout = '55s';
  PERFORM public.refresh_explore_cache();
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
