INSERT INTO public.company_name_overrides (slug, display_name) VALUES
  ('aig','AIG'),
  ('asml','ASML'),
  ('avav','AeroVironment'),
  ('bdx','Becton Dickinson'),
  ('cae','CAE'),
  ('cars','Cars.com'),
  ('cna','CNA Financial'),
  ('ebay','eBay'),
  ('fis','FIS'),
  ('gnw','Genworth'),
  ('jbtm','JBT Marel'),
  ('jll','JLL'),
  ('ntrs','Northern Trust'),
  ('oxy','Occidental Petroleum'),
  ('ptc','PTC'),
  ('rxo','RXO'),
  ('seic','SEI Investments'),
  ('spgi','S&P Global'),
  ('ufpi','UFP Industries'),
  ('vfc','VF Corporation'),
  ('vrtx','Vertex Pharmaceuticals'),
  ('wmg','Warner Music Group')
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

INSERT INTO public.showcase_excluded (company_token, reason) VALUES
  ('mwamevents', 'derived company name is the non-name "Events"; not an identifiable employer'),
  ('okgov~wd1~okgovjobs', 'US state government (Oklahoma) — catalog is corporate-only')
ON CONFLICT (company_token) DO UPDATE SET reason = EXCLUDED.reason;

INSERT INTO public.showcase_excluded (company_token, reason)
SELECT DISTINCT company_token, 'US state government (Oklahoma) — catalog is corporate-only'
  FROM public.job_board_postings
 WHERE split_part(company_token,'~',1) = 'okgov'
ON CONFLICT (company_token) DO NOTHING;

DO $$
BEGIN
  SET LOCAL statement_timeout = '55s';
  PERFORM public.refresh_explore_cache();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'explore cache refresh deferred to the next scheduled run: %', SQLERRM;
END $$;