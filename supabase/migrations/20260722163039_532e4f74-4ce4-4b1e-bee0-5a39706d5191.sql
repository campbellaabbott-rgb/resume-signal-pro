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