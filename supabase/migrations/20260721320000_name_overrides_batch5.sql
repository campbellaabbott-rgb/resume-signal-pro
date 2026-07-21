-- Name overrides batch 5 (non-urgent; rides with any future deploy): two more
-- slug-grounded names from the segment toplists. campingworld spells Camping
-- World; madixinc spells Madix Inc. Ungroundable slugs stay (myview, ummc,
-- investpsp, tamus).

INSERT INTO public.company_name_overrides (slug, display_name) VALUES
  ('campingworld','Camping World'),
  ('madixinc','Madix')
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
