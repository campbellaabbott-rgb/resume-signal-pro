-- Name overrides batch 4: slug-grounded names surfaced by the new company-
-- scale segments (top-of-band lists). Same bar as batches 1-3: the slug
-- spells the company's own name (oreillyauto, rollsroyce, everythingbutwater)
-- or is the company's known tenant identity (ouryahoo = Yahoo's Workday).
-- Ungroundable slugs visible in the same lists (myview, ummc) stay as-is.

INSERT INTO public.company_name_overrides (slug, display_name) VALUES
  ('oreillyauto','O''Reilly Auto Parts'),
  ('rollsroyce','Rolls-Royce'),
  ('everythingbutwater','Everything But Water'),
  ('ouryahoo','Yahoo')
ON CONFLICT (slug) DO UPDATE SET display_name = EXCLUDED.display_name;

UPDATE public.job_board_postings p SET company = o.display_name
  FROM public.company_name_overrides o
 WHERE p.company_token LIKE '%~wd%'
   AND split_part(p.company_token,'~',1) = o.slug AND p.company <> o.display_name;
UPDATE public.job_board_closures c SET company = o.display_name
  FROM public.company_name_overrides o
 WHERE c.company_token LIKE '%~wd%'
   AND split_part(c.company_token,'~',1) = o.slug AND c.company <> o.display_name;
UPDATE public.job_board_company_snapshots s SET company = o.display_name
  FROM public.company_name_overrides o
 WHERE s.company_token LIKE '%~wd%'
   AND split_part(s.company_token,'~',1) = o.slug AND s.company <> o.display_name;

DO $$
BEGIN
  SET LOCAL statement_timeout = '55s';
  PERFORM public.refresh_explore_cache();
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
